import { z } from 'zod';
import { GOODS } from '../domain/state.js';

/**
 * The single source of truth for what a resident may ask for.
 *
 * Models produce this shape; the engine validates it again locally and resolves it against the world.
 * Nothing here can write state directly: every field names an intent that a resolver must accept.
 */

export const goodName = z.enum(GOODS);

export const PRIMARY_KINDS = [
  'work',
  'rest',
  'study',
  'seek_work',
  'shop',
  'civic',
  'care',
  'request_relief',
  'found_business',
  'invest',
  'migrate',
  'write_will',
  'build_home',
  'build_workplace',
  'expand_building',
  'work_construction',
] as const;

export const SOCIAL_KINDS = [
  'courtship',
  'affair',
  'conceive',
  'divorce',
  'accept',
  'refuse',
  'talk',
  'befriend',
  'feud',
  'reconcile',
  'report_crime',
  'accuse',
  'defend',
  'apologise',
  'request_housing',
  'accept_housing',
  'refuse_housing',
] as const;

export const INTENT_KINDS = [
  'theft',
  'fraud',
  'bribery',
  'tax_evasion',
  'assault',
  'intimidate',
  'strike_call',
  'protest_call',
  'riot_call',
  'rebel',
  'sabotage',
  'conceal_affair',
  'spread_rumour',
  'guard_patrol',
  'treat_patient',
  'teach',
] as const;

export const primaryActionSchema = z.object({
  kind: z.enum(PRIMARY_KINDS),
  businessId: z.number().int().positive().nullish(),
  targetId: z.number().int().positive().nullish(),
  businessKind: z.string().regex(/^[a-z_]{1,40}$/).nullish(),
  capacityDelta: z.number().int().min(1).max(100).nullish(),
  detail: z.string().max(300).optional(),
});

export const socialActionSchema = z.object({
  kind: z.enum(SOCIAL_KINDS),
  targetId: z.number().int().positive().nullish(),
  detail: z.string().max(300).optional(),
});

export const marketOrderSchema = z.object({
  good: goodName,
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1).max(10_000),
  limitPriceCents: z.number().int().min(1).max(1_000_000),
});

export const intentSchema = z.object({
  kind: z.enum(INTENT_KINDS),
  targetId: z.number().int().positive().nullish(),
  businessId: z.number().int().positive().nullish(),
  good: goodName.nullish(),
  quantity: z.number().int().min(1).max(10_000).nullish(),
  amountCents: z.number().int().min(0).max(1_000_000).nullish(),
  detail: z.string().max(300).optional(),
});

export const planSchema = z.object({
  primary: primaryActionSchema.nullable().default(null),
  social: socialActionSchema.nullable().default(null),
  orders: z.array(marketOrderSchema).max(4).default([]),
  intents: z.array(intentSchema).max(3).default([]),
  summary: z.string().max(280).default(''),
});

export type PrimaryAction = z.infer<typeof primaryActionSchema>;
export type SocialAction = z.infer<typeof socialActionSchema>;
export type MarketOrder = z.infer<typeof marketOrderSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type Plan = z.infer<typeof planSchema>;

export interface ActorPlan {
  actorId: number;
  plan: Plan;
  /** 'model' when it came from the provider, 'fallback' when the safe baseline was used. */
  source: 'model' | 'fallback' | 'operator';
  fallbackReason?: string;
  summary: string;
}

export function emptyPlan(): Plan {
  return { primary: null, social: null, orders: [], intents: [], summary: '' };
}

/** JSON Schema handed to providers that support structured output. */
export function planJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(planSchema, { io: 'output', target: 'draft-7' }) as Record<string, unknown>;
}
