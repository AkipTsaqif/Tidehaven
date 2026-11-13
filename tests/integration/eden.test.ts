import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadState } from '../../src/storage/repositories.js';
import { loadScenario } from '../../src/application/scenario.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { immigrationGapDays } from '../../src/domain/society/population.js';
import { baselinePlan } from '../../src/model/fallback.js';
import { loadConfig, ConfigError } from '../../src/config.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import type { Scenario } from '../../src/contracts/scenario.js';

/**
 * The two-founder "Eden" scenario: Adam and Eve alone for a settling period, then a slowly opening
 * immigration cadence that shrinks to a weekly floor.
 */

/** The real safe-baseline decisions: work, except that a household with no roof builds one. */
function baselinePlans(scenario: Scenario, state: ReturnType<typeof loadState>, day: number): Map<number, ActorPlan> {
  const plans = new Map<number, ActorPlan>();
  for (const resident of state.residents.values()) {
    if (resident.status !== 'living' || !isAdult(resident.bornDay, day, scenario.calendar)) continue;
    plans.set(resident.id, baselinePlan({ state, scenario, resident, day, reason: 'test' }));
  }
  return plans;
}

function foundEden(scenario: Scenario) {
  const db = openDatabase(':memory:');
  migrate(db);
  const created = createTown({
    db,
    scenario,
    worldName: 'Eden',
    seed: 'eden-test',
    populationTarget: 120,
    hostCeiling: 500,
    drama: 'calm',
  });
  return { db, state: loadState(db, created.world) };
}

describe('eden scenario', () => {
  it('founds a town of exactly Adam and Eve, partnered, in the only house', () => {
    const scenario = loadScenario(process.cwd(), 'scenarios/eden.json');
    const { db, state } = foundEden(scenario);
    try {
      const living = [...state.residents.values()].filter((r) => r.status === 'living');
      expect(living.map((r) => r.name).sort()).toEqual(['Adam', 'Eve']);
      const [adam, eve] = [living.find((r) => r.name === 'Adam')!, living.find((r) => r.name === 'Eve')!];
      expect(adam.partnerId).toBe(eve.id);
      expect(eve.partnerId).toBe(adam.id);
      expect(adam.householdId).toBe(eve.householdId);
      expect([...state.buildings.values()].filter((b) => b.kind === 'home')).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('keeps newcomers away for the settling period, then shrinks the gap to a weekly floor', () => {
    const scenario = loadScenario(process.cwd(), 'scenarios/eden.json');
    const rules = scenario.immigration!;
    const { db, state } = foundEden(scenario);
    try {
      const arrivals: number[] = [];
      const until = rules.startDay + 200;
      for (let day = 1; day <= until; day += 1) {
        const result = runDay({ state, scenario, day, plans: baselinePlans(scenario, state, day) });
        expect(result.invariants.ok, `invariants on day ${day}`).toBe(true);
        for (const event of result.ctx.events) if (event.kind === 'immigrant_arrived') arrivals.push(day);
      }
      // Nobody arrives before the settling period ends; the first newcomer comes on its last day.
      expect(arrivals[0]).toBe(rules.startDay);
      const gaps = arrivals.slice(1).map((day, index) => day - arrivals[index]!);
      // A gap is never shorter than the schedule (28, 25, 22, ... 7). It may be longer when every camp
      // slot is taken and the town must finish building before it can receive anyone else.
      gaps.forEach((gap, index) => expect(gap).toBeGreaterThanOrEqual(immigrationGapDays(rules, index + 1)));
      expect(gaps.slice(0, 3)).toEqual([28, 25, 22]);
      expect(Math.min(...gaps)).toBe(rules.minIntervalDays);
      // The first newcomers settle in a home of their own, not with the founders.
      const founders = [...state.residents.values()].filter((r) => r.origin === 'founder');
      const firstImmigrant = [...state.residents.values()].find((r) => r.origin === 'immigrant')!;
      expect(firstImmigrant.householdId).not.toBe(founders[0]!.householdId);
    } finally {
      db.close();
    }
  });

  it('computes the gap schedule and validates the cadence', () => {
    const rules = { startDay: 90, initialIntervalDays: 28, minIntervalDays: 7, stepDays: 3 };
    expect([1, 2, 3, 7, 8, 50].map((n) => immigrationGapDays(rules, n))).toEqual([28, 25, 22, 10, 7, 7]);
    const base = loadScenario(process.cwd(), 'scenarios/eden.json');
    expect(base.immigration).toEqual(rules);
  });

  it('leaves the default scenario on the legacy 5-day cadence', () => {
    const scenario = loadScenario(process.cwd());
    expect(scenario.immigration).toBeUndefined();
  });

  it('selects the scenario by name and rejects paths', () => {
    expect(loadConfig({ env: {} }).scenarioFile).toBe('scenarios/tidehaven.json');
    expect(loadConfig({ env: { TIDEHAVEN_SCENARIO: 'eden' } }).scenarioFile).toBe('scenarios/eden.json');
    expect(() => loadConfig({ env: { TIDEHAVEN_SCENARIO: '../secrets' } })).toThrow(ConfigError);
  });
});
