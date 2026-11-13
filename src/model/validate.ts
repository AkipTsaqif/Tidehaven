import { planSchema, emptyPlan, type Plan } from '../contracts/actions.js';
import { extractJsonObject } from './probe.js';

/**
 * Local validation of model output. Provider claims of schema support are never trusted: the shape,
 * ranges, ids, and permissions are re-checked here, and anything unusable becomes a recorded fallback
 * rather than an exception that stalls the day.
 */

export interface ValidationResult {
  ok: boolean;
  plan: Plan;
  reason?: string;
  detail?: string;
}

export function validatePlanText(text: string): ValidationResult {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, plan: emptyPlan(), reason: 'empty_response' };
  const candidate = extractJsonObject(trimmed);
  if (candidate === null) return { ok: false, plan: emptyPlan(), reason: 'no_json_object' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, plan: emptyPlan(), reason: 'invalid_json', detail: (err as Error).message };
  }
  return validatePlanValue(parsed);
}

export function validatePlanValue(value: unknown): ValidationResult {
  const result = planSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      plan: emptyPlan(),
      reason: 'schema_mismatch',
      detail: result.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { ok: true, plan: normalisePlan(result.data) };
}

/** Defensive normalisation: trim strings, drop duplicate orders, de-duplicate intents. */
export function normalisePlan(plan: Plan): Plan {
  const seenOrders = new Set<string>();
  const orders = plan.orders.filter((order) => {
    const key = `${order.side}:${order.good}`;
    if (seenOrders.has(key)) return false;
    seenOrders.add(key);
    return true;
  });
  const seenIntents = new Set<string>();
  const intents = plan.intents.filter((intent) => {
    const key = `${intent.kind}:${intent.targetId ?? ''}:${intent.businessId ?? ''}`;
    if (seenIntents.has(key)) return false;
    seenIntents.add(key);
    return true;
  });
  return {
    primary: plan.primary ? { ...plan.primary, detail: plan.primary.detail?.slice(0, 300) } : null,
    social: plan.social ? { ...plan.social, detail: plan.social.detail?.slice(0, 300) } : null,
    orders: orders.slice(0, 4),
    intents: intents.slice(0, 3),
    summary: plan.summary.slice(0, 280),
  };
}
