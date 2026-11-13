import { describe, expect, it } from 'vitest';
import { createTown } from '../../src/application/bootstrap.js';
import { loadScenario } from '../../src/application/scenario.js';
import { resumeScenario } from '../../src/application/saved-scenario.js';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { hashValue } from '../../src/domain/hash.js';

describe('stored gameplay rules on resume', () => {
  it('uses the stored exact scenario rather than changing an existing town with an edited file', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    try {
      const scenario = loadScenario(process.cwd(), 'scenarios/eden.json');
      const { world } = createTown({ db, scenario, worldName: 'Saved', seed: 'snapshot', populationTarget: 120, hostCeiling: 500, drama: 'calm' });
      const edited = structuredClone(scenario);
      edited.economy.recipes.farm!.outputs.grain = 9_999;
      expect(hashValue(resumeScenario(db, world, edited))).toBe(hashValue(scenario));
      expect(resumeScenario(db, world, edited).economy.recipes.farm!.outputs.grain).not.toBe(9_999);
    } finally { db.close(); }
  });

  it('rejects switching scenario family and corrupt stored rules without resetting state', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    try {
      const scenario = loadScenario(process.cwd());
      const { world } = createTown({ db, scenario, worldName: 'Saved', seed: 'snapshot', populationTarget: 120, hostCeiling: 500, drama: 'calm' });
      expect(() => resumeScenario(db, world, { ...scenario, version: 'other-family' })).toThrow(/scenario/);
      db.run('update rules_versions set scenario_json = ? where version = ?', ['{}', world.rulesVersion]);
      expect(() => resumeScenario(db, world, scenario)).toThrow(/stored|snapshot|rules/i);
      expect(db.get<{ total: number }>('select count(*) as total from residents')?.total).toBe(25);
    } finally { db.close(); }
  });
});
