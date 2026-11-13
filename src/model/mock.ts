import type { Plan } from '../contracts/actions.js';
import type { Scenario } from '../contracts/scenario.js';
import type { WorldState } from '../domain/state.js';
import { balanceOf } from '../domain/state.js';
import { baselinePlan } from './fallback.js';
import type { DecisionOutcome, DecisionRequest, DecisionSource } from './jobs.js';

/**
 * In-process scripted decision source: no network, no credentials, no cost.
 *
 * Used by `npm run test:soak`, the Playwright suite, and unit/integration tests. It is deterministic
 * (seeded by day and actor) and deliberately exercises drama paths: occasional courtship, quarrel,
 * theft, and protest calls, so the rules are not only reachable by hand-written tests.
 */

export type MockBehaviour = 'baseline' | 'drama' | 'failing';

export interface MockOptions {
  state: WorldState;
  scenario: Scenario;
  behaviour?: MockBehaviour;
  /** 0..10000: how often a drama action is attempted when behaviour is 'drama'. */
  dramaRateBps?: number;
  onDecision?: (outcome: DecisionOutcome) => void;
}

export class MockDecisionSource implements DecisionSource {
  readonly mode = 'fixture' as const;
  private readonly options: MockOptions;
  private inFlight = 0;
  private decisions = 0;
  private terminalFallbacks = 0;

  constructor(options: MockOptions) {
    this.options = options;
  }

  capability(): null {
    return null;
  }

  stats() {
    return {
      inFlight: this.inFlight,
      terminalFallbacks: this.terminalFallbacks,
      decisions: this.decisions,
      lastErrorClass: null,
      rateLimitedUntil: null,
    };
  }

  async decide(request: DecisionRequest): Promise<DecisionOutcome> {
    this.inFlight += 1;
    this.decisions += 1;
    try {
      const resident = this.options.state.residents.get(request.actorId);
      if (!resident) throw new Error(`unknown resident ${request.actorId}`);
      const behaviour = this.options.behaviour ?? 'baseline';

      if (behaviour === 'failing') {
        this.terminalFallbacks += 1;
        const fallback = baselinePlan({
          state: this.options.state,
          scenario: this.options.scenario,
          resident,
          day: request.day,
          reason: 'mock_failure',
        });
        return {
          actorId: request.actorId,
          plan: fallback.plan,
          source: 'fallback',
          summary: fallback.summary,
          fallbackReason: 'mock_failure',
          usage: { promptTokens: 100, completionTokens: 20, estimateOnly: true },
          latencyMs: 1,
          errorClass: 'server',
          attempts: 1,
          capability: null,
        };
      }

      const plan = this.buildPlan(request, behaviour);
      return {
        actorId: request.actorId,
        plan,
        source: 'model',
        summary: plan.summary,
        fallbackReason: null,
        usage: { promptTokens: Math.ceil(request.prompt.bytes / 4), completionTokens: 60, estimateOnly: true },
        latencyMs: 2,
        errorClass: null,
        attempts: 1,
        capability: null,
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  private buildPlan(request: DecisionRequest, behaviour: MockBehaviour): Plan {
    const { state, scenario } = this.options;
    const resident = state.residents.get(request.actorId);
    if (!resident) throw new Error('missing resident');
    const base = baselinePlan({
      state,
      scenario,
      resident,
      day: request.day,
      reason: 'mock',
    });
    const plan: Plan = { ...base.plan, orders: [...base.plan.orders], intents: [] };
    plan.summary = 'Scripted resident plan.';
    if (behaviour !== 'drama') return plan;

    // Deterministic pseudo-random from day + actor.
    const seed = (request.day * 2_654_435_761 + request.actorId * 40_503) >>> 0;
    const roll = seed % 10_000;
    const rate = this.options.dramaRateBps ?? 800;
    if (roll >= rate) return plan;

    const adults = [...state.residents.values()]
      .filter((r) => r.status === 'living' && r.id !== resident.id && r.bornDay <= request.day - scenario.calendar.adultDays)
      .sort((a, b) => a.id - b.id);
    const other = adults[seed % Math.max(1, adults.length)];
    const partner = resident.partnerId === null ? null : state.residents.get(resident.partnerId);
    if (partner && partner.status === 'living' && resident.sex === 'female' && seed % 7 === 0) {
      plan.social = { kind: 'conceive', targetId: partner.id };
      return plan;
    }
    if (partner && partner.status === 'living' && partner.sex === 'female' && seed % 7 === 0) {
      plan.social = { kind: 'conceive', targetId: partner.id };
      return plan;
    }

    const choice = seed % 5;
    if (choice === 0 && other) {
      plan.social = { kind: 'courtship', targetId: other.id };
    } else if (choice === 1 && other) {
      plan.social = { kind: 'talk', targetId: other.id };
    } else if (choice === 2) {
      // Target a *resident* outside the actor's household: the crime resolver checks real access, so a
      // household id would simply be refused and the soak would never exercise the mechanic.
      const candidates = adults.filter((r) => r.householdId !== resident.householdId);
      const target = candidates.length === 0 ? null : candidates[seed % candidates.length];
      if (target) plan.intents = [{ kind: 'theft', good: 'bread', quantity: 2, targetId: target.id }];
    } else if (choice === 3) {
      plan.intents = [{ kind: 'protest_call' }];
    } else if (choice === 4 && balanceOf(state, 'resident', resident.id) > 500) {
      plan.intents = [{ kind: 'spread_rumour', targetId: other?.id ?? resident.id }];
    }
    this.options.onDecision?.({
      actorId: request.actorId,
      plan,
      source: 'model',
      summary: plan.summary,
      fallbackReason: null,
      usage: { promptTokens: 0, completionTokens: 0, estimateOnly: true },
      latencyMs: 1,
      errorClass: null,
      attempts: 1,
      capability: null,
    });
    return plan;
  }
}
