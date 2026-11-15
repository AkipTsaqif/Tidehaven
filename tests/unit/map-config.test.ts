import { describe, expect, it } from 'vitest';
import { loadConfig, ConfigError } from '../../src/config.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadScenario } from '../../src/application/scenario.js';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { loadState, readWorld, saveState } from '../../src/storage/repositories.js';
import { mapView } from '../../src/application/map-query.js';
import { stateHash } from '../../src/domain/hash.js';

const scenario = loadScenario(process.cwd());
describe('landscape environment settings', () => {
  it('accepts every biome and terrain with compatible defaults', () => {
    expect(loadConfig({ env: {} }).foundingMap).toEqual({ biome: 'auto', terrain: 'island' });
    for (const biome of ['auto', 'tropical', 'temperate', 'arid', 'northern']) {
      for (const terrain of ['auto', 'island', 'coast', 'river_plain']) {
        expect(loadConfig({ env: { TIDEHAVEN_BIOME: biome, TIDEHAVEN_TERRAIN: terrain } }).foundingMap).toEqual({ biome, terrain });
      }
    }
    expect(loadConfig({ env: { TIDEHAVEN_BIOME: ' ARID ', TIDEHAVEN_TERRAIN: ' Coast ' } }).foundingMap).toEqual({ biome: 'arid', terrain: 'coast' });
  });
  it('rejects typos instead of silently switching landscapes', () => {
    expect(() => loadConfig({ env: { TIDEHAVEN_BIOME: 'desert' } })).toThrow(ConfigError);
    expect(() => loadConfig({ env: { TIDEHAVEN_TERRAIN: 'rivers' } })).toThrow(ConfigError);
  });
});

describe('founding-only landscape persistence', () => {
  it('persists resolved metadata and keeps it through state saves, reloads and changed environment', () => {
    const db = openDatabase(':memory:'); migrate(db);
    try {
      const created = createTown({ db, scenario, worldName: 'Snowplain', seed: 'persist-map', populationTarget: 120,
        hostCeiling: 500, drama: 'calm', mapOptions: { biome: 'northern', terrain: 'river_plain' } });
      const stored = readWorld(db)!;
      expect(stored.configJson).toBe(created.world.configJson);
      expect(JSON.parse(stored.configJson)).toMatchObject({ map: { biome: 'northern', terrain: 'river_plain' }, calendar: scenario.calendar });
      const state = loadState(db, stored);
      const hash = stateHash(state);
      saveState(db, state, { events: [], ledger: [], flows: [], observations: [], memories: [], taxRecords: [], shipping: [], articles: [], metrics: null, phase: 'idle', stateHash: hash });
      loadConfig({ env: { TIDEHAVEN_BIOME: 'arid', TIDEHAVEN_TERRAIN: 'coast' } });
      expect(readWorld(db)!.configJson).toBe(stored.configJson);
      const writes = db.get<{ n: number }>('select total_changes() as n')!.n;
      expect(mapView(db, stored.id)).toMatchObject({ biome: 'northern', terrainShape: 'river_plain' });
      expect(db.get<{ n: number }>('select total_changes() as n')!.n).toBe(writes);
      expect(stateHash(loadState(db, readWorld(db)!))).toBe(hash);
      expect(() => createTown({ db, scenario, worldName: 'Replacement', seed: 'no', populationTarget: 120,
        hostCeiling: 500, drama: 'calm', mapOptions: { biome: 'arid', terrain: 'coast' } })).toThrow(/already exists/);
    } finally { db.close(); }
  });

  it('stores auto as actual choices, not a reroll-on-restart instruction', () => {
    const db = openDatabase(':memory:'); migrate(db);
    try {
      const { world } = createTown({ db, scenario, worldName: 'Auto', seed: 'auto-map', populationTarget: 120,
        hostCeiling: 500, drama: 'calm', mapOptions: { biome: 'auto', terrain: 'auto' } });
      const map = JSON.parse(world.configJson).map as { biome: string; terrain: string };
      expect(map.biome).not.toBe('auto'); expect(map.terrain).not.toBe('auto');
      expect(mapView(db, world.id)).toMatchObject({ biome: map.biome, terrainShape: map.terrain });
    } finally { db.close(); }
  });
});
