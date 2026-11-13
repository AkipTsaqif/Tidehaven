import { openDatabase, type Db } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadState, saveState, type SavePayload } from '../../src/storage/repositories.js';
import { loadScenario } from '../../src/application/scenario.js';
import { MockDecisionSource } from '../../src/model/mock.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { stateHash } from '../../src/domain/hash.js';
import { buildNewspaperDigest } from '../../src/application/newspaper.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import type { WorldState } from '../../src/domain/state.js';
import type { Scenario } from '../../src/contracts/scenario.js';

export interface SeededTown {
  db: Db;
  state: WorldState;
  scenario: Scenario;
  worldId: number;
  source: MockDecisionSource;
  /** Advance one day with scripted decisions and persist it, exactly like the runner does. */
  step(plansOverride?: Map<number, ActorPlan>): Promise<{ metrics: Record<string, unknown>; violations: string[] }>;
}

export async function seedTown(options: { seed?: string; drama?: 'calm' | 'dramatic' | 'volatile'; behaviour?: 'baseline' | 'drama' | 'failing' } = {}): Promise<SeededTown> {
  const scenario = loadScenario(process.cwd());
  const db = openDatabase(':memory:');
  migrate(db);
  const created = createTown({
    db,
    scenario,
    worldName: 'Testhaven',
    seed: options.seed ?? 'test-seed',
    populationTarget: 120,
    hostCeiling: 500,
    drama: options.drama ?? 'dramatic',
  });
  const state = loadState(db, created.world);
  const source = new MockDecisionSource({ state, scenario, behaviour: options.behaviour ?? 'baseline' });

  const step = async (plansOverride?: Map<number, ActorPlan>) => {
    const day = state.day + 1;
    let plans = plansOverride;
    if (!plans) {
      plans = new Map();
      for (const resident of state.residents.values()) {
        if (resident.status !== 'living') continue;
        if (!isAdult(resident.bornDay, day, scenario.calendar)) continue;
        const prompt = buildActorPrompt({ state, scenario, resident, day, memories: [], events: [], maxBytes: 4096, maxRecords: 3 });
        const outcome = await source.decide({ day, actorId: resident.id, prompt, schema: {} });
        plans.set(resident.id, { actorId: resident.id, plan: outcome.plan, source: outcome.source, summary: outcome.summary });
      }
    }
    const result = runDay({ state, scenario, day, plans });
    const article = buildNewspaperDigest(result.ctx, result.ctx.events);
    const payload: SavePayload = {
      events: result.ctx.events,
      ledger: result.ctx.ledger,
      flows: result.ctx.flows,
      observations: result.ctx.observations,
      memories: result.ctx.memories,
      taxRecords: result.ctx.taxRecords,
      shipping: result.ctx.shipping,
      articles: [article],
      metrics: { day, metrics: result.metrics, stateHash: stateHash(state) },
      phase: 'committed',
      stateHash: stateHash(state),
    };
    saveState(db, state, payload);
    return {
      metrics: result.metrics,
      violations: result.invariants.violations.map((v) => `${v.code}: ${v.detail}`),
    };
  };

  return { db, state, scenario, worldId: created.world.id, source, step };
}

export function planFor(actorId: number, overrides: Partial<ActorPlan['plan']> = {}): ActorPlan {
  return {
    actorId,
    plan: { primary: null, social: null, orders: [], intents: [], summary: '', ...overrides },
    source: 'model',
    summary: '',
  };
}
