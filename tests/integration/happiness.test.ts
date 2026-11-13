import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadScenario } from '../../src/application/scenario.js';
import { loadState } from '../../src/storage/repositories.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { stateHash } from '../../src/domain/hash.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { effectiveLabour } from '../../src/domain/economy/employment.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import {
  buildHappinessContext, moodConceptionPercent, moodEmigrationBps, moodJoinsProtest, moodLabel, scoreHappiness,
} from '../../src/domain/society/happiness.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import type { Scenario } from '../../src/contracts/scenario.js';
import type { WorldState } from '../../src/domain/state.js';

function workPlans(state: WorldState, scenario: Scenario, day: number): Map<number, ActorPlan> {
  const plans = new Map<number, ActorPlan>();
  for (const r of state.residents.values()) {
    if (r.status !== 'living' || !isAdult(r.bornDay, day, scenario.calendar)) continue;
    plans.set(r.id, { actorId: r.id, plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' }, source: 'model', summary: '' });
  }
  return plans;
}

function eden() {
  const scenario = loadScenario(process.cwd(), 'scenarios/eden.json');
  const db = openDatabase(':memory:');
  migrate(db);
  const created = createTown({ db, scenario, worldName: 'Eden', seed: 'happiness', populationTarget: 120, populationPolicyEnabled: false, hostCeiling: 500, drama: 'calm' });
  return { db, scenario, state: loadState(db, created.world) };
}

describe('happiness score', () => {
  it('starts near neutral, explains itself, and drops with hunger and grievances', async () => {
    const town = await seedTown({ seed: 'happiness-score' });
    try {
      const adult = [...town.state.residents.values()].find((r) => isAdult(r.bornDay, 1, town.scenario.calendar))!;
      const before = scoreHappiness(buildHappinessContext(town.state, 1), adult, town.scenario.calendar);
      expect(before.score).toBeGreaterThanOrEqual(40);
      expect(Object.keys(before.factors).sort()).toEqual(['family', 'food', 'friends', 'grievances', 'health', 'home', 'money', 'work']);
      adult.hungerDays = 4;
      town.state.grievances.set(9_999, { id: 9_999, residentId: adult.id, kind: 'hunger', severity: 80, sinceDay: 0, untilDay: null, reason: 'test' });
      const after = scoreHappiness(buildHappinessContext(town.state, 1), adult, town.scenario.calendar);
      expect(after.score).toBeLessThan(before.score - 30);
      expect(after.factors.food).toBeLessThan(0);
      expect(after.factors.grievances).toBeLessThan(0);
      expect(moodLabel(10)).toBe('miserable');
      expect(moodLabel(90)).toBe('thriving');
    } finally {
      town.db.close();
    }
  });

  it('is always within 0-100', async () => {
    const town = await seedTown({ seed: 'happiness-bounds' });
    try {
      const resident = [...town.state.residents.values()][0]!;
      resident.hungerDays = 100;
      resident.healthState = 'injured';
      for (let i = 0; i < 5; i += 1) {
        town.state.grievances.set(8_000 + i, { id: 8_000 + i, residentId: resident.id, kind: `k${i}`, severity: 100, sinceDay: 0, untilDay: null, reason: 'test' });
      }
      const { score } = scoreHappiness(buildHappinessContext(town.state, 1), resident, town.scenario.calendar);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    } finally {
      town.db.close();
    }
  });
});

describe('display-only towns (no growth rules)', () => {
  it('show mood in the prompt but store nothing and keep every rule unchanged', async () => {
    const town = await seedTown({ seed: 'happiness-display' });
    try {
      for (let day = 1; day <= 5; day += 1) await town.step();
      for (const resident of town.state.residents.values()) expect(resident.health.happiness).toBeUndefined();
      const ctx = createTurnContext({ state: town.state, scenario: town.scenario, day: 6 });
      const adult = [...town.state.residents.values()].find((r) => r.status === 'living' && isAdult(r.bornDay, 6, town.scenario.calendar))!;
      adult.health.happiness = 5; // even a stale value must not leak into the rules
      expect(moodEmigrationBps(ctx, adult)).toBe(0);
      expect(moodJoinsProtest(ctx, adult)).toBe(false);
      expect(moodConceptionPercent(ctx, adult, adult)).toBe(100);
      delete adult.health.happiness;
      const prompt = buildActorPrompt({ state: town.state, scenario: town.scenario, resident: adult, day: 6, memories: [], events: [], maxBytes: 24_000, maxRecords: 3 });
      expect(prompt.user).toContain('"mood":');
      expect(prompt.user).toContain('"feeling"');
    } finally {
      town.db.close();
    }
  }, 60_000);

  it('produce the same state as before for the same decisions (no hidden rule change)', async () => {
    // Two identical runs must agree, and no resident carries a happiness value: the hash inputs are
    // exactly the pre-happiness ones.
    const run = async () => {
      const town = await seedTown({ seed: 'happiness-replay' });
      try {
        for (let day = 1; day <= 8; day += 1) await town.step();
        return { hash: stateHash(town.state), stored: [...town.state.residents.values()].some((r) => 'happiness' in r.health) };
      } finally {
        town.db.close();
      }
    };
    const a = await run();
    const b = await run();
    expect(a.hash).toBe(b.hash);
    expect(a.stored).toBe(false);
  }, 60_000);
});

describe('growth towns feel their happiness', () => {
  it('stores a score each day and records it in the daily metrics', () => {
    const { db, scenario, state } = eden();
    try {
      const result = runDay({ state, scenario, day: 1, plans: workPlans(state, scenario, 1) });
      expect(result.invariants.violations).toEqual([]);
      for (const r of state.residents.values()) {
        if (r.status === 'living') expect(typeof r.health.happiness).toBe('number');
      }
      expect(result.metrics.happinessAverage).toBeGreaterThan(0);
      expect(result.metrics).toHaveProperty('happinessMiserable');
    } finally {
      db.close();
    }
  });

  it('lowers work effort when miserable and raises it a little when thriving', () => {
    const { db, scenario, state } = eden();
    try {
      const ctx = createTurnContext({ state, scenario, day: 1 });
      const adam = [...state.residents.values()].find((r) => r.name === 'Adam')!;
      const plan = workPlans(state, scenario, 1).get(adam.id);
      adam.health.happiness = 50;
      const normal = effectiveLabour(ctx, adam, plan);
      adam.health.happiness = 10;
      expect(effectiveLabour(ctx, adam, plan)).toBeLessThan(normal);
      adam.health.happiness = 90;
      expect(effectiveLabour(ctx, adam, plan)).toBeGreaterThan(normal);
      expect(effectiveLabour(ctx, adam, plan)).toBeLessThanOrEqual(Math.ceil(normal * 1.1));
    } finally {
      db.close();
    }
  });

  it('makes only miserable adults consider leaving, and less likely to start a family', () => {
    const { db, scenario, state } = eden();
    try {
      const ctx = createTurnContext({ state, scenario, day: 1 });
      const [adam, eve] = [...state.residents.values()];
      adam!.health.happiness = 60;
      eve!.health.happiness = 60;
      expect(moodEmigrationBps(ctx, adam!)).toBe(0);
      expect(moodConceptionPercent(ctx, adam!, eve!)).toBe(100);
      adam!.health.happiness = 10;
      expect(moodEmigrationBps(ctx, adam!)).toBeGreaterThan(0);
      expect(moodConceptionPercent(ctx, adam!, eve!)).toBeLessThan(100);
      expect(moodJoinsProtest(ctx, adam!)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('lets a miserable adult leave, but never one with a dependent child', () => {
    const { db, scenario, state } = eden();
    try {
      // Make everyone miserable for a long stretch and watch who goes.
      const adam = [...state.residents.values()].find((r) => r.name === 'Adam')!;
      let left = false;
      for (let day = 1; day <= 400 && !left; day += 1) {
        for (const r of state.residents.values()) {
          if (r.status !== 'living') continue;
          r.hungerDays = 9; // keeps the score near 0 after each day's recalculation
        }
        runDay({ state, scenario, day, plans: workPlans(state, scenario, day) });
        left = adam.status === 'emigrated' || [...state.residents.values()].some((r) => r.status === 'emigrated');
      }
      expect(left).toBe(true);
      for (const gone of [...state.residents.values()].filter((r) => r.status === 'emigrated')) {
        const children = [...state.residents.values()].filter(
          (c) => c.status === 'living' && c.guardianId === gone.id && !isAdult(c.bornDay, state.day, scenario.calendar),
        );
        expect(children).toHaveLength(0);
      }
    } finally {
      db.close();
    }
  });
});
