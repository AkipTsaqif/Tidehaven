import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { loadScenario } from '../../src/application/scenario.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadState, readWorld } from '../../src/storage/repositories.js';
import { openDatabase, type Db } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { Runner } from '../../src/runtime/runner.js';
import { silentLogger } from '../../src/runtime/telemetry.js';
import type { DecisionOutcome, DecisionRequest, DecisionSource } from '../../src/model/jobs.js';
import { upsertJob } from '../../src/storage/job-repo.js';
import { isAdult } from '../../src/domain/clock.js';
import type { ActorPlan } from '../../src/contracts/actions.js';

/**
 * Runner behaviour: pause reasons, resume, and reuse of accepted decisions after a restart.
 * Scripted in-process source only — no network, no credentials.
 *
 * Every test stops the runner in a finally block: a leaked loop would keep the process alive.
 */

type Behaviour = 'ok' | 'auth' | 'down';

class ScriptedSource implements DecisionSource {
  readonly mode = 'fixture' as const;
  seen: number[] = [];
  calls = 0;
  private behaviour: Behaviour;
  constructor(behaviour: Behaviour) {
    this.behaviour = behaviour;
  }

  heal(): void {
    this.behaviour = 'ok';
  }

  capability(): null {
    return null;
  }

  stats() {
    return {
      inFlight: 0,
      terminalFallbacks: this.behaviour === 'ok' ? 0 : this.calls,
      decisions: this.calls,
      lastErrorClass:
        this.behaviour === 'auth' ? ('auth' as const) : this.behaviour === 'down' ? ('server' as const) : null,
      rateLimitedUntil: null,
    };
  }

  async decide(request: DecisionRequest): Promise<DecisionOutcome> {
    this.calls += 1;
    this.seen.push(request.actorId);
    const failing = this.behaviour !== 'ok';
    return {
      actorId: request.actorId,
      plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: 'scripted' },
      source: failing ? 'fallback' : 'model',
      summary: 'scripted',
      fallbackReason: failing ? 'scripted_failure' : null,
      usage: { promptTokens: 10, completionTokens: 5, estimateOnly: true },
      latencyMs: 1,
      errorClass: this.behaviour === 'auth' ? 'auth' : this.behaviour === 'down' ? 'server' : null,
      attempts: 1,
      capability: null,
    };
  }
}

const dirs: string[] = [];
let dbHandle: Db | null = null;

afterEach(() => {
  dbHandle?.close();
  dbHandle = null;
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may briefly hold a log handle
    }
  }
});

interface Harness {
  runner: Runner;
  source: ScriptedSource;
  state: ReturnType<typeof loadState>;
  db: Db;
  worldId: number;
  stop: () => Promise<void>;
}

function setup(behaviour: Behaviour, overrides: { minFreeBytes?: number } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'tidehaven-runner-'));
  dirs.push(dir);
  const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
  if (overrides.minFreeBytes !== undefined) config.defaults.storage.minFreeBytes = overrides.minFreeBytes;
  const scenario = loadScenario(process.cwd());
  const db = openDatabase(join(dir, 'tidehaven.sqlite'));
  dbHandle = db;
  migrate(db);
  const created = createTown({
    db,
    scenario,
    worldName: 'Runner',
    seed: 'runner-test',
    populationTarget: 120,
    hostCeiling: 500,
    drama: 'dramatic',
  });
  const state = loadState(db, created.world);
  const source = new ScriptedSource(behaviour);
  const runner = new Runner({
    config,
    logger: silentLogger(),
    db,
    world: created.world,
    state,
    scenario,
    source,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5))),
  });
  let loop: Promise<void> | null = null;
  return {
    runner,
    source,
    state,
    db,
    worldId: created.world.id,
    stop: async () => {
      runner.requestStop('shutdown');
      if (loop) await loop;
    },
    start: () => {
      loop = runner.run();
    },
  } as Harness;
}

async function waitFor(runner: Runner, predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for runner condition: ${JSON.stringify(runner.snapshot())}`);
}

describe('runner', () => {
  it(
    'pauses on an authentication failure, freezes time, and resumes',
    async () => {
      const h = setup('auth');
      const loop = h.runner.run();
      try {
        await waitFor(h.runner, () => h.runner.snapshot().paused !== null);
        expect(h.runner.snapshot().paused?.reason).toBe('authentication');
        const frozen = h.state.day;
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(h.state.day).toBe(frozen);

        // The operator fixed the key: the next day runs normally.
        h.source.heal();
        expect(h.runner.resume()).toBe(true);
        await waitFor(h.runner, () => h.state.day > frozen);
      } finally {
        h.runner.requestStop('shutdown');
        await loop;
      }
    },
    30_000,
  );

  it(
    'pauses when the provider-wide fallback rate is too high',
    async () => {
      const h = setup('down');
      const loop = h.runner.run();
      try {
        await waitFor(h.runner, () => h.runner.snapshot().paused !== null);
        const snapshot = h.runner.snapshot();
        expect(snapshot.paused?.reason).toBe('provider_down');
        // The pause names the dominant cause instead of a bare percentage.
        expect(snapshot.paused?.detail).toContain('server x');
        expect(snapshot.fallbackRateBps).toBeGreaterThanOrEqual(5_000);
        const frozen = h.state.day;
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(h.state.day).toBe(frozen);
      } finally {
        h.runner.requestStop('shutdown');
        await loop;
      }
    },
    30_000,
  );

  it(
    'pauses instead of writing when the data volume is below the free-space floor',
    async () => {
      const h = setup('ok', { minFreeBytes: Number.MAX_SAFE_INTEGER });
      const loop = h.runner.run();
      try {
        await waitFor(h.runner, () => h.runner.snapshot().paused !== null);
        expect(h.runner.snapshot().paused?.reason).toBe('disk_pressure');
      } finally {
        h.runner.requestStop('shutdown');
        await loop;
      }
    },
    30_000,
  );

  it(
    'reuses a stored decision and re-requests only the missing jobs',
    async () => {
      const h = setup('ok');
      const scenario = loadScenario(process.cwd());
      const nextDay = h.state.day + 1;
      const adults = [...h.state.residents.values()]
        .filter((resident) => resident.status === 'living' && isAdult(resident.bornDay, nextDay, scenario.calendar))
        .map((resident) => resident.id)
        .sort((a, b) => a - b);
      const stored = adults[0]!;
      const storedPlan: ActorPlan = {
        actorId: stored,
        plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: 'stored-plan' },
        source: 'model',
        summary: 'stored-plan',
      };
      upsertJob(h.db, {
        worldId: h.worldId,
        day: nextDay,
        phase: 'collect',
        actorId: stored,
        jobKind: 'plan',
        status: 'done',
        result: storedPlan,
      });

      const loop = h.runner.run();
      try {
        await waitFor(h.runner, () => h.state.day >= nextDay);
      } finally {
        h.runner.requestStop('shutdown');
        await loop;
      }

      expect(h.source.seen).not.toContain(stored);
      expect(h.source.seen.length).toBeGreaterThan(0);
      const row = h.db.get<{ result_json: string }>(
        'select result_json from jobs where world_id = ? and day = ? and actor_id = ? and job_kind = ?',
        [h.worldId, nextDay, stored, 'plan'],
      );
      expect(row?.result_json).toContain('stored-plan');
      expect(readWorld(h.db, h.worldId)!.currentDay).toBeGreaterThanOrEqual(nextDay);
    },
    40_000,
  );
});
