import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeProvider, type FakeProvider } from '../fixtures/fake-provider.js';
import { seedTown } from '../fixtures/seed-town.js';
import { ModelClient } from '../../src/model/client.js';
import { ModelDecisionSource, boundMessages } from '../../src/model/jobs.js';
import { UsageTracker, BudgetExceeded } from '../../src/runtime/usage.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { planJsonSchema } from '../../src/contracts/actions.js';
import { silentLogger } from '../../src/runtime/telemetry.js';
import { livingResidents } from '../../src/domain/state.js';
import { loadScenario } from '../../src/application/scenario.js';
import { SseHub } from '../../src/http/sse.js';
import { dataTreeBytes } from '../../src/application/retention.js';
import { doctor, savedWorldExists, databasePath } from '../../src/application/diagnostics.js';
import { loadConfig } from '../../src/config.js';
import { createTown } from '../../src/application/bootstrap.js';
import { migrate } from '../../src/storage/migrate.js';
import { openDatabase } from '../../src/storage/database.js';
import { saveState } from '../../src/storage/repositories.js';
import { enqueueCommand } from '../../src/storage/commands-repo.js';
import { upsertJob } from '../../src/storage/job-repo.js';
import { stateHash } from '../../src/domain/hash.js';
import { loadState, readWorld } from '../../src/storage/repositories.js';

/** Regression tests for runtime findings F6, F7, F10, F11, F22, F23, F25, F26. */

const scenario = loadScenario(process.cwd());
let provider: FakeProvider | null = null;
const dirs: string[] = [];

afterEach(async () => {
  await provider?.close();
  provider = null;
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold a handle briefly
    }
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const plan = JSON.stringify({ primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: 'ok' });

async function harness(options: { maxResponseBytes?: number; maxInputTokens?: number; dailyRequests?: number | null } = {}) {
  const town = await seedTown({ seed: 'runtime' });
  provider = await startFakeProvider();
  const logger = silentLogger();
  const usage = new UsageTracker({
    db: town.db,
    worldId: town.worldId,
    ceilings: {
      dailyTokens: null,
      monthlyTokens: null,
      dailyRequests: options.dailyRequests ?? null,
      monthlyRequests: null,
      monthlyResetDayOfMonth: 1,
      monthlyResetUtcHour: 0,
    },
    logger,
  });
  const client = new ModelClient({
    baseUrl: provider.url,
    apiKey: 'test-key',
    model: 'fake-model',
    timeoutMs: 2_000,
    maxResponseBytes: options.maxResponseBytes ?? 100_000,
    logger,
  });
  const source = new ModelDecisionSource({
    db: town.db,
    client,
    logger,
    usage,
    state: town.state,
    scenario,
    model: 'fake-model',
    capability: 'json_object',
    maxDispatches: 1,
    maxInputTokens: options.maxInputTokens ?? 3_000,
    maxOutputTokens: 200,
    retryBaseDelayMs: 5,
    maxRetryDelayMs: 50,
  });
  const actor = livingResidents(town.state)[0]!;
  const prompt = buildActorPrompt({
    state: town.state,
    scenario,
    resident: actor,
    day: 1,
    memories: [],
    events: [],
    maxBytes: 4_096,
    maxRecords: 3,
  });
  return { town, source, actor, prompt, usage, provider: provider! };
}

describe('provider response bytes are bounded while reading (F6)', () => {
  it('stops reading an oversized streaming body at the configured limit', async () => {
    const h = await harness({ maxResponseBytes: 16_384 });
    h.provider.enqueue({ kind: 'oversized', bytes: 4_000_000, chunkBytes: 8_192 });
    const client = new ModelClient({
      baseUrl: h.provider.url,
      apiKey: 'k',
      model: 'fake-model',
      timeoutMs: 5_000,
      maxResponseBytes: 16_384,
      logger: silentLogger(),
    });
    const result = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxOutputTokens: 10,
      capability: 'json_object',
    });
    expect(result.ok).toBe(false);
    expect(result.errorClass).toBe('too_large');
    // Reading stopped at the bound, and the client never held more than the bound in memory.
    expect(result.responseBytes).toBeLessThanOrEqual(16_384);
    // The provider was cancelled long before it could write the whole body.
    expect(h.provider.bytesWritten).toBeLessThan(4_000_000);

    // The decision source turns the same condition into a recorded fallback, not a stall.
    h.provider.enqueue({ kind: 'oversized', bytes: 4_000_000, chunkBytes: 8_192 });
    const outcome = await h.source.decide({ day: 1, actorId: h.actor.id, prompt: h.prompt, schema: planJsonSchema() });
    expect(outcome.source).toBe('fallback');
    expect(outcome.errorClass).toBe('too_large');
    h.town.db.close();
  }, 30_000);
});

describe('the input token budget bounds every dispatch (F7)', () => {
  it('trims an oversized prompt (and repair turn) before the request is sent', () => {
    const huge = 'ünïcode '.repeat(20_000);
    const bounded = boundMessages(
      [
        { role: 'system', content: 'system contract' },
        { role: 'user', content: huge },
        { role: 'assistant', content: huge },
        { role: 'user', content: `repair please ${huge}` },
      ],
      500,
    );
    const bytes = bounded.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
    // 500 estimated tokens at the documented ~4 bytes/token, plus the small system message.
    expect(bytes).toBeLessThan(500 * 4 + 64);
    expect(bounded[0]?.content).toBe('system contract');
    expect(bounded[bounded.length - 1]?.content).toContain('repair please');
  });

  it('sends a request no larger than the configured input bound', async () => {
    const h = await harness({ maxInputTokens: 300 });
    h.provider?.enqueue({ kind: 'completion', content: plan });
    const hugePrompt = { ...h.prompt, user: `${h.prompt.user}\n${'x'.repeat(200_000)}` };
    await h.source.decide({ day: 1, actorId: h.actor.id, prompt: hugePrompt, schema: planJsonSchema() });
    const body = h.provider?.requests[0]?.body as { messages?: { content: string }[] };
    const bytes = (body.messages ?? []).reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
    expect(bytes).toBeLessThan(300 * 4 + 4_096);
    h.town.db.close();
  }, 30_000);
});

describe('durable per-attempt audit rows (F11)', () => {
  it('writes one model_attempts row per actual dispatch, including a retry', async () => {
    const h = await harness();
    h.provider!.enqueue(
      { kind: 'http_error', status: 503 },
      { kind: 'completion', content: plan },
    );
    const source = new ModelDecisionSource({
      db: h.town.db,
      client: new ModelClient({
        baseUrl: h.provider!.url,
        apiKey: 'k',
        model: 'fake-model',
        timeoutMs: 2_000,
        maxResponseBytes: 100_000,
        logger: silentLogger(),
      }),
      logger: silentLogger(),
      usage: h.usage,
      state: h.town.state,
      scenario,
      model: 'fake-model',
      capability: 'json_object',
      maxDispatches: 3,
      maxInputTokens: 3_000,
      maxOutputTokens: 200,
      retryBaseDelayMs: 5,
      maxRetryDelayMs: 10,
      sleep: async () => undefined,
    });
    const jobId = upsertJob(h.town.db, {
      worldId: h.town.worldId,
      day: 1,
      phase: 'collect',
      actorId: h.actor.id,
      jobKind: 'plan',
      status: 'running',
    });
    await source.decide({
      day: 1,
      actorId: h.actor.id,
      prompt: h.prompt,
      schema: planJsonSchema(),
      jobId,
      promptVersion: 'resident-plan-v1',
    });
    const rows = h.town.db.all<{ attempt_no: number; status: string; capability: string | null; model: string | null }>(
      'select attempt_no, status, capability, model from model_attempts order by attempt_no',
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.status).toBe('failed');
    expect(rows[1]?.status).toBe('ok');
    expect(rows[0]?.model).toBe('fake-model');
    h.town.db.close();
  }, 30_000);
});

describe('SSE reconnects replay retained notifications (F10)', () => {
  it('replays events after Last-Event-ID instead of only signalling a resync', () => {
    const hub = new SseHub({ maxClients: 5, retention: 10 });
    hub.broadcast('state', { day: 1 });
    hub.broadcast('state', { day: 2 });

    const writes: string[] = [];
    const reply = {
      raw: {
        writeHead: () => undefined,
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
      },
    };
    const result = hub.add(reply as never, '1');
    expect(result.resync).toBe(false);
    const payload = writes.join('');
    expect(payload).toContain('"day":2');
    expect(payload).not.toContain('"day":1');
  });

  it('signals a resync only when the supplied id is older than the retained window', () => {
    const hub = new SseHub({ maxClients: 5, retention: 1 });
    hub.broadcast('state', { day: 1 });
    hub.broadcast('state', { day: 2 });
    const stub = { raw: { writeHead: () => undefined, write: () => true } };
    expect(hub.add(stub as never, '0').resync).toBe(true);
  });
});

describe('usage reservations are durable and serialised (F23)', () => {
  it('persists a reservation before dispatch and keeps conservative spend after a restart', async () => {
    const town = await seedTown({ seed: 'usage' });
    const ceilings = {
      dailyTokens: null,
      monthlyTokens: null,
      dailyRequests: 1,
      monthlyRequests: null,
      monthlyResetDayOfMonth: 1,
      monthlyResetUtcHour: 0,
    };
    const first = new UsageTracker({ db: town.db, worldId: town.worldId, ceilings, logger: silentLogger() });
    const reservation = first.reserve({ promptTokens: 100, maxOutputTokens: 100 });
    expect(reservation).toBeGreaterThan(0);
    // A concurrent caller cannot pass the same remaining allowance.
    expect(() => first.reserve({ promptTokens: 100, maxOutputTokens: 100 })).toThrow(BudgetExceeded);

    // Simulate a crash before the response: a new tracker treats the open reservation as spend.
    const restarted = new UsageTracker({ db: town.db, worldId: town.worldId, ceilings, logger: silentLogger() });
    expect(restarted.snapshot().requestsToday).toBeGreaterThanOrEqual(1);
    expect(() => restarted.reserve({ promptTokens: 10, maxOutputTokens: 10 })).toThrow(BudgetExceeded);
    town.db.close();
  }, 30_000);
});

describe('command dispositions commit with the world (F22)', () => {
  it('leaves the command pending and the world unchanged when the commit fails', async () => {
    const town = await seedTown({ seed: 'commands' });
    const day = town.state.day + 1;
    const commandId = enqueueCommand(town.db, town.worldId, 'set_target', { value: 42 });
    const before = readWorld(town.db, town.worldId)!.currentDay;
    const pendingBefore = town.db.get<{ status: string }>('select status from operator_commands where id = ?', [commandId]);
    expect(pendingBefore?.status).toBe('pending');

    expect(() =>
      saveState(town.db, town.state, {
        events: [],
        ledger: [],
        flows: [],
        observations: [],
        memories: [],
        taxRecords: [],
        shipping: [],
        articles: [],
        metrics: null,
        phase: 'committed',
        stateHash: stateHash(town.state),
        // The command is not pending any more (id 999_999 does not exist): the whole transaction must
        // roll back rather than publishing a world whose command disposition was lost.
        commandIds: [999_999],
      }),
    ).toThrow();
    expect(readWorld(town.db, town.worldId)!.currentDay).toBe(before);
    const stillPending = town.db.get<{ status: string }>('select status from operator_commands where id = ?', [commandId]);
    expect(stillPending?.status).toBe('pending');
    void day;
    town.db.close();
  }, 30_000);
});

describe('storage budget covers the whole owned tree (F25)', () => {
  it('counts backups, checkpoints, logs, and WAL companions, not just the database', () => {
    const dir = tempDir('tidehaven-storage-');
    writeFileSync(join(dir, 'tidehaven.sqlite'), Buffer.alloc(1_000));
    for (const sub of ['backups', 'checkpoints', 'logs', 'archives']) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, sub, 'file.bin'), Buffer.alloc(2_000));
    }
    expect(dataTreeBytes(dir)).toBeGreaterThanOrEqual(9_000);
  });
});

describe('town detection uses the saved world, not file existence (F26)', () => {
  it('reports no saved town for an empty directory and leaves doctor’s sqlite probe harmless', async () => {
    const dir = tempDir('tidehaven-doctor-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    expect(savedWorldExists(config)).toBe(false);
    await doctor(config);
    // `doctor` must not create the authoritative database.
    expect(existsSync(databasePath(config))).toBe(false);
    expect(savedWorldExists(config)).toBe(false);
  }, 30_000);

  it('detects a real saved town', async () => {
    const dir = tempDir('tidehaven-saved-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    createTown({
      db,
      scenario,
      worldName: 'Saved',
      seed: 'saved',
      populationTarget: 20,
      hostCeiling: 100,
      drama: 'calm',
    });
    db.close();
    expect(savedWorldExists(config)).toBe(true);
  }, 30_000);
});

describe('population safety pauses are enforced by the runner (F13)', () => {
  it('freezes committed time with a visible population_ceiling reason', async () => {
    const { Runner } = await import('../../src/runtime/runner.js');
    const dir = tempDir('tidehaven-population-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Ceiling',
      seed: 'ceiling-pause',
      populationTarget: 120,
      hostCeiling: 500,
      drama: 'calm',
    });
    const state = (await import('../../src/storage/repositories.js')).loadState(db, created.world);
    // The town is exactly at its hard ceiling from the first day.
    state.hostCeiling = livingResidents(state).length;
    const source = {
      mode: 'fixture' as const,
      capability: () => null,
      stats: () => ({ inFlight: 0, terminalFallbacks: 0, decisions: 0, lastErrorClass: null, rateLimitedUntil: null }),
      decide: async (request: { actorId: number }) => ({
        actorId: request.actorId,
        plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
        source: 'model' as const,
        summary: '',
        fallbackReason: null,
        usage: { promptTokens: 1, completionTokens: 1, estimateOnly: true },
        latencyMs: 1,
        errorClass: null,
        attempts: 1,
        capability: null,
      }),
    };
    const runner = new Runner({
      config,
      logger: silentLogger(),
      db,
      world: created.world,
      state,
      scenario,
      source: source as never,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    });
    const dayBefore = state.day;
    const loop = runner.run();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && runner.snapshot().paused === null) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    runner.requestStop('shutdown');
    await loop;
    expect(runner.snapshot().paused?.reason).toBe('population_ceiling');
    // Committed time is frozen: the clamped day was never committed.
    expect(state.day).toBe(dayBefore);
    const world = readWorld(db, created.world.id)!;
    expect(world.currentDay).toBe(dayBefore);
    db.close();
  }, 60_000);
});

describe('same-phase decisions run concurrently (F8)', () => {
  it('overlaps resident decisions without exceeding the configured concurrency', async () => {
    const { Runner } = await import('../../src/runtime/runner.js');
    const dir = tempDir('tidehaven-concurrency-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    config.defaults.model.concurrency = 4;
    config.defaults.model.queueCapacity = 64;
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Concurrent',
      seed: 'concurrency',
      populationTarget: 120,
      hostCeiling: 500,
      drama: 'calm',
    });
    const state = (await import('../../src/storage/repositories.js')).loadState(db, created.world);

    let inFlight = 0;
    let peak = 0;
    const source = {
      mode: 'fixture' as const,
      capability: () => null,
      stats: () => ({ inFlight, terminalFallbacks: 0, decisions: 0, lastErrorClass: null, rateLimitedUntil: null }),
      decide: async (request: { actorId: number }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return {
          actorId: request.actorId,
          plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
          source: 'model' as const,
          summary: '',
          fallbackReason: null,
          usage: { promptTokens: 1, completionTokens: 1, estimateOnly: true },
          latencyMs: 1,
          errorClass: null,
          attempts: 1,
          capability: null,
        };
      },
    };

    const runner = new Runner({
      config,
      logger: silentLogger(),
      db,
      world: created.world,
      state,
      scenario,
      source: source as never,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    });
    const dayBefore = state.day;
    const loop = runner.run();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && state.day <= dayBefore) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runner.requestStop('shutdown');
    await loop;

    expect(state.day).toBe(dayBefore + 1);
    // More than one request overlapped (the phase is not serial), and never more than the cap.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    db.close();
  }, 60_000);
});

describe('publication completeness and commit identity (R1/R5/R6)', () => {
  it('publishes a committed will into the live runner state (R1)', async () => {
    const { Runner } = await import('../../src/runtime/runner.js');
    const { readWorld, loadState } = await import('../../src/storage/repositories.js');
    const { stateHash } = await import('../../src/domain/hash.js');
    const dir = tempDir('tidehaven-wills-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Wills',
      seed: 'will-publish',
      populationTarget: 120,
      hostCeiling: 500,
      drama: 'calm',
    });
    const state = loadState(db, created.world);
    const actors = [...state.residents.values()]
      .filter((resident) => resident.status === 'living')
      .sort((a, b) => a.id - b.id);
    const writer = actors[0]!;
    const heir = actors[1]!;
    let wroteWill = false;
    const source = {
      mode: 'fixture' as const,
      capability: () => null,
      stats: () => ({ inFlight: 0, terminalFallbacks: 0, decisions: 0, lastErrorClass: null, rateLimitedUntil: null }),
      decide: async (request: { actorId: number }) => {
        const plan =
          request.actorId === writer.id
            ? {
                primary: { kind: 'write_will', targetId: heir.id, detail: '6000' },
                social: null,
                orders: [],
                intents: [],
                summary: '',
              }
            : { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' };
        if (request.actorId === writer.id) wroteWill = true;
        return {
          actorId: request.actorId,
          plan,
          source: 'model' as const,
          summary: '',
          fallbackReason: null,
          usage: { promptTokens: 1, completionTokens: 1, estimateOnly: true },
          latencyMs: 1,
          errorClass: null,
          attempts: 1,
          capability: null,
        };
      },
    };
    const runner = new Runner({
      config,
      logger: silentLogger(),
      db,
      world: created.world,
      state,
      scenario,
      source: source as never,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    });
    const loop = runner.run();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && state.day < 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runner.requestStop('shutdown');
    await loop;

    expect(wroteWill).toBe(true);
    const live = runner.getState();
    expect(live.wills.size).toBe(1);
    const reloaded = loadState(db, readWorld(db, created.world.id)!);
    expect(reloaded.wills.size).toBe(1);
    // The live state and its hash must match what was committed.
    expect(stateHash(live)).toBe(stateHash(reloaded));
    expect(readWorld(db, created.world.id)!.stateHash).toBe(stateHash(live));
    db.close();
  }, 60_000);

  it('applies a tax-rate command to the staged boundary, not the live state (R5)', async () => {
    const { Runner } = await import('../../src/runtime/runner.js');
    const { readWorld, loadState } = await import('../../src/storage/repositories.js');
    const dir = tempDir('tidehaven-policy-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Policy',
      seed: 'policy-stage',
      populationTarget: 120,
      hostCeiling: 500,
      drama: 'calm',
    });
    const state = loadState(db, created.world);
    const commandId = enqueueCommand(db, created.world.id, 'set_setting', { key: 'incomeTaxBps', value: 1_777 });
    const source = {
      mode: 'fixture' as const,
      capability: () => null,
      stats: () => ({ inFlight: 0, terminalFallbacks: 0, decisions: 0, lastErrorClass: null, rateLimitedUntil: null }),
      decide: async (request: { actorId: number }) => ({
        actorId: request.actorId,
        plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
        source: 'model' as const,
        summary: '',
        fallbackReason: null,
        usage: { promptTokens: 1, completionTokens: 1, estimateOnly: true },
        latencyMs: 1,
        errorClass: null,
        attempts: 1,
        capability: null,
      }),
    };
    const runner = new Runner({
      config,
      logger: silentLogger(),
      db,
      world: created.world,
      state,
      scenario,
      source: source as never,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    });
    const loop = runner.run();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && state.day < 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runner.requestStop('shutdown');
    await loop;

    expect(state.policies.get('incomeTaxBps')).toBe(1_777);
    const reloaded = loadState(db, readWorld(db, created.world.id)!);
    expect(reloaded.policies.get('incomeTaxBps')).toBe(1_777);
    expect(db.get<{ status: string }>('select status from operator_commands where id = ?', [commandId])?.status).toBe(
      'applied',
    );
    db.close();
  }, 60_000);

  it('keeps the committed hash identical after checkpoint and backup bookkeeping (R6)', async () => {
    const { Runner } = await import('../../src/runtime/runner.js');
    const { readWorld, readRunFlag } = await import('../../src/storage/repositories.js');
    const { stateHash } = await import('../../src/domain/hash.js');
    const dir = tempDir('tidehaven-artifacts-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    config.defaults.storage.checkpointIntervalDays = 1;
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Artifacts',
      seed: 'artifact-flags',
      populationTarget: 120,
      hostCeiling: 500,
      drama: 'calm',
    });
    const state = loadState(db, created.world);
    const source = {
      mode: 'fixture' as const,
      capability: () => null,
      stats: () => ({ inFlight: 0, terminalFallbacks: 0, decisions: 0, lastErrorClass: null, rateLimitedUntil: null }),
      decide: async (request: { actorId: number }) => ({
        actorId: request.actorId,
        plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
        source: 'model' as const,
        summary: '',
        fallbackReason: null,
        usage: { promptTokens: 1, completionTokens: 1, estimateOnly: true },
        latencyMs: 1,
        errorClass: null,
        attempts: 1,
        capability: null,
      }),
    };
    const runner = new Runner({
      config,
      logger: silentLogger(),
      db,
      world: created.world,
      state,
      scenario,
      source: source as never,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    });
    const loop = runner.run();
    const deadline = Date.now() + 20_000;
    // Stop as soon as day 1's post-commit artifact helpers have recorded their bookkeeping.
    while (Date.now() < deadline && readRunFlag(db, created.world.id, 'lastBackupDay') === null) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runner.requestStop('shutdown');
    await loop;

    const stored = readWorld(db, created.world.id)!;
    expect(stored.stateHash).toBe(stateHash(state));
    // Bookkeeping lives outside authoritative state but survives a restart.
    expect(state.counters.has('lastCheckpointDay')).toBe(false);
    expect(state.counters.has('lastBackupDay')).toBe(false);
    expect(readRunFlag(db, created.world.id, 'lastCheckpointDay')).toBe(1);
    expect(readRunFlag(db, created.world.id, 'lastBackupDay')).toBe(1);
    db.close();
  }, 60_000);
});

describe('storage headroom is reserved before collection (R7)', () => {
  it('pauses before any paid dispatch when normal growth would exceed the budget', async () => {
    const { Runner } = await import('../../src/runtime/runner.js');
    const dir = tempDir('tidehaven-headroom-');
    // Fill the data directory so only a small amount of budget remains.
    writeFileSync(join(dir, 'filler.bin'), Buffer.alloc(2 * 1024 * 1024));
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    config.defaults.storage.budgetBytes = 4 * 1024 * 1024;
    config.defaults.storage.minFreeBytes = 1;
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Headroom',
      seed: 'headroom',
      populationTarget: 120,
      hostCeiling: 500,
      drama: 'calm',
    });
    const state = (await import('../../src/storage/repositories.js')).loadState(db, created.world);
    let calls = 0;
    const source = {
      mode: 'fixture' as const,
      capability: () => null,
      stats: () => ({ inFlight: 0, terminalFallbacks: 0, decisions: 0, lastErrorClass: null, rateLimitedUntil: null }),
      decide: async (request: { actorId: number }) => {
        calls += 1;
        return {
          actorId: request.actorId,
          plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
          source: 'model' as const,
          summary: '',
          fallbackReason: null,
          usage: { promptTokens: 1, completionTokens: 1, estimateOnly: true },
          latencyMs: 1,
          errorClass: null,
          attempts: 1,
          capability: null,
        };
      },
    };
    const runner = new Runner({
      config,
      logger: silentLogger(),
      db,
      world: created.world,
      state,
      scenario,
      source: source as never,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    });
    const loop = runner.run();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && runner.snapshot().paused === null) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runner.requestStop('shutdown');
    await loop;
    expect(runner.snapshot().paused?.reason).toBe('storage_budget');
    expect(calls).toBe(0);
    expect(state.day).toBe(0);
    db.close();
  }, 60_000);
});

describe('provider profile keys agree and probing discovers plain JSON (R8)', () => {
  it('maps the API root and the resolved endpoint to one profile key', async () => {
    const { profileKey, readCapability, writeCapability } = await import('../../src/model/capabilities.js');
    expect(profileKey('https://api.example.com/v1', 'm')).toBe(profileKey('https://api.example.com/v1/chat/completions', 'm'));
    expect(profileKey('https://api.example.com/v1/chat/completions/', 'm')).toBe(
      profileKey('https://api.example.com/v1', 'm'),
    );
    const town = await seedTown({ seed: 'profiles' });
    writeCapability(town.db, { baseUrl: 'https://api.example.com/v1', model: 'm', capability: 'json_schema' });
    expect(readCapability(town.db, 'https://api.example.com/v1/chat/completions', 'm')).toBe('json_schema');
    town.db.close();
  }, 30_000);

  it('discovers plain JSON when both structured modes are rejected, bounded to three requests', async () => {
    const { probeProvider } = await import('../../src/model/probe.js');
    const { readCapability } = await import('../../src/model/capabilities.js');
    const town = await seedTown({ seed: 'probe-plain' });
    provider = await startFakeProvider();
    provider.enqueue(
      { kind: 'http_error', status: 400, body: JSON.stringify({ error: { message: 'response_format json_schema unsupported' } }) },
      { kind: 'http_error', status: 400, body: JSON.stringify({ error: { message: 'response_format unsupported' } }) },
      { kind: 'completion', content: JSON.stringify({ ok: true }) },
    );
    const config = loadConfig({ env: { TIDEHAVEN_API_BASE_URL: provider.url, TIDEHAVEN_API_KEY: 'k', TIDEHAVEN_MODEL: 'm' } });
    const result = await probeProvider(config, silentLogger(), { db: town.db });
    expect(result.ok).toBe(true);
    expect(result.capability).toBe('plain_json');
    expect(result.requests).toBe(3);
    expect(provider.count()).toBe(3);
    // Persisted under the same key the runtime lookup uses (the API root, not the endpoint suffix).
    expect(readCapability(town.db, config.provider.baseUrl, config.provider.model)).toBe('plain_json');
    town.db.close();
  }, 30_000);
});

describe('collection feeds every eligible actor without overflowing the queue (R9)', () => {
  it('dispatches every adult when the population exceeds the pool window', async () => {
    const { Runner } = await import('../../src/runtime/runner.js');
    const { isAdult } = await import('../../src/domain/clock.js');
    const dir = tempDir('tidehaven-window-');
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: dir }, fixtureProvider: true });
    config.defaults.model.concurrency = 2;
    config.defaults.model.queueCapacity = 4;
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Window',
      seed: 'window',
      populationTarget: 120,
      hostCeiling: 500,
      drama: 'calm',
    });
    const state = (await import('../../src/storage/repositories.js')).loadState(db, created.world);
    const nextDay = state.day + 1;
    const eligible = [...state.residents.values()]
      .filter((resident) => resident.status === 'living' && isAdult(resident.bornDay, nextDay, scenario.calendar))
      .map((resident) => resident.id);
    expect(eligible.length).toBeGreaterThan(6);

    const seen: number[] = [];
    const source = {
      mode: 'fixture' as const,
      capability: () => null,
      stats: () => ({ inFlight: 0, terminalFallbacks: 0, decisions: 0, lastErrorClass: null, rateLimitedUntil: null }),
      decide: async (request: { actorId: number }) => {
        seen.push(request.actorId);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          actorId: request.actorId,
          plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
          source: 'model' as const,
          summary: '',
          fallbackReason: null,
          usage: { promptTokens: 1, completionTokens: 1, estimateOnly: true },
          latencyMs: 1,
          errorClass: null,
          attempts: 1,
          capability: null,
        };
      },
    };
    const runner = new Runner({
      config,
      logger: silentLogger(),
      db,
      world: created.world,
      state,
      scenario,
      source: source as never,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    });
    const loop = runner.run();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && state.day < nextDay) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    runner.requestStop('shutdown');
    await loop;

    expect(state.day).toBe(nextDay);
    expect([...new Set(seen)].sort((a, b) => a - b)).toEqual(eligible);
    const queueFull = db.all<{ actor_id: number }>(
      "select actor_id from jobs where world_id = ? and day = ? and fallback_reason = 'queue_full'",
      [created.world.id, nextDay],
    );
    expect(queueFull).toEqual([]);
    db.close();
  }, 60_000);
});

describe('uncertain dispatches keep their reserved spend (R10)', () => {
  it('does not release the output allowance when a dispatched request times out', async () => {
    const town = await seedTown({ seed: 'uncertain' });
    provider = await startFakeProvider();
    const logger = silentLogger();
    const usage = new UsageTracker({
      db: town.db,
      worldId: town.worldId,
      ceilings: {
        dailyTokens: null,
        monthlyTokens: null,
        dailyRequests: null,
        monthlyRequests: null,
        monthlyResetDayOfMonth: 1,
        monthlyResetUtcHour: 0,
      },
      logger,
    });
    const client = new ModelClient({
      baseUrl: provider.url,
      apiKey: 'k',
      model: 'fake-model',
      timeoutMs: 50,
      maxResponseBytes: 100_000,
      logger,
    });
    const source = new ModelDecisionSource({
      db: town.db,
      client,
      logger,
      usage,
      state: town.state,
      scenario,
      model: 'fake-model',
      capability: 'json_object',
      maxDispatches: 1,
      maxInputTokens: 3_000,
      maxOutputTokens: 200,
      retryBaseDelayMs: 5,
      maxRetryDelayMs: 10,
      sleep: async () => undefined,
    });
    const actor = livingResidents(town.state)[0]!;
    const prompt = buildActorPrompt({
      state: town.state,
      scenario,
      resident: actor,
      day: 1,
      memories: [],
      events: [],
      maxBytes: 4_096,
      maxRecords: 3,
    });
    provider.enqueue({ kind: 'delay', ms: 500, then: { kind: 'completion', content: plan } });
    const outcome = await source.decide({ day: 1, actorId: actor.id, prompt, schema: planJsonSchema() });
    expect(outcome.errorClass).toBe('timeout');

    const snapshot = usage.snapshot();
    // The reserved ceiling is retained: the full output allowance remains booked for an uncertain call.
    expect(snapshot.tokensToday).toBeGreaterThanOrEqual(200);
    town.db.close();
  }, 30_000);
});

describe('TIDEHAVEN_MAX_OUTPUT_TOKENS overrides the output allowance', () => {
  it('applies a valid value and rejects an out-of-range one', () => {
    const config = loadConfig({ env: { TIDEHAVEN_MAX_OUTPUT_TOKENS: '4000' } });
    expect(config.defaults.model.maxOutputTokens).toBe(4000);
    expect(() => loadConfig({ env: { TIDEHAVEN_MAX_OUTPUT_TOKENS: '10' } })).toThrow(/MAX_OUTPUT_TOKENS/);
  });
});
