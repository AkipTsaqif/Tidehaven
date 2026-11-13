import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { emptyDevelopmentState } from '../../src/domain/development-types.js';
import { stateHash } from '../../src/domain/hash.js';
import { readWorld, loadState, saveState } from '../../src/storage/repositories.js';
import { developmentViolations } from '../../src/domain/development-invariants.js';

function snapshot(day: number, hash: string) {
  return { events: [], ledger: [], flows: [], observations: [], memories: [], taxRecords: [], shipping: [], articles: [],
    metrics: { day, metrics: {}, stateHash: hash }, phase: 'committed', stateHash: hash };
}

describe('development persistence envelope', () => {
  it('preserves a consumed project sequence even when no projects remain', async () => {
    const town = await seedTown({ seed: 'development-sequence' });
    try {
      const before = stateHash(town.state);
      town.state.development = emptyDevelopmentState(9);
      const hash = stateHash(town.state);
      expect(hash).not.toBe(before);
      saveState(town.db, town.state, snapshot(town.state.day, hash));
      const loaded = loadState(town.db, readWorld(town.db)!);
      expect(loaded.development.nextId).toBe(9);
      expect(stateHash(loaded)).toBe(hash);
    } finally { town.db.close(); }
  });

  it('rejects an unsafe project sequence in the daily invariant gate', async () => {
    const town = await seedTown({ seed: 'development-invalid' });
    try {
      town.state.development.nextId = Infinity;
      expect(developmentViolations(town.state)).toContainEqual({ code: 'development_invalid', detail: 'invalid project sequence' });
    } finally { town.db.close(); }
  });
});

describe('retired projects', () => {
  it('stay on disk as archived rows and do not come back on reload', async () => {
    const town = await seedTown({ seed: 'development-archive' });
    try {
      const project = {
        id: 1, kind: 'workplace', status: 'cancelled', sponsorId: 1, ownerType: 'resident', ownerId: 1,
        authorizedBy: null, businessKind: 'farm', targetBuildingId: 1, targetBusinessId: null, targetHouseholdId: null,
        targetOwnerType: 'resident', targetOwnerId: 1, targetCapacity: 0, capacityDelta: 2, requiredLabour: 100,
        appliedLabour: 0, requiredMaterials: {}, securedMaterials: {}, materialLots: [], constructionCostCents: 0,
        startupCapitalCents: 0, startupEscrowId: 3_000_001, startedDay: 0, completedDay: null, cancelledDay: 0,
        cancellationReason: 'test',
      } as never;
      town.state.development = emptyDevelopmentState(2);
      town.state.development.projects.set(1, project);
      saveState(town.db, town.state, snapshot(town.state.day, stateHash(town.state)));
      town.state.development.projects.delete(1);
      const hash = stateHash(town.state);
      saveState(town.db, town.state, snapshot(town.state.day, hash));
      const loaded = loadState(town.db, readWorld(town.db)!);
      expect(loaded.development.projects.size).toBe(0);
      expect(stateHash(loaded)).toBe(hash);
      expect(town.db.get<{ archived: number }>('select archived from construction_projects where id = 1')?.archived).toBe(1);
    } finally { town.db.close(); }
  });
});
