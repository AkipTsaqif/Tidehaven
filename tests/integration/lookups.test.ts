import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadState } from '../../src/storage/repositories.js';
import { loadScenario } from '../../src/application/scenario.js';
import { MockDecisionSource } from '../../src/model/mock.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { activeEmploymentContract } from '../../src/domain/economy/employment.js';
import {
  activeEmploymentByBusiness,
  activeEmploymentByResident,
  buildObservationLookups,
  livingMembersByHousehold,
  residentsWithActiveEmployment,
} from '../../src/domain/lookups.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import { emptyState, type Contract, type WorldState } from '../../src/domain/state.js';

const root = join(import.meta.dirname, '..', '..');

/** The full scans the lookups replace, written exactly as the original call sites wrote them. */
function assertLookupsMatchScans(state: WorldState, day: number): void {
  const members = livingMembersByHousehold(state);
  for (const household of state.households.values()) {
    const scanned = [...state.residents.values()].filter((r) => r.householdId === household.id && r.status === 'living');
    expect((members.get(household.id) ?? []).map((r) => r.id)).toEqual(scanned.map((r) => r.id));
  }

  const employment = activeEmploymentByResident(state, day);
  const employed = residentsWithActiveEmployment(state);
  for (const resident of state.residents.values()) {
    expect(employment.get(resident.id) ?? null).toBe(activeEmploymentContract(state, day, resident.id));
    const scanned = [...state.contracts.values()].some(
      (c) => c.kind === 'employment' && c.status === 'active' && c.aId === resident.id,
    );
    expect(employed.has(resident.id)).toBe(scanned);
  }

  const staff = activeEmploymentByBusiness(state);
  for (const business of state.businesses.values()) {
    const scanned = [...state.contracts.values()].filter(
      (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === business.id,
    );
    expect((staff.get(business.id) ?? []).map((c) => c.id)).toEqual(scanned.map((c) => c.id));
  }
}

async function driveTown(scenarioName: string, days: number, check: (state: WorldState, day: number) => void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'tidehaven-lookups-'));
  try {
    const scenario = loadScenario(root, `scenarios/${scenarioName}.json`);
    const db = openDatabase(join(dir, 'tidehaven.sqlite'));
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Lookups',
      seed: `lookups-${scenarioName}`,
      populationTarget: 120,
      populationPolicyEnabled: scenario.growth?.populationPolicyEnabled ?? true,
      hostCeiling: 500,
      drama: 'volatile',
    });
    const state = loadState(db, created.world);
    const source = new MockDecisionSource({ state, scenario, behaviour: 'drama', dramaRateBps: 3_000 });
    for (let day = 1; day <= days; day += 1) {
      check(state, day);
      const plans = new Map<number, ActorPlan>();
      for (const resident of state.residents.values()) {
        if (resident.status !== 'living' || !isAdult(resident.bornDay, day, scenario.calendar)) continue;
        const prompt = buildActorPrompt({ state, scenario, resident, day, memories: [], events: [], maxBytes: 24_000, maxRecords: 20 });
        const outcome = await source.decide({ day, actorId: resident.id, prompt, schema: {} });
        plans.set(resident.id, { actorId: resident.id, plan: outcome.plan, source: outcome.source, summary: outcome.summary });
      }
      const result = runDay({ state, scenario, day, plans });
      expect(result.invariants.ok).toBe(true);
    }
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('employment lookups on edge-case contracts', () => {
  const contract = (id: number, overrides: Partial<Contract>): Contract => ({
    id,
    kind: 'employment',
    aId: 1,
    bId: 10,
    businessId: 10,
    terms: {},
    startDay: 1,
    endDay: null,
    status: 'active',
    ...overrides,
  });
  const state = emptyState({
    worldId: 1, name: 'Edge', seed: 'edge', rulesVersion: 'v1', drama: 'calm', populationTarget: 10, hostCeiling: 100,
  });
  // Resident 1: an expired contract first, then two live ones — the first live one must win.
  state.contracts.set(1, contract(1, { endDay: 4 }));
  state.contracts.set(2, contract(2, { businessId: 11 }));
  state.contracts.set(3, contract(3, { businessId: 12 }));
  // Resident 2: only ended / non-employment contracts.
  state.contracts.set(4, contract(4, { aId: 2, status: 'ended' }));
  state.contracts.set(5, contract(5, { aId: 2, kind: 'tenancy' }));
  // Resident 3: active but expired; resident 4: active, ends today (still employed).
  state.contracts.set(6, contract(6, { aId: 3, endDay: 9 }));
  state.contracts.set(7, contract(7, { aId: 4, endDay: 10 }));
  // A contract with no business.
  state.contracts.set(8, contract(8, { aId: 5, businessId: null }));

  it('returns the same contract as activeEmploymentContract for every resident', () => {
    const lookup = activeEmploymentByResident(state, 10);
    for (const id of [1, 2, 3, 4, 5, 6]) {
      expect(lookup.get(id) ?? null).toBe(activeEmploymentContract(state, 10, id));
    }
    expect(lookup.get(1)?.id).toBe(2);
    expect(lookup.has(3)).toBe(false);
    expect(lookup.get(4)?.id).toBe(7);
  });

  it('counts any active employment regardless of end day for the unemployment check', () => {
    expect([...residentsWithActiveEmployment(state)].sort()).toEqual([1, 3, 4, 5]);
  });

  it('groups active staff by business in contract order and skips contracts with no business', () => {
    const staff = activeEmploymentByBusiness(state);
    expect(staff.get(10)?.map((c) => c.id)).toEqual([1, 6, 7]);
    expect(staff.get(11)?.map((c) => c.id)).toEqual([2]);
    expect([...staff.keys()].sort()).toEqual([10, 11, 12]);
  });
});

describe('lookup tables match the scans they replace', () => {
  it('agrees with full scans every day of a dramatic Tidehaven run (hiring, layoffs, deaths, moves)', async () => {
    await driveTown('tidehaven', 200, assertLookupsMatchScans);
  }, 60_000);

  it('agrees with full scans in Eden (camps, shared housing, construction)', async () => {
    await driveTown('eden', 200, assertLookupsMatchScans);
  }, 60_000);

  it('produces byte-identical prompts with shared lookups, per-prompt lookups, and none', async () => {
    const scenario = loadScenario(root, 'scenarios/tidehaven.json');
    await driveTown('tidehaven', 60, (state, day) => {
      const shared = buildObservationLookups(state, day);
      for (const resident of state.residents.values()) {
        if (resident.status !== 'living') continue;
        const base = { state, scenario, resident, day, memories: [], events: [], maxBytes: 24_000, maxRecords: 20 };
        const withShared = buildActorPrompt({ ...base, lookups: shared });
        const withoutLookups = buildActorPrompt(base);
        expect(withShared).toEqual(withoutLookups);
      }
    });
  }, 60_000);

  it('ignores lookups built for a different day or state instead of reusing stale facts', async () => {
    const scenario = loadScenario(root, 'scenarios/tidehaven.json');
    await driveTown('tidehaven', 3, (state, day) => {
      const resident = [...state.residents.values()].find((r) => r.status === 'living')!;
      const base = { state, scenario, resident, day, memories: [], events: [], maxBytes: 24_000, maxRecords: 20 };
      const stale = { ...buildObservationLookups(state, day), membersByHousehold: new Map(), employmentByResident: new Map() };
      // Same state object but a different day: must be rebuilt, not trusted.
      expect(buildActorPrompt({ ...base, lookups: { ...stale, day: day + 1 } })).toEqual(buildActorPrompt(base));
      // Same day but a different state object: must be rebuilt, not trusted.
      expect(buildActorPrompt({ ...base, lookups: { ...stale, state: { ...state } } })).toEqual(buildActorPrompt(base));
    });
  }, 60_000);
});
