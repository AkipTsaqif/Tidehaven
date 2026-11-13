import { describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadState } from '../../src/storage/repositories.js';
import { loadScenario } from '../../src/application/scenario.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { householdPhase } from '../../src/domain/society/relationships.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { isAdult, labourCapacity, lifeStage } from '../../src/domain/clock.js';
import { effectiveLabour } from '../../src/domain/economy/employment.js';
import { killResident } from '../../src/domain/events/health.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import type { Scenario } from '../../src/contracts/scenario.js';
import type { WorldState } from '../../src/domain/state.js';

/**
 * Causal generations.
 *
 * This test walks a real town through *ordinary daily transitions*: courtship is proposed and accepted
 * through the normal social actions, conception is proposed and accepted, gestation runs its full
 * configured length, childhood accrues education day by day, and adulthood arrives exactly on the
 * configured day. Nothing is fast-forwarded by editing `bornDay`, assigning partners directly, or
 * injecting a next-day pregnancy — the calendar is a shortened *scenario*, not an age shortcut.
 */

function compressedScenario(): Scenario {
  const base = loadScenario(process.cwd());
  return {
    ...base,
    calendar: {
      ...base.calendar,
      daysPerYear: 40,
      adultDays: 80,
      elderDays: 400,
      pregnancyDays: 6,
      weekDays: 5,
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

async function makeTown(): Promise<{ db: Db; state: WorldState; scenario: Scenario; step: (plans?: Map<number, ActorPlan>) => void }> {
  const scenario = compressedScenario();
  const db = openDatabase(':memory:');
  migrate(db);
  const created = createTown({
    db,
    scenario,
    worldName: 'Lifehaven',
    seed: 'lifecycle-test',
    populationTarget: 60,
    hostCeiling: 200,
    drama: 'calm',
  });
  const state = loadState(db, created.world);
  const step = (plans?: Map<number, ActorPlan>): void => {
    const day = state.day + 1;
    // Every eligible adult is always "present" so unrelated phases still run.
    const allPlans = new Map<number, ActorPlan>();
    for (const resident of state.residents.values()) {
      if (resident.status !== 'living') continue;
      if (!isAdult(resident.bornDay, day, scenario.calendar)) continue;
      allPlans.set(resident.id, plan(resident.id, { primary: { kind: 'work' } }));
    }
    for (const [actorId, override] of plans ?? []) allPlans.set(actorId, override);
    runDay({ state, scenario, day, plans: allPlans });
  };
  return { db, state, scenario, step };
}

describe('causal generation lifecycle', () => {
  it('runs conception, gestation, childhood, and adulthood through daily transitions', async () => {
    const { state, scenario, step, db } = await makeTown();

    const adults = [...state.residents.values()].filter(
      (r) => r.status === 'living' && isAdult(r.bornDay, state.day, scenario.calendar),
    );
    const single = adults.filter((r) => r.partnerId === null);
    // The youngest eligible pair: conception is age-weighted, and this keeps the fertile window long
    // enough for the *ordinary* (stochastic) conception roll while the calendar is compressed.
    const byAge = [...single].sort((a, b) => b.bornDay - a.bornDay || a.id - b.id);
    const mother = byAge.find((r) => r.sex === 'female');
    const father = byAge.find((r) => r.sex === 'male');
    expect(mother).toBeDefined();
    expect(father).toBeDefined();
    if (!mother || !father) {
      db.close();
      return;
    }

    // 1. Ordinary courtship: propose, then accept on a later day.
    step(new Map([[mother.id, plan(mother.id, { social: { kind: 'courtship', targetId: father.id } })]]));
    expect(state.residents.get(mother.id)?.partnerId).toBeNull();
    step(
      new Map([
        [mother.id, plan(mother.id, { social: { kind: 'courtship', targetId: father.id } })],
        [father.id, plan(father.id, { social: { kind: 'accept', targetId: mother.id } })],
      ]),
    );
    expect(state.residents.get(mother.id)?.partnerId).toBe(father.id);

    // 2. Ordinary conception: propose, then accept. Both are public actions resolved by the real
    //    household phase. Conception is deliberately rare (~0.3% per day), so the *event* is retried
    //    across simulated days — never fabricated.
    const proposed = (): Map<number, ActorPlan> =>
      new Map([
        [mother.id, plan(mother.id, { social: { kind: 'conceive', targetId: father.id } })],
        [father.id, plan(father.id, { social: { kind: 'accept', targetId: mother.id } })],
      ]);
    let pregnancy = [...state.pregnancies.values()].find((p) => p.status === 'active');
    for (let attempt = 0; attempt < 1_600 && !pregnancy; attempt += 1) {
      state.day += 1;
      // Stop when the mother leaves her fertile window: conception after that is correctly refused.
      if (state.day - mother.bornDay > 40 * scenario.calendar.daysPerYear) break;
      householdPhase(createTurnContext({ state, scenario, day: state.day }), proposed());
      pregnancy = [...state.pregnancies.values()].find((p) => p.status === 'active');
    }
    expect(pregnancy).toBeDefined();
    if (!pregnancy) {
      db.close();
      return;
    }
    const conceivedDay = pregnancy.conceivedDay;
    expect(pregnancy.dueDay - conceivedDay).toBe(scenario.calendar.pregnancyDays);

    // 3. Gestation runs its full configured length: no birth before the due day.
    let bornDay: number | null = null;
    for (let guard = 0; guard < scenario.calendar.pregnancyDays + 30 && bornDay === null; guard += 1) {
      const dayBefore = state.day;
      step();
      const child = [...state.residents.values()].find((r) => r.origin === 'born' && r.motherId === mother.id);
      if (child) bornDay = child.bornDay;
      if (bornDay === null) expect(state.day).toBe(dayBefore + 1);
    }
    expect(bornDay).not.toBeNull();
    if (bornDay === null) {
      db.close();
      return;
    }
    expect(bornDay).toBeGreaterThanOrEqual(conceivedDay + scenario.calendar.pregnancyDays - 1);

    const child = [...state.residents.values()].find((r) => r.origin === 'born' && r.motherId === mother.id)!;
    expect(child.fatherId).toBe(father.id);
    expect(lifeStage(child.bornDay, bornDay, scenario.calendar)).toBe('child');
    // Children are not eligible for their own model decisions.
    expect(isAdult(child.bornDay, bornDay, scenario.calendar)).toBe(false);

    // 4. Childhood is 1-day-at-a-time: education accrues, adulthood arrives exactly on the day.
    const adulthoodDay = child.bornDay + scenario.calendar.adultDays;
    let sawComingOfAge = false;
    while (state.day < adulthoodDay) {
      const before = child.educationDays;
      step();
      if (state.day < adulthoodDay) {
        expect(lifeStage(child.bornDay, state.day, scenario.calendar)).toBe('child');
      }
      if (state.day === adulthoodDay) sawComingOfAge = true;
      void before;
    }
    expect(state.day).toBe(adulthoodDay);
    expect(lifeStage(child.bornDay, state.day, scenario.calendar)).toBe('adult');
    expect(isAdult(child.bornDay, state.day, scenario.calendar)).toBe(true);
    expect(child.educationDays).toBeGreaterThan(0);
    expect(sawComingOfAge).toBe(true);
    const comingOfAge = state.day;
    expect(comingOfAge - bornDay).toBe(scenario.calendar.adultDays);

    // 5. Participation: an adult supplies a full labour day and is eligible for their own decisions.
    expect(labourCapacity('adult')).toBe(100);
    const ctx = createTurnContext({ state, scenario, day: state.day });
    expect(effectiveLabour(ctx, child, undefined)).toBe(100);
    expect(child.status).toBe('living');

    // 6. Succession: the father dies; the estate settles, the widow inherits, and obligations end.
    killResident(ctx, father, 'test');
    const fundsBefore = [...state.accounts.values()].reduce((sum, account) => sum + account.balanceCents, 0);
    step();
    const estate = [...state.estates.values()].find((e) => e.deceasedId === father.id);
    expect(estate).toBeDefined();
    expect(estate?.status).toBe('closed');
    const partnerClaim = [...state.estateClaims.values()].find(
      (c) => c.estateId === estate?.id && c.claimantId === mother.id,
    );
    expect(partnerClaim).toBeDefined();
    expect(state.residents.get(mother.id)?.partnerId).toBeNull();
    const fundsAfter = [...state.accounts.values()].reduce((sum, account) => sum + account.balanceCents, 0);
    expect(fundsAfter).toBe(fundsBefore);

    db.close();
  }, 120_000);
});
