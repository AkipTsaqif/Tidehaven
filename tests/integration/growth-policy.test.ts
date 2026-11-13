import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoLegacyTown } from '../../src/application/legacy-data.js';
import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../../src/config.js';
import { loadScenario } from '../../src/application/scenario.js';
import { createTown } from '../../src/application/bootstrap.js';
import { openDatabase, type Db } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { loadState, readWorld } from '../../src/storage/repositories.js';
import { stateHash, stateSnapshot } from '../../src/domain/hash.js';
import { population, type WorldState } from '../../src/domain/state.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { populationPressurePhase } from '../../src/domain/society/population.js';
import { pairEligibility } from '../../src/domain/society/relationships.js';
import { pendingCommands } from '../../src/storage/commands-repo.js';
import { createServer } from '../../src/http/server.js';
import { registerRoutes } from '../../src/http/routes.js';
import { SseHub } from '../../src/http/sse.js';
import { silentLogger } from '../../src/runtime/telemetry.js';

function town(options: { policy?: boolean; target?: number; ceiling?: number } = {}): {
  db: Db;
  state: WorldState;
  worldId: number;
} {
  const scenario = loadScenario(process.cwd());
  const db = openDatabase(':memory:');
  migrate(db);
  const created = createTown({
    db,
    scenario,
    worldName: 'Growth policy test',
    seed: 'growth-policy-test',
    populationTarget: options.target ?? 120,
    populationPolicyEnabled: options.policy ?? true,
    hostCeiling: options.ceiling ?? 500,
    drama: 'calm',
  });
  return { db, state: loadState(db, created.world), worldId: created.world.id };
}

describe('optional population policy', () => {
  it('defaults to enabled, persists disabled, and keeps legacy-enabled hashes compatible', () => {
    const enabled = town({ policy: true });
    const disabled = town({ policy: false });
    try {
      expect(enabled.state.populationPolicyEnabled).toBe(true);
      expect(disabled.state.populationPolicyEnabled).toBe(false);
      expect(stateSnapshot(enabled.state)).not.toHaveProperty('populationPolicyEnabled');
      expect(stateSnapshot(disabled.state)).toHaveProperty('populationPolicyEnabled', false);
      expect(stateHash(loadState(enabled.db, readWorld(enabled.db)!))).toBe(stateHash(enabled.state));
      expect(stateHash(loadState(disabled.db, readWorld(disabled.db)!))).toBe(stateHash(disabled.state));
      expect(stateHash(enabled.state)).not.toBe(stateHash(disabled.state));
    } finally {
      enabled.db.close();
      disabled.db.close();
    }
  });

  it('removes target pressure when disabled but still enforces the host ceiling', () => {
    const { db, state } = town({ policy: false, target: 2, ceiling: 500 });
    try {
      const scenario = loadScenario(process.cwd());
      const ctx = createTurnContext({ state, scenario, day: 1 });
      const report = populationPressurePhase(ctx, scenario);
      expect(report.overTarget).toBe(false);
      expect(state.counters.get('pressureDays')).toBe(0);

      const mother = [...state.residents.values()].find((resident) => resident.sex === 'female' && resident.partnerId !== null)!;
      const father = state.residents.get(mother.partnerId!)!;
      state.populationTarget = population(state);
      state.populationPolicyEnabled = true;
      expect(pairEligibility(ctx, 'conception', mother, father)).toBe('population_target_reached');
      state.populationPolicyEnabled = false;
      expect(pairEligibility(ctx, 'conception', mother, father)).not.toBe('population_target_reached');
      state.hostCeiling = population(state);
      expect(pairEligibility(ctx, 'conception', mother, father)).toBe('population_ceiling_reached');
    } finally {
      db.close();
    }
  });

  it('queues the boundary-applied policy control', async () => {
    const { db, worldId } = town();
    const config = loadConfig({ env: { TIDEHAVEN_DATA_DIR: 'data/growth-policy-test' }, fixtureProvider: true });
    const sse = new SseHub();
    const server = await createServer({
      config,
      logger: silentLogger(),
      version: 'test',
      readStatus: async () => ({}) as never,
      registerExtraRoutes: async (app) =>
        registerRoutes(app, {
          db,
          worldId,
          logger: silentLogger(),
          sse,
          runnerSnapshot: () => null,
          requestPause: () => undefined,
          requestResume: () => undefined,
          version: 'test',
        }),
    });
    try {
      const session = await server.app.inject({ method: 'GET', url: '/api/session' });
      const token = (session.json() as { csrfToken: string }).csrfToken;
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/controls/population-policy',
        payload: { enabled: false },
        headers: { origin: 'http://127.0.0.1:4317', 'x-tidehaven-csrf': token },
      });
      expect(response.statusCode).toBe(202);
      expect(pendingCommands(db, worldId)[0]?.kind).toBe('set_population_policy');
      expect(pendingCommands(db, worldId)[0]?.payload).toEqual({ enabled: false });
    } finally {
      await server.close();
      db.close();
    }
  });

  it('validates founding policy and host-ceiling environment overrides', () => {
    expect(loadConfig({ env: {} }).defaults.simulation.populationPolicyEnabled).toBe(true);
    expect(loadConfig({ env: { TIDEHAVEN_POPULATION_POLICY: 'disabled' } }).populationPolicyOverride).toBe(false);
    expect(loadConfig({ env: { TIDEHAVEN_POPULATION_POLICY: 'soft_target', TIDEHAVEN_HOST_CEILING: '1000000' } }).defaults.simulation.hostCeiling).toBe(1_000_000);
    expect(() => loadConfig({ env: { TIDEHAVEN_POPULATION_POLICY: 'invalid' } })).toThrow(ConfigError);
    expect(() => loadConfig({ env: { TIDEHAVEN_HOST_CEILING: '0' } })).toThrow(ConfigError);
    expect(() => loadConfig({ env: { TIDEHAVEN_HOST_CEILING: '1000001' } })).toThrow(ConfigError);
    expect(() => loadConfig({ env: { TIDEHAVEN_HOST_CEILING: '2.5' } })).toThrow(ConfigError);
  });
});

describe('default data directory', () => {
  it('puts each scenario in its own folder under data/ unless TIDEHAVEN_DATA_DIR is set', () => {
    const root = loadConfig({ env: {} }).projectRoot;
    expect(loadConfig({ env: {} }).dataDir).toBe(join(root, 'data', 'tidehaven'));
    expect(loadConfig({ env: { TIDEHAVEN_SCENARIO: 'eden' } }).dataDir).toBe(join(root, 'data', 'eden'));
    expect(loadConfig({ env: { TIDEHAVEN_SCENARIO: 'eden' } }).dataDirExplicit).toBe(false);
    const custom = loadConfig({ env: { TIDEHAVEN_SCENARIO: 'eden', TIDEHAVEN_DATA_DIR: 'D:/towns/one' } });
    expect(custom.dataDir).toBe('D:/towns/one');
    expect(custom.dataDirExplicit).toBe(true);
  });

  it('refuses to start fresh while an unmoved town sits at the old location', () => {
    const root = mkdtempSync(join(tmpdir(), 'tidehaven-legacy-'));
    try {
      mkdirSync(join(root, 'config'));
      copyFileSync(join(process.cwd(), 'config', 'defaults.json'), join(root, 'config', 'defaults.json'));
      mkdirSync(join(root, 'data'));
      writeFileSync(join(root, 'data', 'tidehaven.sqlite'), '');
      const config = loadConfig({ env: {}, root });
      expect(() => assertNoLegacyTown(config)).toThrow(/old data location/);
      // An explicit folder, or a town already moved into data/<scenario>, is fine.
      expect(() => assertNoLegacyTown(loadConfig({ env: { TIDEHAVEN_DATA_DIR: join(root, 'data') }, root }))).not.toThrow();
      mkdirSync(join(root, 'data', 'tidehaven'));
      writeFileSync(join(root, 'data', 'tidehaven', 'tidehaven.sqlite'), '');
      expect(() => assertNoLegacyTown(config)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
