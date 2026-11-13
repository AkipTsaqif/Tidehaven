import type { ActorPlan, Plan } from '../contracts/actions.js';
import type { Scenario } from '../contracts/scenario.js';
import type { WorldState, Resident } from '../domain/state.js';
import { lifeStage } from '../domain/clock.js';
import { activeEmploymentContract } from '../domain/economy/employment.js';

/**
 * Safe baseline decisions. Used when a model call fails, is refused, returns nonsense, or the operator
 * caps the daily job budget. Deliberately boring: keep a valid job, buy affordable food, seek work if
 * unemployed, rest if unwell. Never spends money it does not have and never takes an illegal action.
 */

export function baselinePlan(params: {
  state: WorldState;
  scenario: Scenario;
  resident: Resident;
  day: number;
  reason: string;
}): ActorPlan {
  const { state, scenario, resident, day, reason } = params;
  const context = createBaselineContext(state, scenario, day);
  const plan: Plan = { primary: null, social: null, orders: [], intents: [], summary: '' };
  const stage = lifeStage(resident.bornDay, day, scenario.calendar);

  if (stage === 'child') {
    plan.primary = { kind: 'study' };
    plan.summary = 'Attend lessons and stay out of trouble.';
    return { actorId: resident.id, plan, source: 'fallback', fallbackReason: reason, summary: plan.summary };
  }

  const contract = activeEmploymentContract(state, day, resident.id);
  const unemployed = contract === null;
  const unwell = resident.healthState === 'injured' || resident.healthState === 'disabled';

  // Safety net for construction scenarios: a household with no roof builds one. Every other decision
  // to build is the resident's own (the model's), not the baseline's.
  const household = resident.householdId === null ? null : state.households.get(resident.householdId);
  const camping =
    scenario.construction !== undefined && household !== null && household !== undefined && household.buildingId === null;

  if (unwell) {
    plan.primary = { kind: 'rest' };
  } else if (camping) {
    plan.primary = { kind: 'build_home' };
  } else if (!unemployed) {
    plan.primary = { kind: 'work' };
  } else {
    plan.primary = { kind: 'seek_work' };
  }

  // Household food is provisioned automatically by the market phase using the household's pooled
  // cash, so the baseline does not duplicate it with personal orders.

  plan.summary = baselineSummary(plan, reason);
  void context;
  return { actorId: resident.id, plan, source: 'fallback', fallbackReason: reason, summary: plan.summary };
}

function createBaselineContext(state: WorldState, scenario: Scenario, day: number): null {
  void state;
  void scenario;
  void day;
  return null;
}

function baselineSummary(plan: Plan, reason: string): string {
  const parts: string[] = [];
  if (plan.primary) parts.push(`primary=${plan.primary.kind}`);
  if (plan.orders.length > 0) parts.push(`orders=${plan.orders.length}`);
  parts.push(`fallback=${reason}`);
  return parts.join(' ');
}
