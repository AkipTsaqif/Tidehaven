import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { isAdult } from '../../src/domain/clock.js';
import type { ActorPlan } from '../../src/contracts/actions.js';

async function collectPlans(town: Awaited<ReturnType<typeof seedTown>>, day: number): Promise<Map<number, ActorPlan>> {
  const plans = new Map<number, ActorPlan>();
  for (const resident of town.state.residents.values()) {
    if (resident.status !== 'living') continue;
    if (!isAdult(resident.bornDay, day, town.scenario.calendar)) continue;
    const prompt = buildActorPrompt({
      state: town.state,
      scenario: town.scenario,
      resident,
      day,
      memories: [],
      events: [],
      maxBytes: 4096,
      maxRecords: 3,
    });
    const outcome = await town.source.decide({ day, actorId: resident.id, prompt, schema: {} });
    plans.set(resident.id, {
      actorId: resident.id,
      plan: outcome.plan,
      source: outcome.source,
      summary: outcome.summary,
    });
  }
  return plans;
}

describe('determinism', () => {
  it('produces identical state for identical decisions regardless of arrival order', async () => {
    const a = await seedTown({ seed: 'order-test' });
    const b = await seedTown({ seed: 'order-test' });

    for (let day = 1; day <= 12; day += 1) {
      const plansA = await collectPlans(a, day);
      // Rebuild the same decision set in reverse insertion order for the second town.
      const reversed = new Map<number, ActorPlan>([...plansA.entries()].reverse());
      await a.step(plansA);
      await b.step(reversed);
      expect(a.state.day).toBe(b.state.day);
    }

    const rows = a.db.all<{ state_hash: string }>(
      'select state_hash from daily_metrics where world_id = ? order by day desc limit 1',
      [a.worldId],
    );
    const rowsB = b.db.all<{ state_hash: string }>(
      'select state_hash from daily_metrics where world_id = ? order by day desc limit 1',
      [b.worldId],
    );
    expect(rows[0]?.state_hash).toBe(rowsB[0]?.state_hash);
  }, 60_000);

  it('diverges when the seed changes', async () => {
    const a = await seedTown({ seed: 'seed-one' });
    const b = await seedTown({ seed: 'seed-two' });
    for (let day = 1; day <= 5; day += 1) {
      await a.step();
      await b.step();
    }
    const hashA = a.db.get<{ state_hash: string }>(
      'select state_hash from daily_metrics where world_id = ? order by day desc limit 1',
      [a.worldId],
    )?.state_hash;
    const hashB = b.db.get<{ state_hash: string }>(
      'select state_hash from daily_metrics where world_id = ? order by day desc limit 1',
      [b.worldId],
    )?.state_hash;
    expect(hashA).not.toBe(hashB);
  }, 30_000);
});
