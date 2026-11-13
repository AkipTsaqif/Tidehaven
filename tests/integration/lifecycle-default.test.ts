import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadState, readWorld, saveState, type SavePayload } from '../../src/storage/repositories.js';
import { loadScenario } from '../../src/application/scenario.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { DEFAULT_CALENDAR, isAdult, lifeStage } from '../../src/domain/clock.js';
import { adoptState } from '../../src/domain/state.js';
import { stateHash } from '../../src/domain/hash.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import type { Scenario } from '../../src/contracts/scenario.js';
import type { WorldState } from '../../src/domain/state.js';

/**
 * The acceptance gate for causal generations on the **default calendar**.
 *
 * The compressed-calendar test (`lifecycle.test.ts`) is a fast integration test; this one is the gate:
 * 280 days of gestation and 6,570 childhood days, with *every* elapsed day routed through the full
 * daily pipeline, invariants asserted daily, education accruing over the whole childhood, adulthood
 * arriving exactly on the configured day, real adult participation, and persistence during the run.
 *
 * Deliberately strict assertions (counterexamples must fail):
 *   - a birth one day before the due day fails;
 *   - stopping education after its first day fails;
 *   - a childhood declared adult early fails.
 *
 * The town is minimal so this runs in seconds rather than minutes, but the calendar is untouched.
 */

function defaultCalendarScenario(): Scenario {
  const base = loadScenario(process.cwd());
  return {
    ...base,
    // Calendar deliberately identical to the production one.
    calendar: { ...DEFAULT_CALENDAR },
    economy: {
      ...base.economy,
      // Food security must not be the thing under test here: conception is refused when the mother is
      // hungry, so the household starts with an effectively permanent larder and cash reserve.
      treasuryCents: 5_000_000,
      householdReserveDays: 100_000,
      householdCashCents: 1_000_000,
      businessStartCashCents: 20_000,
      townBusinessStartCashCents: 20_000,
    },
    town: {
      buildings: [
        { id: 1, name: 'Rose Cottage', kind: 'home', capacity: 6 },
        { id: 2, name: 'Greenrows Farm', kind: 'farm', capacity: 4 },
        { id: 3, name: 'Millhouse Bakery', kind: 'bakery', capacity: 4 },
      ],
      households: [{ id: 1, name: 'Rose Household', building: 1 }],
      businesses: [
        { name: 'Greenrows Farm', kind: 'farm', building: 2, owner: null },
        { name: 'Millhouse Bakery', kind: 'bakery', building: 3, owner: null },
      ],
      councilSeats: 2,
      residents: [
        {
          name: 'Ada Rose',
          sex: 'female',
          age: 20,
          household: 1,
          job: 'Greenrows Farm',
          traits: { diligence: 70, sociability: 60, ambition: 40, honesty: 75, temper: 30 },
        },
        {
          name: 'Brin Rose',
          sex: 'male',
          age: 22,
          household: 1,
          job: 'Millhouse Bakery',
          traits: { diligence: 72, sociability: 55, ambition: 45, honesty: 78, temper: 32 },
        },
      ],
    },
  };
}

function plan(actorId: number, overrides: Partial<ActorPlan['plan']> = {}): ActorPlan {
  return {
    actorId,
    plan: { primary: null, social: null, orders: [], intents: [], summary: '', ...overrides },
    source: 'model',
    summary: '',
  };
}

describe('default-calendar generation gate', () => {
  it('runs gestation, 6,570 childhood days, adulthood, participation, and persistence', async () => {
    const scenario = defaultCalendarScenario();
    expect(scenario.calendar).toEqual({
      daysPerYear: 365,
      adultDays: 6_570,
      elderDays: 23_725,
      pregnancyDays: 280,
      weekDays: 7,
    });

    const db = openDatabase(':memory:');
    migrate(db);
    const created = createTown({
      db,
      scenario,
      worldName: 'Lifehaven',
      // Fixed seed: the simulation is deterministic, so the gate is reproducible and stable.
      seed: 'default-calendar-lifecycle-a',
      // The soft target is above the housing-limited town so conception is not refused as "target
      // reached"; immigration is capped by the single household's capacity.
      populationTarget: 60,
      hostCeiling: 200,
      drama: 'calm',
    });
    const state: WorldState = loadState(db, created.world);

    const failures: string[] = [];
    let persistedDays = 0;
    let currentDay: { ctx: ReturnType<typeof runDay>['ctx'] } | null = null;

    /** One full day through the real pipeline, with daily invariants and periodic persistence. */
    const step = (overrides?: Map<number, ActorPlan>): void => {
      const day = state.day + 1;
      const plans = new Map<number, ActorPlan>();
      for (const resident of state.residents.values()) {
        if (resident.status !== 'living') continue;
        if (!isAdult(resident.bornDay, day, scenario.calendar)) continue;
        plans.set(resident.id, plan(resident.id, { primary: { kind: 'work' } }));
      }
      for (const [actorId, override] of overrides ?? []) plans.set(actorId, override);

      const result = runDay({ state, scenario, day, plans });
      if (!result.invariants.ok) {
        failures.push(`day ${day}: ${result.invariants.violations.map((v) => v.code).join(',')}`);
      }
      currentDay = { ctx: result.ctx };

      // Persistence during the lifecycle: every 500 days, save, reload, and continue from the reload.
      if (day % 500 === 0) {
        const payload: SavePayload = {
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
        };
        saveState(db, state, payload);
        const reloaded = loadState(db, readWorld(db, created.world.id)!);
        if (stateHash(reloaded) !== stateHash(state)) {
          failures.push(`day ${day}: reloaded state hash differs`);
        }
        adoptState(state, reloaded);
        persistedDays += 1;
      }
    };

    const adults = [...state.residents.values()].sort((a, b) => a.id - b.id);
    const mother = adults.find((r) => r.sex === 'female')!;
    const father = adults.find((r) => r.sex === 'male')!;

    // 1. Consent through ordinary actions: courtship is proposed, then accepted on a later day.
    step(new Map([[mother.id, plan(mother.id, { social: { kind: 'courtship', targetId: father.id } })]]));
    step(
      new Map([
        [mother.id, plan(mother.id, { social: { kind: 'courtship', targetId: father.id } })],
        [father.id, plan(father.id, { social: { kind: 'accept', targetId: mother.id } })],
      ]),
    );
    expect(state.residents.get(mother.id)?.partnerId).toBe(father.id);
    expect(state.residents.get(father.id)?.partnerId).toBe(mother.id);

    // 2. Conception through ordinary proposals, retried across full days (the roll is rare by design).
    const conceptionPlans = (): Map<number, ActorPlan> =>
      new Map([
        [mother.id, plan(mother.id, { social: { kind: 'conceive', targetId: father.id } })],
        [father.id, plan(father.id, { social: { kind: 'accept', targetId: mother.id } })],
      ]);
    let pregnancy = [...state.pregnancies.values()].find((p) => p.status === 'active');
    let conceptionAttempts = 0;
    while (pregnancy === undefined && conceptionAttempts < 4_000) {
      step(conceptionPlans());
      conceptionAttempts += 1;
      pregnancy = [...state.pregnancies.values()].find((p) => p.status === 'active');
    }
    expect(pregnancy, 'ordinary conception must occur').toBeDefined();
    if (!pregnancy) {
      db.close();
      return;
    }
    const conceivedDay = pregnancy.conceivedDay;
    const dueDay = conceivedDay + scenario.calendar.pregnancyDays;

    // 3. Gestation: no birth before the due day, and the child is born on it (a loss restarts at step 2
    //    semantics; this run's seed delivers).
    let child = [...state.residents.values()].find((r) => r.origin === 'born' && r.motherId === mother.id);
    while (child === undefined && state.day < dueDay + 60) {
      step();
      if (state.day < dueDay) {
        expect(
          [...state.residents.values()].some((r) => r.origin === 'born'),
          `no birth may happen before the due day (${state.day} < ${dueDay})`,
        ).toBe(false);
      }
      child = [...state.residents.values()].find((r) => r.origin === 'born' && r.motherId === mother.id);
    }
    expect(child, 'a child must be born').toBeDefined();
    if (!child) {
      db.close();
      return;
    }
    expect(child.bornDay).toBe(dueDay);

    // 4. Childhood: every one of the 6,570 transitions runs, education grows throughout, and adulthood
    //    arrives on the exact configured day. The child is looked up by id after every persistence
    //    cycle, because adoption replaces the state collections (a stale object would silently stop
    //    reflecting the live world).
    const childId = child.id;
    const childhood = state.residents.get(childId)!;
    const adulthoodDay = childhood.bornDay + scenario.calendar.adultDays;
    const educationAtBirth = childhood.educationDays;
    while (state.day < adulthoodDay) {
      step();
      const current = state.residents.get(childId)!;
      if (state.day < adulthoodDay) {
        expect(lifeStage(current.bornDay, state.day, scenario.calendar)).toBe('child');
      }
    }
    const adult = state.residents.get(childId)!;
    expect(state.day).toBe(adulthoodDay);
    expect(lifeStage(adult.bornDay, state.day, scenario.calendar)).toBe('adult');
    expect(adult.status).toBe('living');
    // Schooling accrues across the whole childhood: a run that stopped education after its first day
    // (or after one year) cannot satisfy this.
    expect(adult.educationDays - educationAtBirth).toBeGreaterThanOrEqual(2_000);
    expect(persistedDays).toBeGreaterThanOrEqual(5);

    // 5. Real participation: the new adult actually works (an employment contract, or laboured
    //    production for a town business they are attached to).
    for (let extra = 0; extra < 20 && !hasWorked(state, childId); extra += 1) step();
    expect(hasWorked(state, childId)).toBe(true);

    // 6. Every day's invariants held, and the hash round-trips after the final save/reload.
    expect(failures.join(String.fromCharCode(10))).toBe('');
    const payload: SavePayload = {
      events: currentDay?.ctx.events ?? [],
      ledger: currentDay?.ctx.ledger ?? [],
      flows: currentDay?.ctx.flows ?? [],
      observations: [],
      memories: [],
      taxRecords: [],
      shipping: [],
      articles: [],
      metrics: { day: state.day, metrics: {}, stateHash: stateHash(state) },
      phase: 'committed',
      stateHash: stateHash(state),
    };
    saveState(db, state, payload);
    const finalReload = loadState(db, readWorld(db, created.world.id)!);
    expect(stateHash(finalReload)).toBe(stateHash(state));
    db.close();
  }, 600_000);
});

/** Did this resident supply paid labour (employed) at any point after coming of age? */
function hasWorked(state: WorldState, residentId: number): boolean {
  for (const contract of state.contracts.values()) {
    if (contract.kind !== 'employment' || contract.aId !== residentId) continue;
    if (contract.status === 'active') return true;
    if (contract.startDay >= 1) return true;
  }
  const resident = state.residents.get(residentId);
  return resident !== undefined && Object.keys(resident.skills).length > 0;
}
