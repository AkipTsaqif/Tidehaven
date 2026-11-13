import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { jobMarketPhase } from '../../src/domain/economy/job-market.js';
import { activeEmploymentContract } from '../../src/domain/economy/employment.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { planSchema, type ActorPlan, type PrimaryAction } from '../../src/contracts/actions.js';
import type { WorldState } from '../../src/domain/state.js';

function plan(actorId: number, primary: PrimaryAction): ActorPlan {
  return { actorId, plan: { primary, social: null, orders: [], intents: [], summary: '' }, source: 'model', summary: '' };
}

function jobOf(state: WorldState, residentId: number, day: number): number | null {
  return activeEmploymentContract(state, day, residentId)?.businessId ?? null;
}

/** A business with a free place, and the number of free places. */
function openPlace(state: WorldState, kind: string): { id: number; free: number } {
  const business = [...state.businesses.values()].find((b) => b.kind === kind && b.status === 'open')!;
  const building = state.buildings.get(business.buildingId!)!;
  const staff = [...state.contracts.values()].filter(
    (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === business.id,
  ).length;
  return { id: business.id, free: building.capacity - staff };
}

async function town() {
  const town = await seedTown({ seed: 'job-choice' });
  // Payroll reserves must never decide these tests, so give every business five days of its highest
  // wage. Moved from the treasury through the ledger: the money supply stays conserved.
  const ctx = createTurnContext({ state: town.state, scenario: town.scenario, day: 0 });
  const reserve = Math.max(...Object.values(town.scenario.economy.wages)) * 10;
  for (const business of town.state.businesses.values()) {
    if (business.ownerType === 'town') continue;
    ctx.transfer({ from: { type: 'treasury', id: 0 }, to: { type: 'business', id: business.id }, cents: reserve, reason: 'test_reserve' });
  }
  return town;
}

describe('residents choose their workplace', () => {
  it('accepts seek_work with a businessId and quit_job in the action schema', () => {
    expect(planSchema.parse({ primary: { kind: 'seek_work', businessId: 3 } }).primary).toMatchObject({ kind: 'seek_work', businessId: 3 });
    expect(planSchema.parse({ primary: { kind: 'quit_job' } }).primary?.kind).toBe('quit_job');
  });

  it('lets an employed resident switch to a business with a free place', async () => {
    const t = await town();
    try {
      const worker = [...t.state.residents.values()].find((r) => jobOf(t.state, r.id, 1) !== null)!;
      const from = jobOf(t.state, worker.id, 1)!;
      const target = [...t.state.businesses.values()].find((b) => b.id !== from && openPlace(t.state, b.kind).free > 0 && b.status === 'open')!;
      const ctx = createTurnContext({ state: t.state, scenario: t.scenario, day: 1 });
      const report = jobMarketPhase(ctx, new Map([[worker.id, plan(worker.id, { kind: 'seek_work', businessId: target.id })]]));
      expect(report).toMatchObject({ applied: 1, hired: 1, switched: 1 });
      expect(jobOf(t.state, worker.id, 1)).toBe(target.id);
      expect(ctx.events.some((e) => e.kind === 'employment_switched')).toBe(true);
    } finally {
      t.db.close();
    }
  });

  it('keeps the current job when the application is refused', async () => {
    const t = await town();
    try {
      const worker = [...t.state.residents.values()].find((r) => jobOf(t.state, r.id, 1) !== null)!;
      const from = jobOf(t.state, worker.id, 1)!;
      const target = [...t.state.businesses.values()].find((b) => b.id !== from && b.status === 'open')!;
      t.state.buildings.get(target.buildingId!)!.capacity = 0; // full
      const ctx = createTurnContext({ state: t.state, scenario: t.scenario, day: 1 });
      const actorPlan = plan(worker.id, { kind: 'seek_work', businessId: target.id });
      const report = jobMarketPhase(ctx, new Map([[worker.id, actorPlan]]));
      expect(report).toMatchObject({ applied: 1, hired: 0, rejected: 1 });
      expect(jobOf(t.state, worker.id, 1)).toBe(from);
      expect(actorPlan.fallbackReason).toBe('application_premises_full');
    } finally {
      t.db.close();
    }
  });

  it('quits, and is not handed straight back a job by automatic hiring that day', async () => {
    const t = await town();
    try {
      const worker = [...t.state.residents.values()].find((r) => jobOf(t.state, r.id, 1) !== null)!;
      const plans = new Map<number, ActorPlan>();
      for (const r of t.state.residents.values()) {
        if (r.status === 'living' && isAdult(r.bornDay, 1, t.scenario.calendar)) plans.set(r.id, plan(r.id, { kind: 'work' }));
      }
      plans.set(worker.id, plan(worker.id, { kind: 'quit_job' }));
      const result = runDay({ state: t.state, scenario: t.scenario, day: 1, plans });
      expect(result.invariants.violations).toEqual([]);
      expect(result.reports.jobs.quit).toBe(1);
      expect(jobOf(t.state, worker.id, 1)).toBeNull();
      expect(result.ctx.events.some((e) => e.kind === 'employment_quit' && e.actorId === worker.id)).toBe(true);
    } finally {
      t.db.close();
    }
  });

  it('fills the last place by resident id, whatever order the replies arrived in', async () => {
    const outcome = async (reverse: boolean) => {
      const t = await town();
      try {
        const farm = openPlace(t.state, 'farm');
        const building = t.state.buildings.get(t.state.businesses.get(farm.id)!.buildingId!)!;
        building.capacity -= farm.free - 1; // exactly one free place
        const applicants = [...t.state.residents.values()]
          .filter((r) => isAdult(r.bornDay, 1, t.scenario.calendar) && jobOf(t.state, r.id, 1) !== farm.id)
          .slice(0, 3);
        const entries = applicants.map((r) => [r.id, plan(r.id, { kind: 'seek_work', businessId: farm.id })] as const);
        const ctx = createTurnContext({ state: t.state, scenario: t.scenario, day: 1 });
        jobMarketPhase(ctx, new Map(reverse ? [...entries].reverse() : entries));
        return applicants.filter((r) => jobOf(t.state, r.id, 1) === farm.id).map((r) => r.id);
      } finally {
        t.db.close();
      }
    };
    const forward = await outcome(false);
    const backward = await outcome(true);
    expect(forward).toHaveLength(1);
    expect(backward).toEqual(forward);
  });

  it('shows adults a bounded public job board with pay and shortages, and children none', async () => {
    const t = await town();
    try {
      const adult = [...t.state.residents.values()].find((r) => isAdult(r.bornDay, 1, t.scenario.calendar))!;
      const child = [...t.state.residents.values()].find((r) => !isAdult(r.bornDay, 1, t.scenario.calendar))!;
      const prompt = (resident: typeof adult) =>
        buildActorPrompt({ state: t.state, scenario: t.scenario, resident, day: 1, memories: [], events: [], maxBytes: 24_000, maxRecords: 3 }).user;
      const text = prompt(adult);
      expect(text).toContain('JOB BOARD');
      expect(text).toContain('quit_job');
      const board = JSON.parse(text.split('JOB BOARD (open places)\n')[1]!.split('\n')[0]!) as { wageCents: number; freePlaces: number }[];
      expect(board.length).toBeGreaterThan(0);
      expect(board.length).toBeLessThanOrEqual(12);
      for (const listing of board) {
        expect(listing.freePlaces).toBeGreaterThan(0);
        expect(listing.wageCents).toBeGreaterThan(0);
      }
      expect(prompt(child)).not.toContain('JOB BOARD');
    } finally {
      t.db.close();
    }
  });
});
