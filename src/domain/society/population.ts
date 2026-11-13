import type { TurnContext } from '../turn-context.js';
import type { ImmigrationRules, Scenario } from '../../contracts/scenario.js';
import { balanceOf, nextId, quantityOf, type Good, type Resident } from '../state.js';
import { createHousehold, findVacantHome, householdMembers, householdFoodDays, pruneHouseholds } from './households.js';
import { livingMembersByHousehold } from '../lookups.js';
import { applyDepartureLifecycle } from './lifecycle.js';
import { canReceiveNewcomer } from './construction.js';
import { moodEmigrationBps } from './happiness.js';

/**
 * Population pressure. The target is a soft social goal, never a quota:
 *
 * - Above target: immigration and new conceptions pause, housing/price/emigration pressure rises, and
 *   after 30 unresolved days the council may fund ONE household resettlement per day. Nobody is ever
 *   deleted, and no sickness/death/disaster is fabricated to hit a number.
 * - Below target: immigration is allowed while housing and economic capacity exist, funded by an
 *   explicit endowment transfer.
 * - Host safety ceiling: a hard resource limit that pauses time with an explanation instead.
 */

export interface PopulationReport {
  living: number;
  expectedBirths: number;
  target: number;
  overTarget: boolean;
  pressureDays: number;
  emigrated: number;
  immigrated: number;
  ceilingReached: boolean;
}

const IMMIGRANT_ENDOWMENT_CENTS = 2_000;

/** Legacy cadence for scenarios without an `immigration` block: one chance every 5th day. */
const LEGACY_IMMIGRATION_PERIOD_DAYS = 5;

/**
 * Gap after the `arrivals`-th newcomer: `initialIntervalDays` after the first, shrinking by `stepDays`
 * for each later arrival, never below `minIntervalDays`.
 */
export function immigrationGapDays(rules: ImmigrationRules, arrivals: number): number {
  const shrunk = rules.initialIntervalDays - rules.stepDays * Math.max(0, arrivals - 1);
  return Math.max(rules.minIntervalDays, shrunk);
}

/** True when the scenario's immigration cadence allows a newcomer today. */
export function immigrationDue(ctx: TurnContext): boolean {
  const rules = ctx.scenario.immigration;
  if (!rules) return ctx.day % LEGACY_IMMIGRATION_PERIOD_DAYS === 0;
  if (ctx.day < rules.startDay) return false;
  const arrivals = ctx.state.counters.get('immigrationArrivals') ?? 0;
  if (arrivals === 0) return true;
  const last = ctx.state.counters.get('lastImmigrationDay') ?? rules.startDay;
  return ctx.day - last >= immigrationGapDays(rules, arrivals);
}
const ASSISTED_EXIT_PRESSURE_DAYS = 30;

export function populationPressurePhase(ctx: TurnContext, _scenario: Scenario): PopulationReport {
  const living = [...ctx.state.residents.values()].filter((r) => r.status === 'living');
  const expected = [...ctx.state.pregnancies.values()].filter((p) => p.status === 'active').length;
  const target = ctx.state.populationTarget;
  const policyEnabled = ctx.state.populationPolicyEnabled;
  const report: PopulationReport = {
    living: living.length,
    expectedBirths: expected,
    target,
    overTarget: policyEnabled && living.length + expected > target,
    pressureDays: ctx.state.counters.get('pressureDays') ?? 0,
    emigrated: 0,
    immigrated: 0,
    ceilingReached: living.length >= ctx.state.hostCeiling,
  };

  if (living.length >= ctx.state.hostCeiling) {
    ctx.state.counters.set('pauseRequested', 1);
    ctx.state.counters.set('pauseRequestReason', 1);
    if ((ctx.state.counters.get('ceilingNoticed') ?? 0) !== ctx.day) {
      ctx.state.counters.set('ceilingNoticed', ctx.day);
      ctx.emit({
        kind: 'population_ceiling',
        actorId: null,
        targetId: null,
        visibility: 'public',
        importance: 90,
        title: 'The town has reached its housing and service ceiling',
        detail: { population: living.length, ceiling: ctx.state.hostCeiling },
      });
    }
    return report;
  }

  if (living.length === 0) {
    if (policyEnabled && target <= 0) {
      ctx.state.counters.set('pauseRequested', 1);
      ctx.state.counters.set('pauseRequestReason', 2);
      ctx.emit({
        kind: 'town_empty',
        actorId: null,
        targetId: null,
        visibility: 'public',
        importance: 100,
        title: 'Tidehaven stands empty',
        detail: { target },
      });
      return report;
    }
    const resettled = tryImmigrate(ctx, true);
    report.immigrated += resettled ? 1 : 0;
    return report;
  }

  if (policyEnabled && living.length + expected > target) {
    report.pressureDays += 1;
    ctx.state.counters.set('pressureDays', report.pressureDays);
    if (report.pressureDays === 1) {
      ctx.emit({
        kind: 'population_pressure',
        actorId: null,
        targetId: null,
        visibility: 'public',
        importance: 30,
        title: 'The town is above its planned size; the council restricts growth',
        detail: { population: living.length, target },
      });
    }
    if (report.pressureDays >= ASSISTED_EXIT_PRESSURE_DAYS && ctx.day % 3 === 0) {
      const household = pickEmigrationHousehold(ctx);
      if (household !== null) {
        const moved = emigrateHousehold(ctx, household, 'resettlement');
        if (moved > 0) report.emigrated += moved;
      }
    }
    return report;
  }

  ctx.state.counters.set('pressureDays', 0);
  if (!policyEnabled || living.length + expected < target) {
    const housing = ctx.scenario.construction
      ? canReceiveNewcomer(ctx)
      : spareCapacity(ctx) > 0 || (ctx.scenario.immigration !== undefined && findVacantHome(ctx) !== null);
    if (housing && balanceOf(ctx.state, 'treasury', 0) >= IMMIGRANT_ENDOWMENT_CENTS && immigrationDue(ctx)) {
      const arrived = tryImmigrate(ctx, false);
      if (arrived) {
        report.immigrated += 1;
        if (ctx.scenario.immigration) {
          ctx.state.counters.set('immigrationArrivals', (ctx.state.counters.get('immigrationArrivals') ?? 0) + 1);
          ctx.state.counters.set('lastImmigrationDay', ctx.day);
        }
      }
    }
  }
  report.emigrated += moodEmigration(ctx);
  pruneHouseholds(ctx);
  return report;
}

/**
 * Growth towns only: a miserable adult may decide to leave. Uses the same departure rule as any other
 * emigration, so nobody walks out on dependent children. Bounded to one departure per day.
 */
function moodEmigration(ctx: TurnContext): number {
  for (const resident of [...ctx.state.residents.values()].sort((a, b) => a.id - b.id)) {
    if (resident.status !== 'living' || resident.bornDay > ctx.day - ctx.scenario.calendar.adultDays) continue;
    const bps = moodEmigrationBps(ctx, resident);
    if (bps <= 0 || !ctx.rngFor(resident.id, 'mood-emigration').chanceBps(bps)) continue;
    if (emigrateResident(ctx, resident.id, 'unhappy with life on the island')) return 1;
  }
  return 0;
}

function spareCapacity(ctx: TurnContext): number {
  let spare = 0;
  const membersByHousehold = livingMembersByHousehold(ctx.state);
  for (const household of ctx.state.households.values()) {
    if (household.dissolvedDay !== null) continue;
    spare += Math.max(0, household.capacity - (membersByHousehold.get(household.id)?.length ?? 0));
  }
  return spare;
}

function pickEmigrationHousehold(ctx: TurnContext): number | null {
  const officeHolders = new Set<number>();
  for (const seat of ctx.state.offices.values()) {
    if (seat.holderId !== null && seat.untilDay === null) officeHolders.add(seat.holderId);
  }
  const candidates = [...ctx.state.households.values()]
    .filter((h) => h.dissolvedDay === null)
    .map((h) => ({ household: h, members: householdMembers(ctx, h.id) }))
    .filter((entry) => entry.members.length > 0)
    .filter((entry) => entry.members.every((m) => !officeHolders.has(m.id)))
    .filter((entry) => entry.members.every((m) => ctx.state.residents.get(m.id)?.healthState !== 'injured'))
    .sort((a, b) => householdFoodDays(ctx, a.household.id) - householdFoodDays(ctx, b.household.id) || a.household.id - b.household.id);
  const chosen = candidates[0];
  return chosen ? chosen.household.id : null;
}

/**
 * Emigrate one resident who asked to leave.
 *
 * Their own cash leaves with them, their obligations are closed through the shared departure
 * lifecycle, and they remain on record as an emigrant so descendants can still be traced.
 */
export function emigrateResident(ctx: TurnContext, residentId: number, reason: string): boolean {
  const resident = ctx.state.residents.get(residentId);
  if (!resident || resident.status !== 'living') return false;
  // Household members cannot be silently abandoned: only adults with no dependent children leave alone.
  const dependants = [...ctx.state.residents.values()].filter(
    (r) =>
      r.status === 'living' &&
      r.bornDay > ctx.day - ctx.scenario.calendar.adultDays &&
      r.guardianId === resident.id,
  );
  if (dependants.length > 0) return false;

  const cash = balanceOf(ctx.state, 'resident', resident.id);
  if (cash > 0) {
    ctx.transfer({
      from: { type: 'resident', id: resident.id },
      to: { type: 'external', id: 0 },
      cents: cash,
      reason: 'emigration_savings',
    });
  }
  resident.status = 'emigrated';
  resident.emigratedDay = ctx.day;
  resident.destination = 'the mainland';
  applyDepartureLifecycle(ctx, resident);
  ctx.emit({
    kind: 'resident_emigrated',
    actorId: resident.id,
    targetId: null,
    visibility: 'public',
    importance: 55,
    title: `${resident.name} left ${ctx.state.name} for the mainland`,
    detail: { reason },
  });
  return true;
}

/** Emigrate a whole household: sell stock to the outside, settle cash out, tombstone everyone. */
export function emigrateHousehold(ctx: TurnContext, householdId: number, reason: string): number {
  const household = ctx.state.households.get(householdId);
  if (!household || household.dissolvedDay !== null) return 0;
  const members = householdMembers(ctx, householdId);
  if (members.length === 0) return 0;

  // Sell household goods to the external market at export prices (money enters from outside).
  for (const good of ctx.scenario.economy.mealGoods as readonly Good[]) {
    const quantity = quantityOf(ctx.state, 'household', householdId, good);
    if (quantity <= 0) continue;
    const price = ctx.scenario.economy.referencePrices[good].export;
    ctx.shiftGoods({ owner: { type: 'household', id: householdId }, good, delta: -quantity, reason: 'emigration_sale' });
    ctx.transfer({
      from: { type: 'external', id: 0 },
      to: { type: 'household', id: householdId },
      cents: quantity * price,
      reason: `emigration_sale:${good}`,
    });
  }

  // Take the household's savings with them: the money leaves the town's internal circulation.
  const householdCash = balanceOf(ctx.state, 'household', householdId);
  if (householdCash > 0) {
    ctx.transfer({
      from: { type: 'household', id: householdId },
      to: { type: 'external', id: 0 },
      cents: householdCash,
      reason: 'emigration_savings',
    });
  }

  for (const member of members) {
    const cash = balanceOf(ctx.state, 'resident', member.id);
    if (cash > 0) {
      ctx.transfer({
        from: { type: 'resident', id: member.id },
        to: { type: 'external', id: 0 },
        cents: cash,
        reason: 'emigration_savings',
      });
    }
    member.status = 'emigrated';
    member.emigratedDay = ctx.day;
    member.destination = 'the mainland';
    // Employment, offices, the partnership, and any resident-owned business or stock are settled
    // through the shared departure lifecycle so a departed resident leaves nothing live behind.
    applyDepartureLifecycle(ctx, member);
  }
  household.dissolvedDay = ctx.day;

  ctx.emit({
    kind: 'household_emigrated',
    actorId: members[0]?.id ?? null,
    targetId: householdId,
    visibility: 'public',
    importance: 60,
    title: `The ${household.name} household left for the mainland`,
    detail: { reason, members: members.map((m) => m.id), destination: 'the mainland' },
  });
  return members.length;
}

const IMMIGRANT_GIVEN = ['Ansel', 'Bree', 'Cyra', 'Dov', 'Eira', 'Fenn', 'Gale', 'Hollis', 'Ivo', 'Jori', 'Kesa', 'Lios', 'Maren', 'Nyle', 'Osla', 'Perrin'];
const IMMIGRANT_FAMILY = ['Farrow', 'Quill', 'Marsh', 'Tarn', 'Wick', 'Bram', 'Holt', 'Sedge'];

function tryImmigrate(ctx: TurnContext, allowEmptyTown: boolean): boolean {
  const endowment = IMMIGRANT_ENDOWMENT_CENTS;
  if (balanceOf(ctx.state, 'treasury', 0) < endowment) return false;

  // Scenarios with an explicit immigration cadence settle newcomers in a vacant home of their own
  // first, so they do not move in with the founders; otherwise they join the roomiest household.
  // With construction rules there is no moving in with strangers: no vacant home means a camp, and
  // the newcomer builds a home before settling.
  let target: { household: { id: number } } | undefined;
  const vacant = ctx.scenario.immigration !== undefined || ctx.scenario.construction ? findVacantHome(ctx) : null;
  let newHome = false;
  const camp = vacant === null && ctx.scenario.construction !== undefined;
  if (camp) {
    if (!canReceiveNewcomer(ctx)) return false;
  } else if (vacant === null) {
    target = [...ctx.state.households.values()]
      .filter((h) => h.dissolvedDay === null)
      .map((h) => ({ household: h, spare: h.capacity - householdMembers(ctx, h.id).length }))
      .filter((entry) => entry.spare > 0)
      .sort((a, b) => b.spare - a.spare || a.household.id - b.household.id)[0];
    if (!target) return false;
  } else {
    newHome = true;
  }

  const rng = ctx.rngFor(`immigrant:${ctx.day}`, 'arrival');
  const id = nextId(ctx.state, 'resident');
  const given = rng.pick(IMMIGRANT_GIVEN) ?? 'Ansel';
  const family = rng.pick(IMMIGRANT_FAMILY) ?? 'Farrow';
  const age = ctx.scenario.calendar.adultDays + rng.int(0, 25 * ctx.scenario.calendar.daysPerYear);
  const traits: Record<string, number> = {};
  for (const key of ['diligence', 'sociability', 'ambition', 'honesty', 'temper']) {
    traits[key] = rng.int(30, 85);
  }
  const resident: Resident = {
    id,
    name: `${given} ${family}`,
    sex: rng.chanceBps(5_000) ? 'male' : 'female',
    bornDay: ctx.day - age,
    origin: 'immigrant',
    status: 'living',
    deathDay: null,
    deathCause: null,
    householdId: 0,
    partnerId: null,
    motherId: null,
    fatherId: null,
    guardianId: null,
    traits,
    skills: { literacy: rng.int(0, 3) },
    healthState: 'healthy',
    health: { wellbeing: 55 },
    hungerDays: 0,
    educationDays: rng.int(0, 3) * ctx.scenario.calendar.daysPerYear,
    legacyOf: null,
    emigratedDay: null,
    destination: null,
    rngSalt: rng.nextUint32(),
  };
  if (newHome && vacant !== null) {
    const building = ctx.state.buildings.get(vacant);
    target = { household: createHousehold(ctx, `${family} house`, vacant, building?.capacity ?? 4) };
  } else if (camp) {
    // A camp: a household with no roof yet. It holds exactly its members until they build a home.
    target = { household: createHousehold(ctx, `${family} camp`, null, 1) };
  }
  if (!target) return false;
  resident.householdId = target.household.id;
  ctx.state.residents.set(id, resident);
  ctx.state.accounts.set(`resident:${id}`, { ownerType: 'resident', ownerId: id, balanceCents: 0 });
  // A newcomer who founds their own household brings the endowment into that household's purse, so
  // it can buy food from the first day; one who joins an existing household keeps it personally.
  ctx.transfer({
    from: { type: 'treasury', id: 0 },
    to: newHome || camp ? { type: 'household', id: target.household.id } : { type: 'resident', id },
    cents: endowment,
    reason: 'immigrant_endowment',
  });
  ctx.emit({
    kind: 'immigrant_arrived',
    actorId: id,
    targetId: target.household.id,
    visibility: 'public',
    importance: 30,
    title: `${resident.name} arrived in ${ctx.state.name}`,
    detail: { from: 'the mainland', endowmentCents: endowment, emptyTown: allowEmptyTown, camp },
  });
  ctx.remember(
    id,
    'life',
    camp
      ? `I arrived in ${ctx.state.name} on day ${ctx.day}. There was no free house, so I am camping until I build one.`
      : `I arrived in ${ctx.state.name} on day ${ctx.day}.`,
    60,
    [],
  );
  return true;
}
