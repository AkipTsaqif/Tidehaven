import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import { loadScenario } from './scenario.js';
import { createTown } from './bootstrap.js';
import { loadState, saveState } from '../storage/repositories.js';
import { openDatabase } from '../storage/database.js';
import { migrate } from '../storage/migrate.js';
import { runDay } from '../domain/turn-engine.js';
import { stateHash } from '../domain/hash.js';
import { checkGoodsLedger } from '../domain/invariants.js';
import { MockDecisionSource } from '../model/mock.js';
import { buildActorPrompt } from '../model/prompts.js';
import type { ActorPlan } from '../contracts/actions.js';
import { buildNewspaperDigest } from './newspaper.js';
import type { SavePayload } from '../storage/repositories.js';
import { silentLogger } from '../runtime/telemetry.js';
import { writeCheckpoint } from '../storage/checkpoints.js';
import { readArchive, listArchives, runRetention } from './retention.js';
import { isAdult } from '../domain/clock.js';

/**
 * Long-run soak: drives N simulated days against the in-process scripted provider, checking every
 * day's invariants, goods reconciliation, and money conservation, then reports throughput, storage
 * growth, and population/economy health.
 *
 * Offline by design: no network, no credentials, no paid calls.
 */

interface SoakOptions {
  days: number;
  drama: boolean;
  keep: boolean;
  verbose: boolean;
}

function parseOptions(args: string[]): SoakOptions {
  const read = (flag: string, fallback: string): string => {
    const index = args.indexOf(flag);
    const value = index >= 0 ? args[index + 1] : undefined;
    return value ?? fallback;
  };
  const days = Number(read('--days', '365'));
  return {
    days: Number.isFinite(days) && days > 0 ? Math.min(1_000_000, Math.trunc(days)) : 365,
    drama: args.includes('--drama') || read('--profile', 'baseline') === 'drama',
    keep: args.includes('--keep'),
    verbose: args.includes('--verbose'),
  };
}

export async function runSoak(config: AppConfig, args: string[], out: (line: string) => void): Promise<boolean> {
  const providerArg = (() => {
    const index = args.indexOf('--provider');
    return index >= 0 ? (args[index + 1] ?? 'mock') : 'mock';
  })();
  if (providerArg !== 'mock' && providerArg !== 'fixture') {
    out(`Soak supports the offline mock provider only (got --provider ${providerArg}).`);
    return false;
  }

  const options = parseOptions(args);
  const scenario = loadScenario(config.projectRoot, config.scenarioFile);
  const soakRoot = join(config.dataDir, 'soak');
  mkdirSync(soakRoot, { recursive: true });
  const runDir = join(soakRoot, `run-${Date.now()}`);
  mkdirSync(runDir, { recursive: true });
  const dbPath = join(runDir, 'tidehaven.sqlite');
  const db = openDatabase(dbPath);
  migrate(db);

  const created = createTown({
    db,
    scenario,
    worldName: `${scenario.description ? 'Soak' : 'Soak'} Tidehaven`,
    seed: `soak-${options.drama ? 'drama' : 'baseline'}-${options.days}`,
    populationTarget: config.defaults.simulation.populationTarget,
    populationPolicyEnabled:
      config.populationPolicyOverride ??
      scenario.growth?.populationPolicyEnabled ??
      config.defaults.simulation.populationPolicyEnabled,
    hostCeiling: config.defaults.simulation.hostCeiling,
    drama: options.drama ? 'dramatic' : 'calm',
  });
  const state = loadState(db, created.world);
  const source = new MockDecisionSource({
    state,
    scenario,
    behaviour: options.drama ? 'drama' : 'baseline',
    dramaRateBps: 1_200,
  });
  // Each run gets its own directory for checkpoints and archives, so measurements are isolated.
  const runConfig = { ...config, dataDir: runDir };
  const logger = silentLogger();

  out(
    `Soak: ${options.days} days, profile ${options.drama ? 'drama' : 'baseline'}, ` +
      `data ${runDir}`,
  );

  const startedAt = Date.now();
  const violations: string[] = [];
  /** Periodic resident-set sample so memory growth is a trend, not a single final number. */
  const memorySeries: { day: number; heapMiB: number; rssMiB: number }[] = [];
  const recordMemory = (day: number): void => {
    const usage = process.memoryUsage();
    memorySeries.push({
      day,
      heapMiB: Math.round(usage.heapUsed / 1024 / 1024),
      rssMiB: Math.round(usage.rss / 1024 / 1024),
    });
  };
  let hungerDays = 0;
  let maxHungerDays = 0;
  let deaths = 0;
  let maxPopulation = 0;
  let minTreasury = Number.MAX_SAFE_INTEGER;
  let moneyBase = 0;
  const pricesStart = new Map(state.prices);
  const crimesByDay: number[] = [];

  for (let day = 1; day <= options.days; day += 1) {
    const plans = new Map<number, ActorPlan>();
    for (const resident of state.residents.values()) {
      if (resident.status !== 'living') continue;
      if (!isAdult(resident.bornDay, day, scenario.calendar)) continue;
      const prompt = buildActorPrompt({
        state,
        scenario,
        resident,
        day,
        memories: [],
        events: [],
        maxBytes: 4096,
        maxRecords: 3,
      });
      const outcome = await source.decide({ day, actorId: resident.id, prompt, schema: {} });
      plans.set(resident.id, {
        actorId: resident.id,
        plan: outcome.plan,
        source: outcome.source,
        summary: outcome.summary,
      });
    }

    const result = runDay({ state, scenario, day, plans });
    if (!result.invariants.ok) {
      violations.push(`day ${day}: ${result.invariants.violations.map((v) => v.code).join(',')}`);
      out(`FAILED at day ${day}: ${result.invariants.violations[0]?.detail ?? 'invariant'}`);
      break;
    }

    if (day === 1) moneyBase = result.invariants.money.totalCents;
    if (result.invariants.money.totalCents !== moneyBase) {
      violations.push(`day ${day}: money supply changed ${moneyBase} -> ${result.invariants.money.totalCents}`);
    }

    const article = buildNewspaperDigest(result.ctx, result.ctx.events);
    const payload: SavePayload = {
      events: result.ctx.events,
      ledger: result.ctx.ledger,
      flows: result.ctx.flows,
      observations: result.ctx.observations,
      memories: result.ctx.memories,
      taxRecords: result.ctx.taxRecords,
      shipping: result.ctx.shipping,
      articles: [article],
      metrics: { day, metrics: result.metrics, stateHash: stateHash(state) },
      phase: 'committed',
      stateHash: stateHash(state),
    };
    saveState(db, state, payload);

    const metrics = result.metrics as { hunger: number; population: number; treasuryCents: number; deaths: number };
    hungerDays += metrics.hunger;
    maxHungerDays = Math.max(maxHungerDays, metrics.hunger);
    deaths += metrics.deaths;
    maxPopulation = Math.max(maxPopulation, metrics.population);
    minTreasury = Math.min(minTreasury, metrics.treasuryCents);
    crimesByDay.push(result.ctx.events.filter((e) => ['theft', 'fraud', 'assault', 'bribery', 'sabotage'].includes(e.kind)).length);

    if (day % 100 === 0 || day === 1) {
      recordMemory(day);
    }

    if (day % 30 === 0) {
      writeCheckpoint(db, state, runConfig.dataDir);
      runRetention({
        db,
        config: runConfig,
        worldId: created.world.id,
        currentDay: day,
        logger,
        keepDetailDays: 365,
      });
    }

    if (day % 500 === 0) {
      // Progress with timing: a long soak that silently degrades is indistinguishable from a stuck one.
      out(`... day ${day}/${options.days} (${((Date.now() - startedAt) / 1000).toFixed(0)}s elapsed)`);
    }

    if (options.verbose && day % 30 === 0) {
      out(
        `day ${day}: pop ${metrics.population}, treasury ${metrics.treasuryCents}, hunger ${metrics.hunger}, ` +
          `deaths ${metrics.deaths}`,
      );
    }
    if (options.keep === false && day === options.days) {
      // keep the final database for inspection; the flag only controls the run directory below
    }
  }

  // Final goods reconciliation against the running flow counters (survives archival pruning).
  const goodsViolations = checkGoodsLedger(state);
  for (const violation of goodsViolations) violations.push(violation.detail);

  const elapsed = Date.now() - startedAt;
  const finalMetrics = (await readFinalMetrics(db, created.world.id)) ?? {};
  const living = [...state.residents.values()].filter((r) => r.status === 'living').length;
  const daysCompleted = state.day;

  out('');
  out('--- soak report ---');
  out(`days simulated       ${daysCompleted} in ${(elapsed / 1000).toFixed(1)}s (${((daysCompleted * 3_600_000) / Math.max(1, elapsed)).toFixed(0)} days/hour)`);
  out(`population           ${living} living (peak ${maxPopulation}), deaths ${deaths}`);
  out(`hunger               ${hungerDays} resident-days hungry (worst day ${maxHungerDays})`);
  out(`money supply         ${moneyBase} -> ${finalMetrics.moneySupplyCents ?? '?'} (must be constant)`);
  out(`treasury low point   ${minTreasury}`);
  out(`crimes recorded      ${crimesByDay.reduce((a, b) => a + b, 0)}`);
  out(`final state hash     ${stateHash(state)}`);
  const pageCount = Number(db.get<{ page_count: number }>('pragma page_count')?.page_count ?? 0);
  const pageSize = Number(db.get<{ page_size: number }>('pragma page_size')?.page_size ?? 0);
  const archiveBytes = listArchives(runDir).reduce((sum, name) => {
    try {
      return sum + statSync(join(runDir, 'archives', name)).size;
    } catch {
      return sum;
    }
  }, 0);
  out(`database size        ${(pageCount * pageSize / 1024 / 1024).toFixed(1)} MiB (compact history growth, measured)`);
  out(`archive size         ${(archiveBytes / 1024 / 1024).toFixed(1)} MiB across ${listArchives(runDir).length} chunks`);
  const priceReport = [...state.prices.entries()].map(([good, price]) => `${good} ${pricesStart.get(good)}->${price}`).join(', ');
  out(`prices               ${priceReport}`);
  out(`goods reconciliation ${goodsViolations.length === 0 ? 'ok' : 'FAILED'}`);
  const archiveFiles = listArchives(runDir);
  const archiveChecks = archiveFiles.map((name) => readArchive(join(runDir, 'archives', name)));
  out(`archives             ${archiveFiles.length} chunks, ${archiveChecks.filter((c) => c.ok).length} verified`);
  if (archiveChecks.some((check) => !check.ok)) {
    out('FAILED: an archive chunk did not verify');
  }
  const memory = process.memoryUsage();
  out(`memory               rss ${Math.round(memory.rss / 1024 / 1024)} MiB, heap ${Math.round(memory.heapUsed / 1024 / 1024)} MiB`);
  if (memorySeries.length > 1) {
    const first = memorySeries[0]!;
    const last = memorySeries[memorySeries.length - 1]!;
    const peak = memorySeries.reduce((max, sample) => Math.max(max, sample.heapMiB), 0);
    out(
      `memory series        ${memorySeries.length} samples: heap ${first.heapMiB} -> ${last.heapMiB} MiB ` +
        `(peak ${peak} MiB) between day ${first.day} and ${last.day}`,
    );
  }
  out(`invariants           ${violations.length === 0 ? 'ok every day' : `${violations.length} failures`}`);

  if (violations.length > 0) {
    out('');
    out('FAILURES:');
    for (const violation of violations.slice(0, 10)) out(`  - ${violation}`);
  }

  const ok = violations.length === 0 && archiveChecks.every((check) => check.ok);
  out('');
  out(ok ? 'Soak passed.' : 'Soak failed.');

  db.close();
  if (ok && !options.keep) {
    try {
      rmSync(runDir, { recursive: true, force: true });
    } catch {
      // leave it for inspection
    }
  } else {
    out(`Kept data directory: ${runDir}`);
  }
  return ok;
}

async function readFinalMetrics(db: ReturnType<typeof openDatabase>, worldId: number): Promise<{ moneySupplyCents?: number } | null> {
  const row = db.get<{ metrics_json: string }>(
    'select metrics_json from daily_metrics where world_id = ? order by day desc limit 1',
    [worldId],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.metrics_json) as { moneySupplyCents?: number };
  } catch {
    return null;
  }
}
