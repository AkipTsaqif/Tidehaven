import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadState, readWorld, saveState } from '../../src/storage/repositories.js';
import { loadScenario } from '../../src/application/scenario.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { stateHash } from '../../src/domain/hash.js';
import { quantityOf, type WorldState } from '../../src/domain/state.js';
import { baselinePlan } from '../../src/model/fallback.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { planSchema, type ActorPlan } from '../../src/contracts/actions.js';
import type { Scenario } from '../../src/contracts/scenario.js';

/**
 * Home construction: residents may choose build_home, a home costs labour-days and timber, and
 * newcomers with no vacant home camp and build their own.
 */

function eden(overrides: Partial<NonNullable<Scenario['construction']>> = {}, noImmigration = true): Scenario {
  const base = loadScenario(process.cwd(), 'scenarios/eden.json');
  return {
    ...base,
    construction: { ...base.construction!, ...overrides },
    // Keep newcomers away unless a test wants them, so the founders' choices are the only variable.
    immigration: noImmigration ? { ...base.immigration!, startDay: 36_500 } : base.immigration,
  };
}

function found(scenario: Scenario) {
  const db = openDatabase(':memory:');
  migrate(db);
  const created = createTown({ db, scenario, worldName: 'Eden', seed: 'build', populationTarget: 120, hostCeiling: 500, drama: 'calm' });
  return { db, state: loadState(db, created.world) };
}

function plans(scenario: Scenario, state: WorldState, day: number, builders: Set<string> = new Set()): Map<number, ActorPlan> {
  const out = new Map<number, ActorPlan>();
  for (const resident of state.residents.values()) {
    if (resident.status !== 'living' || !isAdult(resident.bornDay, day, scenario.calendar)) continue;
    const plan = baselinePlan({ state, scenario, resident, day, reason: 'test' });
    if (builders.has(resident.name)) plan.plan.primary = { kind: 'build_home' };
    out.set(resident.id, plan);
  }
  return out;
}

const homes = (state: WorldState) => [...state.buildings.values()].filter((b) => b.kind === 'home');
const sites = (state: WorldState) => [...state.buildings.values()].filter((b) => b.kind === 'home_site');
const timberStock = (state: WorldState) =>
  [...state.inventories.entries()].filter(([key]) => key.endsWith(':timber')).reduce((sum, [, units]) => sum + units, 0);

describe('home construction', () => {
  it('accepts build_home as a primary action in the plan schema', () => {
    expect(planSchema.parse({ primary: { kind: 'build_home' } }).primary?.kind).toBe('build_home');
  });

  it('builds a home from labour and timber only when a resident chooses to', () => {
    const scenario = eden({ labourDays: 4, timberUnits: 2, fellPerDay: 1 });
    const { db, state } = found(scenario);
    try {
      // Nobody chooses to build: the town keeps its single cottage.
      for (let day = 1; day <= 20; day += 1) runDay({ state, scenario, day, plans: plans(scenario, state, day) });
      expect(homes(state)).toHaveLength(1);
      expect(sites(state)).toHaveLength(0);

      // Adam builds. Timber is bought from stock or felled by hand (felling days add no building work).
      const before = timberStock(state);
      const events: string[] = [];
      let day = 21;
      for (; day <= 60 && homes(state).length < 2; day += 1) {
        const result = runDay({ state, scenario, day, plans: plans(scenario, state, day, new Set(['Adam'])) });
        expect(result.invariants.ok, `invariants on day ${day}`).toBe(true);
        for (const event of result.ctx.events) events.push(event.kind);
      }
      expect(events).toContain('construction_started');
      expect(events).toContain('home_built');
      const built = homes(state).find((b) => b.builtDay > 0)!;
      expect(built.capacity).toBe(scenario.construction!.homeCapacity);
      expect(sites(state)).toHaveLength(0);
      // 4 labour-days at 70% of a day each: it cannot finish faster than the work allows.
      expect(day - 21).toBeGreaterThanOrEqual(Math.ceil((4 * 100) / 70));
      // Timber was felled (no stock change) or bought out of someone's stock: never created.
      expect(timberStock(state)).toBeLessThanOrEqual(before + 50);
    } finally {
      db.close();
    }
  });

  it('uses the household timber stock before buying', () => {
    const scenario = eden({ labourDays: 2, timberUnits: 3 });
    const { db, state } = found(scenario);
    try {
      const household = [...state.households.values()][0]!;
      // Seed the stock through the ledger-free bootstrap path: inventories plus the goods base.
      state.inventories.set(`household:${household.id}:timber`, 3);
      for (let day = 1; day <= 10 && homes(state).length < 2; day += 1) {
        runDay({ state, scenario, day, plans: plans(scenario, state, day, new Set(['Adam', 'Eve'])) });
      }
      expect(homes(state)).toHaveLength(2);
      expect(quantityOf(state, 'household', household.id, 'timber')).toBe(0);
      expect(state.accounts.get(`household:${household.id}`)!.balanceCents).toBeGreaterThanOrEqual(0);
    } finally {
      db.close();
    }
  });

  it('lets a newcomer arrive with no vacant home, camp, build, and move in', () => {
    const scenario = eden({}, false);
    const { db, state } = found(scenario);
    try {
      let camped = false;
      let movedIn = false;
      for (let day = 1; day <= 200; day += 1) {
        const result = runDay({ state, scenario, day, plans: plans(scenario, state, day) });
        expect(result.invariants.ok, `invariants on day ${day}`).toBe(true);
        if ([...state.households.values()].some((h) => h.dissolvedDay === null && h.buildingId === null)) camped = true;
        if (result.ctx.events.some((e) => e.kind === 'home_built' && (e.detail as { householdId?: number | null }).householdId)) {
          movedIn = true;
        }
      }
      expect(camped).toBe(true);
      expect(movedIn).toBe(true);
      // Nobody moved in with Adam and Eve.
      const founders = [...state.residents.values()].filter((r) => r.origin === 'founder');
      const immigrants = [...state.residents.values()].filter((r) => r.origin === 'immigrant' && r.status === 'living');
      expect(immigrants.length).toBeGreaterThan(0);
      for (const immigrant of immigrants) expect(immigrant.householdId).not.toBe(founders[0]!.householdId);
    } finally {
      db.close();
    }
  });

  it('waits when every camp slot is taken instead of letting newcomers pile up roofless', () => {
    const scenario = eden({ maxCamps: 1, labourDays: 3_000 }, false);
    const { db, state } = found(scenario);
    try {
      for (let day = 1; day <= 250; day += 1) runDay({ state, scenario, day, plans: plans(scenario, state, day) });
      const camps = [...state.households.values()].filter((h) => h.dissolvedDay === null && h.buildingId === null);
      expect(camps).toHaveLength(1);
      expect([...state.residents.values()].filter((r) => r.origin === 'immigrant')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('rejects build_home in a scenario without construction rules', () => {
    const scenario = loadScenario(process.cwd());
    const { db, state } = found(scenario);
    try {
      const first = [...state.residents.values()].find((r) => isAdult(r.bornDay, 1, scenario.calendar))!;
      const result = runDay({ state, scenario, day: 1, plans: plans(scenario, state, 1, new Set([first.name])) });
      expect(result.reports.construction.rejected).toBe(1);
      expect(sites(state)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('persists a half-built site and reloads it with the same hash', () => {
    const scenario = eden({ labourDays: 6, timberUnits: 0 });
    const { db, state } = found(scenario);
    try {
      for (let day = 1; day <= 3; day += 1) {
        const result = runDay({ state, scenario, day, plans: plans(scenario, state, day, new Set(['Adam'])) });
        saveState(db, state, {
          events: result.ctx.events,
          ledger: result.ctx.ledger,
          flows: result.ctx.flows,
          observations: result.ctx.observations,
          memories: result.ctx.memories,
          taxRecords: result.ctx.taxRecords,
          shipping: result.ctx.shipping,
          articles: [],
          metrics: { day, metrics: result.metrics, stateHash: stateHash(state) },
          phase: 'committed',
          stateHash: stateHash(state),
        });
      }
      expect(sites(state)).toHaveLength(1);
      const reloaded = loadState(db, readWorld(db)!);
      expect(stateHash(reloaded)).toBe(stateHash(state));
    } finally {
      db.close();
    }
  });

  it('tells residents about housing only in construction scenarios', () => {
    const scenario = eden();
    const { db, state } = found(scenario);
    const plain = loadScenario(process.cwd());
    const town = found(plain);
    try {
      const adam = [...state.residents.values()].find((r) => r.name === 'Adam')!;
      const prompt = buildActorPrompt({ state, scenario, resident: adam, day: 1, memories: [], events: [], maxBytes: 8_192, maxRecords: 3 });
      expect(prompt.user).toContain('HOUSING');
      expect(prompt.user).toContain('build_home');
      const someone = [...town.state.residents.values()][0]!;
      const other = buildActorPrompt({ state: town.state, scenario: plain, resident: someone, day: 1, memories: [], events: [], maxBytes: 8_192, maxRecords: 3 });
      expect(other.user).not.toContain('HOUSING');
    } finally {
      db.close();
      town.db.close();
    }
  });
});
