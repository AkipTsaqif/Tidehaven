import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadScenario } from '../../src/application/scenario.js';
import { loadState, readWorld, saveState } from '../../src/storage/repositories.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { stateHash } from '../../src/domain/hash.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import { buildActorPrompt } from '../../src/model/prompts.js';

function plan(actorId: number): ActorPlan {
  return { actorId, plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' }, source: 'model', summary: '' };
}

describe('Eden integrated resource-funded growth', () => {
  it('shares the original home by consent and completes a civic farm extension across reloads', () => {
    const scenario = loadScenario(process.cwd(), 'scenarios/eden.json');
    const db = openDatabase(':memory:');
    migrate(db);
    const created = createTown({ db, scenario, worldName: 'Eden', seed: 'growth-acceptance',
      populationTarget: 2, populationPolicyEnabled: false, hostCeiling: 500, drama: 'calm' });
    let state = loadState(db, created.world);
    let shared = 0;
    let completed = 0;
    let maxGrain = 0;
    let sawCamp = false;
    const original = [...state.buildings.values()].find((b) => b.kind === 'farm')!;
    const oldCapacity = original.capacity;
    const originalHouse = [...state.households.values()][0]!.id;
    try {
      for (let day = 1; day <= 220; day += 1) {
        const plans = new Map<number, ActorPlan>();
        const adam = [...state.residents.values()].find((r) => r.name === 'Adam')!;
        const eve = [...state.residents.values()].find((r) => r.name === 'Eve')!;
        for (const resident of state.residents.values()) {
          if (resident.status !== 'living' || !isAdult(resident.bornDay, day, scenario.calendar)) continue;
          const choice = plan(resident.id);
          // Unanimous host replies are explicit stored choices, not a baseline consent policy.
          const pending = [...state.proposals.values()].find((p) => p.kind === 'settle' && p.status === 'pending');
          if (pending && resident.householdId === originalHouse) choice.plan.social = { kind: 'accept_housing', targetId: pending.id };
          const household = resident.householdId === null ? undefined : state.households.get(resident.householdId);
          if (household?.buildingId === null) {
            sawCamp = true;
            const members = [...state.residents.values()].filter((r) => r.householdId === originalHouse && r.status === 'living').length;
            if (members < state.households.get(originalHouse)!.capacity) {
              choice.plan.social = { kind: 'request_housing', targetId: adam.id };
            } else choice.plan.primary = { kind: 'build_home' };
          }
          // Eve has a civic office at founding. Her explicit project is funded from the public purse.
          if (resident.id === eve.id && day >= 100) {
            const active = [...state.development.projects.values()].find((p) => p.status === 'active' && p.sponsorId === eve.id);
            if (active) choice.plan.primary = { kind: 'work_construction', targetId: active.id };
            else if (completed === 0) choice.plan.primary = { kind: 'expand_building', targetId: original.id, capacityDelta: 4 };
          }
          plans.set(resident.id, choice);
        }
        const result = runDay({ state, scenario, day, plans });
        expect(result.invariants.violations, `day ${day}`).toEqual([]);
        for (const event of result.ctx.events) {
          if (event.kind === 'housing_shared') shared += 1;
          if (event.kind === 'development_completed') completed += 1;
        }
        maxGrain = Math.max(maxGrain, result.reports.production.reports.find((r) => r.kind === 'farm')?.produced.grain ?? 0);
        if (day === 150 || day === 220) {
          saveState(db, state, { events: result.ctx.events, ledger: result.ctx.ledger, flows: result.ctx.flows,
            observations: result.ctx.observations, memories: result.ctx.memories, taxRecords: result.ctx.taxRecords,
            shipping: result.ctx.shipping, articles: [], metrics: { day, metrics: result.metrics, stateHash: stateHash(state) },
            phase: 'committed', stateHash: stateHash(state) });
          const reloaded = loadState(db, readWorld(db)!);
          expect(stateHash(reloaded)).toBe(stateHash(state));
          state = reloaded;
        }
      }
      expect(sawCamp).toBe(true);
      expect(shared).toBeGreaterThanOrEqual(2);
      expect(completed).toBeGreaterThanOrEqual(1);
      expect(state.buildings.get(original.id)!.capacity).toBe(oldCapacity + 4);
      // Capacity alone is not output: with no grain shortage nobody is hired into the new places.
      // Real added production is proven separately in workplace-growth.test.ts.
      expect(maxGrain).toBeGreaterThan(0);
      const members = [...state.residents.values()].filter((r) => r.householdId === originalHouse && r.status === 'living');
      expect(members.length).toBeGreaterThan(2);
      expect([...state.buildings.values()].filter((b) => b.kind === 'home').length).toBeLessThan(state.residents.size - 1);
      const actor = members[0]!;
      const prompt = buildActorPrompt({ state, scenario, resident: actor, day: state.day + 1, memories: [], events: [], maxBytes: 24_000, maxRecords: 20 });
      expect(prompt.user).toContain('request_housing');
      expect(prompt.user).toContain('expand_building');
    } finally { db.close(); }
  });
});
