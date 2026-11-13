// Offline scale benchmark: how does one simulated day cost grow with population?
//
// Builds a town of N residents by replicating the founding Tidehaven scenario K times (homes,
// workplaces, residents, and proportional treasury/trade capacity), then drives days exactly like the
// runner does — clone → hash → decide (offline mock) → runDay → hash → saveState — timing each stage.
//
// No network, no credentials, no paid calls. Uses a throwaway data directory under the OS temp dir.
//
//   npm run build && node scripts/scale-bench.mjs --sizes 25,500,2000,10000 --days 20 --budget 120
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distArg = process.argv.indexOf('--dist');
const distDir = distArg >= 0 ? resolve(process.argv[distArg + 1]) : join(root, 'dist');
const dist = (p) => import(join(distDir, p));
const { loadScenario } = await dist('application/scenario.js');
const { createTown } = await dist('application/bootstrap.js');
const { loadState, saveState } = await dist('storage/repositories.js');
const { openDatabase } = await dist('storage/database.js');
const { migrate } = await dist('storage/migrate.js');
const { runDay } = await dist('domain/turn-engine.js');
const { stateHash } = await dist('domain/hash.js');
const { cloneState } = await dist('domain/state.js');
const { MockDecisionSource } = await dist('model/mock.js');
const { buildActorPrompt } = await dist('model/prompts.js');
const { buildNewspaperDigest } = await dist('application/newspaper.js');
const { isAdult } = await dist('domain/clock.js');
const lookupsModule = await dist('domain/lookups.js').catch(() => null);

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const sizes = arg('--sizes', '25,500,2000,10000').split(',').map(Number);
const maxDays = Number(arg('--days', '20'));
const budgetMs = Number(arg('--budget', '120')) * 1000;

function scaleScenario(base, copies) {
  const s = structuredClone(base);
  const t = base.town;
  const buildings = [], households = [], businesses = [], residents = [];
  const nb = t.buildings.length, nh = t.households.length;
  for (let k = 0; k < copies; k++) {
    const sfx = k === 0 ? '' : ` ${k}`;
    for (const b of t.buildings) buildings.push({ ...b, id: b.id + k * nb, name: b.name + sfx });
    for (const h of t.households) households.push({ ...h, id: h.id + k * nh, name: h.name + sfx, building: h.building + k * nb });
    for (const b of t.businesses) {
      businesses.push({ ...b, name: b.name + sfx, building: b.building + k * nb, owner: b.owner === null ? null : b.owner + sfx });
    }
    for (const r of t.residents) {
      residents.push({ ...r, name: r.name + sfx, household: r.household + k * nh, job: r.job === null ? null : r.job + sfx });
    }
  }
  s.town = { ...t, buildings, households, businesses, residents };
  s.economy.treasuryCents *= copies;
  s.economy.externalCapacityUnits *= copies;
  return s;
}

const ms = (n) => (n < 10 ? n.toFixed(2) : n.toFixed(0));
const base = loadScenario(root, 'scenarios/tidehaven.json');
const results = [];

for (const target of sizes) {
  const copies = Math.max(1, Math.round(target / base.town.residents.length));
  const scenario = scaleScenario(base, copies);
  const dir = mkdtempSync(join(tmpdir(), 'tidehaven-scale-'));
  try {
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    let t0 = performance.now();
    const created = createTown({
      db, scenario, worldName: `Scale ${target}`, seed: `scale-${target}`,
      populationTarget: scenario.town.residents.length, populationPolicyEnabled: true,
      hostCeiling: 1_000_000, drama: 'calm',
    });
    let state = loadState(db, created.world);
    const bootMs = performance.now() - t0;
    const totals = { clone: 0, hashBefore: 0, decide: 0, runDay: 0, hashAfter: 0, save: 0 };
    let days = 0, decisions = 0, invariantsOk = true;
    const started = performance.now();

    for (let day = 1; day <= maxDays; day++) {
      const source = new MockDecisionSource({ state, scenario, behaviour: 'baseline', dramaRateBps: 1_200 });
      t0 = performance.now(); const staged = cloneState(state); totals.clone += performance.now() - t0;
      t0 = performance.now(); stateHash(staged); totals.hashBefore += performance.now() - t0;

      t0 = performance.now();
      const plans = new Map();
      const lookups = lookupsModule?.buildObservationLookups?.(staged, day);
      for (const resident of staged.residents.values()) {
        if (resident.status !== 'living' || !isAdult(resident.bornDay, day, scenario.calendar)) continue;
        const prompt = buildActorPrompt({ state: staged, scenario, resident, day, memories: [], events: [], maxBytes: 4096, maxRecords: 3, lookups });
        const o = await source.decide({ day, actorId: resident.id, prompt, schema: {} });
        plans.set(resident.id, { actorId: resident.id, plan: o.plan, source: o.source, summary: o.summary });
      }
      totals.decide += performance.now() - t0;
      decisions += plans.size;

      t0 = performance.now(); const result = runDay({ state: staged, scenario, day, plans }); totals.runDay += performance.now() - t0;
      if (!result.invariants.ok) invariantsOk = false;
      t0 = performance.now(); const hash = stateHash(staged); totals.hashAfter += performance.now() - t0;

      t0 = performance.now();
      saveState(db, staged, {
        events: result.ctx.events, ledger: result.ctx.ledger, flows: result.ctx.flows,
        observations: result.ctx.observations, memories: result.ctx.memories, taxRecords: result.ctx.taxRecords,
        shipping: result.ctx.shipping, articles: [buildNewspaperDigest(result.ctx, result.ctx.events)],
        metrics: { day, metrics: result.metrics, stateHash: hash }, phase: 'committed', stateHash: hash,
      });
      totals.save += performance.now() - t0;
      state = staged;
      days = day;
      if (!invariantsOk || performance.now() - started > budgetMs) break;
    }

    const perDay = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / days]));
    const dayMs = Object.values(perDay).reduce((a, b) => a + b, 0);
    const living = [...state.residents.values()].filter((r) => r.status === 'living').length;
    const mem = process.memoryUsage();
    const dbMiB = statSync(join(dir, 'tidehaven.sqlite')).size / 1048576;
    db.close();
    const finalHash = stateHash(state);
    const row = {
      target, living, finalHash, adults: Math.round(decisions / days), days, bootMs, dayMs, perDay,
      daysPerHour: 3_600_000 / dayMs, heapMiB: mem.heapUsed / 1048576, rssMiB: mem.rss / 1048576, dbMiB, invariantsOk,
    };
    results.push(row);
    console.log(
      `N=${target} living=${living} adults/day=${row.adults} days=${days} boot=${ms(bootMs)}ms ` +
        `day=${ms(dayMs)}ms [clone ${ms(perDay.clone)} hash ${ms(perDay.hashBefore + perDay.hashAfter)} ` +
        `decide ${ms(perDay.decide)} runDay ${ms(perDay.runDay)} save ${ms(perDay.save)}] ` +
        `days/h=${row.daysPerHour.toFixed(0)} heap=${row.heapMiB.toFixed(0)}MiB rss=${row.rssMiB.toFixed(0)}MiB ` +
        `db=${dbMiB.toFixed(1)}MiB invariants=${invariantsOk ? 'ok' : 'FAILED'} hash=${finalHash.slice(0, 16)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  globalThis.gc?.();
}

console.log('\nJSON ' + JSON.stringify(results));
