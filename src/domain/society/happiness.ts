import type { TurnContext } from '../turn-context.js';
import type { Resident, WorldState } from '../state.js';
import { balanceOf } from '../state.js';
import { lifeStage } from '../clock.js';
import { activeEmploymentByResident, livingMembersByHousehold } from '../lookups.js';

/**
 * Happiness: one 0–100 score per living resident, recalculated from their life each day.
 *
 * Every town can *see* it (resident page, charts, their own prompt). Only towns founded with growth
 * rules also *feel* it — the score then changes behaviour (see the `happinessEffects*` helpers).
 * Display-only towns never store it, so their saved state and replay hashes are unchanged.
 *
 * The score is a sum of plain, explainable parts; `happinessFactors` returns them for the UI so a
 * resident's mood is never a mystery number.
 */

export const NEUTRAL_HAPPINESS = 50;

export interface HappinessFactors {
  food: number;
  home: number;
  work: number;
  money: number;
  family: number;
  friends: number;
  health: number;
  grievances: number;
}

export interface HappinessResult {
  score: number;
  factors: HappinessFactors;
}

/** Shared per-day tables, so scoring a whole town is one pass per table, not one scan per resident. */
export interface HappinessContext {
  state: WorldState;
  day: number;
  members: Map<number, Resident[]>;
  employment: ReturnType<typeof activeEmploymentByResident>;
  /** Active friendship/feud counts and whether they have a partner, per resident. */
  social: Map<number, { friends: number; feuds: number }>;
  grievance: Map<number, number>;
}

export function buildHappinessContext(state: WorldState, day: number): HappinessContext {
  const social = new Map<number, { friends: number; feuds: number }>();
  const bump = (id: number, key: 'friends' | 'feuds') => {
    const entry = social.get(id) ?? { friends: 0, feuds: 0 };
    entry[key] += 1;
    social.set(id, entry);
  };
  for (const relationship of state.relationships.values()) {
    if (relationship.untilDay !== null && relationship.untilDay <= day) continue;
    if (relationship.kind === 'friend') {
      bump(relationship.aId, 'friends');
      bump(relationship.bId, 'friends');
    } else if (relationship.kind === 'feud') {
      bump(relationship.aId, 'feuds');
      bump(relationship.bId, 'feuds');
    }
  }
  const grievance = new Map<number, number>();
  for (const item of state.grievances.values()) {
    if (item.untilDay !== null && item.untilDay <= day) continue;
    grievance.set(item.residentId, (grievance.get(item.residentId) ?? 0) + item.severity);
  }
  return {
    state,
    day,
    members: livingMembersByHousehold(state),
    employment: activeEmploymentByResident(state, day),
    social,
    grievance,
  };
}

export function scoreHappiness(hc: HappinessContext, resident: Resident, calendar: { adultDays: number; elderDays: number; daysPerYear: number; pregnancyDays: number; weekDays: number }): HappinessResult {
  const { state } = hc;
  const stage = lifeStage(resident.bornDay, hc.day, calendar);
  const household = resident.householdId === null ? undefined : state.households.get(resident.householdId);

  // Food: the most basic need. Hungry days hurt fast.
  const food = resident.hungerDays === 0 ? 10 : -Math.min(30, resident.hungerDays * 8);

  // Home: a roof of your own, not too crowded.
  let home = 0;
  if (!household || household.buildingId === null) home = -15; // camping
  else {
    const crowd = (hc.members.get(household.id) ?? []).length;
    home = crowd > household.capacity ? -8 : 6;
  }

  // Work: adults like having a job; children and elders are not judged on it.
  let work = 0;
  if (stage === 'adult') work = hc.employment.has(resident.id) ? 8 : -10;

  // Money: household cash per member against a modest cushion of about two weeks of wages.
  let money = 0;
  if (household) {
    const members = Math.max(1, (hc.members.get(household.id) ?? []).length);
    const perHead = balanceOf(state, 'household', household.id) / members + balanceOf(state, 'resident', resident.id);
    money = perHead >= 6_000 ? 8 : perHead >= 1_500 ? 3 : perHead > 0 ? -3 : -8;
  }

  // Family: a living partner, and not being alone in the house.
  let family = 0;
  const partner = resident.partnerId === null ? undefined : state.residents.get(resident.partnerId);
  if (partner && partner.status === 'living') family += 8;
  if (household && (hc.members.get(household.id) ?? []).length > 1) family += 3;
  else if (stage !== 'child') family -= 4;

  // Friends and feuds.
  const ties = hc.social.get(resident.id) ?? { friends: 0, feuds: 0 };
  const friends = Math.min(10, ties.friends * 3) - Math.min(15, ties.feuds * 6);

  // Health.
  const health =
    resident.healthState === 'healthy' ? 4
      : resident.healthState === 'recovering' ? -4
        : resident.healthState === 'infectious' ? -10
          : resident.healthState === 'injured' ? -12
            : resident.healthState === 'disabled' ? -8 : 0;

  // Grievances: the town's existing record of what has wronged them.
  const grievances = -Math.min(25, Math.floor((hc.grievance.get(resident.id) ?? 0) / 4));

  const factors: HappinessFactors = { food, home, work, money, family, friends, health, grievances };
  const raw = NEUTRAL_HAPPINESS + Object.values(factors).reduce((sum, value) => sum + value, 0);
  return { score: Math.max(0, Math.min(100, raw)), factors };
}

/** Plain-language mood band, for prompts and the dashboard. */
export function moodLabel(score: number): string {
  if (score >= 80) return 'thriving';
  if (score >= 60) return 'content';
  if (score >= 40) return 'getting by';
  if (score >= 20) return 'unhappy';
  return 'miserable';
}

/** Towns founded with growth rules feel their happiness; others only display it. */
export function happinessHasEffects(ctx: Pick<TurnContext, 'scenario'>): boolean {
  return ctx.scenario.growth !== undefined;
}

/**
 * The daily happiness phase (growth towns only): store each living resident's score so the effects
 * below and tomorrow's prompts read a committed, replayable value.
 */
export function happinessPhase(ctx: TurnContext): { average: number; miserable: number } {
  if (!happinessHasEffects(ctx)) return { average: 0, miserable: 0 };
  const hc = buildHappinessContext(ctx.state, ctx.day);
  let total = 0;
  let count = 0;
  let miserable = 0;
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    const { score } = scoreHappiness(hc, resident, ctx.scenario.calendar);
    resident.health = { ...resident.health, happiness: score };
    total += score;
    count += 1;
    if (score < 20) miserable += 1;
  }
  return { average: count === 0 ? 0 : Math.round(total / count), miserable };
}

/** The stored score, or neutral before the first happiness phase. Growth towns only. */
export function storedHappiness(resident: Resident): number {
  const value = resident.health.happiness;
  return typeof value === 'number' && Number.isFinite(value) ? value : NEUTRAL_HAPPINESS;
}

/**
 * Work effort from mood, in percent of normal labour: miserable people work less, thriving people a
 * little more. Applied to paid work only; never pushes labour above what the person can physically do
 * by more than 10 %.
 */
export function moodLabourPercent(ctx: Pick<TurnContext, 'scenario'>, resident: Resident): number {
  if (!happinessHasEffects(ctx)) return 100;
  const score = storedHappiness(resident);
  if (score < 20) return 80;
  if (score < 40) return 92;
  if (score >= 80) return 110;
  return 100;
}

/**
 * Daily chance (basis points) that a miserable adult decides to leave the island. Content people
 * never leave on mood alone. Small on purpose: one bad week should not empty a town.
 */
export function moodEmigrationBps(ctx: Pick<TurnContext, 'scenario'>, resident: Resident): number {
  if (!happinessHasEffects(ctx)) return 0;
  const score = storedHappiness(resident);
  if (score < 15) return 60; // ~0.6 %/day
  if (score < 25) return 20;
  return 0;
}

/** Conception chance multiplier (percent): unhappy couples are less likely to start a family. */
export function moodConceptionPercent(ctx: Pick<TurnContext, 'scenario'>, a: Resident, b: Resident): number {
  if (!happinessHasEffects(ctx)) return 100;
  const mood = Math.min(storedHappiness(a), storedHappiness(b));
  if (mood < 25) return 50;
  if (mood < 40) return 80;
  if (mood >= 75) return 115;
  return 100;
}

/** True when a resident is unhappy enough to join a protest or strike that someone else calls. */
export function moodJoinsProtest(ctx: Pick<TurnContext, 'scenario'>, resident: Resident): boolean {
  return happinessHasEffects(ctx) && storedHappiness(resident) < 35;
}
