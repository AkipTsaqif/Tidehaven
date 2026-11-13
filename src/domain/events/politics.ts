import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { quitToday } from '../economy/job-market.js';
import { nextId, OFFICES, type Office, type Resident } from '../state.js';
import { educationYears } from '../society/education.js';
import { livingMembersByHousehold, residentsWithActiveEmployment } from '../lookups.js';

/**
 * Civic institutions: annual elections, office vacancies and succession, factions, and bounded public
 * spending. Policies are limited to the charter's caps; no resident can write executable law.
 */

export interface CivicReport {
  elections: number;
  vacanciesFilled: number;
  factionsActive: number;
  aidPaidCents: number;
  concessions: number;
  leviedCents: number;
  allowancePaidCents: number;
  publicWorksHired: number;
  legitimacyBps: number;
}

export function civicPhase(ctx: TurnContext, plans: Map<number, ActorPlan>): CivicReport {
  const report: CivicReport = {
    elections: 0,
    vacanciesFilled: 0,
    factionsActive: 0,
    aidPaidCents: 0,
    concessions: 0,
    leviedCents: 0,
    allowancePaidCents: 0,
    publicWorksHired: 0,
    legitimacyBps: ctx.state.counters.get('legitimacyBps') ?? 7_000,
  };

  ensureSeats(ctx);
  report.vacanciesFilled += fillVacancies(ctx);
  if (shouldHoldElection(ctx)) {
    runElection(ctx);
    report.elections += 1;
  }

  report.factionsActive = updateFactions(ctx);
  report.publicWorksHired = publicWorks(ctx);

  // Civic duty from residents who chose it; improves legitimacy slightly and registers grievance.
  const civicWorkers = [...plans.values()].filter(
    (p) => p.plan.primary?.kind === 'civic' && ctx.state.residents.get(p.actorId)?.status === 'living',
  );
  if (civicWorkers.length > 0) {
    bumpCounter(ctx, 'civicDutyDays', civicWorkers.length);
  }

  // Council concession during a strike: a bounded wage boost funded by the treasury.
  for (const item of ctx.state.unrest.values()) {
    if (item.kind !== 'strike' || item.status !== 'active') continue;
    if (item.startedDay >= ctx.day) continue;
    const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
    if (treasury < 5_000) continue;
    const rng = ctx.rngFor(item.id, 'concession');
    if (!rng.chanceBps(2_500)) continue;
    const current = Number(ctx.state.policies.get('wageBoostBps') ?? 0);
    ctx.state.policies.set('wageBoostBps', Math.min(3_000, current + 500));
    item.status = 'resolved';
    item.endedDay = ctx.day;
    report.concessions += 1;
    resolveGrievances(ctx, 'unpaid_wages', 20);
    resolveGrievances(ctx, 'wage_conditions', 20);
    ctx.emit({
      kind: 'wage_concession',
      actorId: null,
      targetId: null,
      visibility: 'public',
      importance: 45,
      title: 'The council granted a wage increase',
      detail: { wageBoostBps: ctx.state.policies.get('wageBoostBps') },
    });
  }

  // Bounded poor relief when the treasury can afford it and a household is short of food.
  const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
  let reliefBudget = Math.floor(treasury / 50); // at most 2% of the treasury per day, town-wide
  if (treasury > 10_000) {
    // Relief moves money only; membership is unchanged during the loop.
    const membersByHousehold = livingMembersByHousehold(ctx.state);
    for (const household of ctx.state.households.values()) {
      if (household.dissolvedDay !== null) continue;
      if (reliefBudget <= 0) break;
      const members = membersByHousehold.get(household.id) ?? [];
      if (members.length === 0) continue;
      const hungry = members.filter((m) => m.hungerDays > 0).length;
      if (hungry === 0) continue;
      const aid = Math.min(hungry * 200, reliefBudget);
      if (aid <= 0) continue;
      reliefBudget -= aid;
      ctx.transfer({
        from: { type: 'treasury', id: 0 },
        to: { type: 'household', id: household.id },
        cents: aid,
        reason: 'poor_relief',
      });
      report.aidPaidCents += aid;
      bumpCounter(ctx, 'reliefDays', 1);
      ctx.emit({
        kind: 'poor_relief',
        actorId: null,
        targetId: household.id,
        visibility: 'public',
        importance: 25,
        title: `The council sent ${aid} cents of relief to ${household.name}`,
        detail: { aidCents: aid, hungry },
      });
    }
  }

  report.allowancePaidCents = childAllowance(ctx) + citizensDividend(ctx);
  report.leviedCents = weeklyWealthLevy(ctx);
  report.legitimacyBps = updateLegitimacy(ctx);
  return report;
}

/**
 * Child allowance. Households with dependants receive a small daily payment from the treasury so that a
 * two-earner, three-child household is not permanently one bad week away from hunger.
 */
export function childAllowance(ctx: TurnContext): number {
  const perChild = ctx.scenario.economy.childAllowanceCentsPerDay;
  if (perChild <= 0) return 0;
  const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
  if (treasury < 5_000) return 0;
  let paid = 0;
  const membersByHousehold = livingMembersByHousehold(ctx.state);
  for (const household of ctx.state.households.values()) {
    if (household.dissolvedDay !== null) continue;
    const children = (membersByHousehold.get(household.id) ?? []).filter(
      (r) => r.bornDay > ctx.day - ctx.scenario.calendar.adultDays,
    ).length;
    if (children === 0) continue;
    const amount = Math.min(children * perChild, treasury - paid);
    if (amount <= 0) break;
    ctx.transfer({
      from: { type: 'treasury', id: 0 },
      to: { type: 'household', id: household.id },
      cents: amount,
      reason: 'child_allowance',
    });
    paid += amount;
  }
  return paid;
}

/**
 * Public works: the council's job guarantee. When the treasury can afford it, an unemployed adult is
 * taken on by the Town Yard, and that labour repairs the worst-conditioned building in town. This is
 * the safety valve that stops a household with no wage earner from starving beside surplus grain.
 */
export function publicWorks(ctx: TurnContext): number {
  const yard = [...ctx.state.businesses.values()].find((b) => b.kind === 'public_works' && b.status === 'open');
  if (!yard) return 0;
  const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
  const wage = ctx.scenario.economy.wages.unskilled;
  if (treasury < wage * 20) return 0;

  const building = yard.buildingId === null ? null : ctx.state.buildings.get(yard.buildingId);
  const capacity = Math.max(1, building?.capacity ?? 4);
  const staff = [...ctx.state.contracts.values()].filter(
    (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === yard.id,
  );
  let hired = 0;
  if (staff.length < capacity) {
    const employed = residentsWithActiveEmployment(ctx.state);
    const unemployed = [...ctx.state.residents.values()]
      .filter((r) => r.status === 'living')
      .filter((r) => r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays)
      .filter((r) => !employed.has(r.id))
      // The job guarantee is an offer, not conscription: someone who quit today chose not to work.
      .filter((r) => !quitToday(ctx, r.id))
      .sort((a, b) => (b.traits.diligence ?? 0) - (a.traits.diligence ?? 0) || a.id - b.id);
    const candidate = unemployed[0];
    if (candidate) {
      const id = nextId(ctx.state, 'contract');
      ctx.state.contracts.set(id, {
        id,
        kind: 'employment',
        aId: candidate.id,
        bId: yard.id,
        businessId: yard.id,
        terms: { wageClass: 'unskilled', wageCents: wage },
        startDay: ctx.day,
        endDay: null,
        status: 'active',
      });
      hired = 1;
      ctx.emit({
        kind: 'public_works_hired',
        actorId: candidate.id,
        targetId: yard.id,
        visibility: 'public',
        importance: 20,
        title: `${candidate.name} was taken on by the Town Yard`,
        detail: { wageCents: wage },
      });
    }
  }

  // Repair the worst-conditioned building with the yard's labour.
  if (staff.length + hired > 0) {
    const worst = [...ctx.state.buildings.values()]
      .filter((b) => b.destroyedDay === null && b.conditionBps < 10_000)
      .sort((a, b) => a.conditionBps - b.conditionBps || a.id - b.id)[0];
    if (worst) {
      worst.conditionBps = Math.min(10_000, worst.conditionBps + 60);
    }
  }
  return hired;
}

/**
 * Citizens' dividend. When the treasury holds far more than it needs, the council returns the surplus
 * per head instead of hoarding it — this is the documented outflow that keeps money circulating.
 */
export function citizensDividend(ctx: TurnContext): number {
  if (ctx.day % ctx.scenario.calendar.weekDays !== 0) return 0;
  const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
  const threshold = ctx.scenario.economy.dividendTreasuryThresholdCents;
  if (threshold <= 0 || treasury <= threshold) return 0;
  const living = [...ctx.state.residents.values()].filter((r) => r.status === 'living');
  if (living.length === 0) return 0;
  const perHead = ctx.scenario.economy.citizensDividendCents;
  const total = Math.min(perHead * living.length, Math.floor((treasury - threshold) / 2));
  if (total <= 0) return 0;
  const share = Math.floor(total / living.length);
  if (share <= 0) return 0;
  let paid = 0;
  for (const resident of living) {
    const target = resident.householdId === null
      ? { type: 'resident' as const, id: resident.id }
      : { type: 'household' as const, id: resident.householdId };
    ctx.transfer({
      from: { type: 'treasury', id: 0 },
      to: target,
      cents: share,
      reason: 'citizens_dividend',
    });
    paid += share;
  }
  ctx.emit({
    kind: 'citizens_dividend',
    actorId: null,
    targetId: null,
    visibility: 'public',
    importance: 25,
    title: `The council paid every resident a dividend of ${share} cents`,
    detail: { perHeadCents: share, totalCents: paid },
  });
  return paid;
}

/**
 * Weekly levy on very large household reserves. The charter permits it; the proceeds fund public
 * wages and relief. It is bounded, recorded in the tax ledger, and never touches food stock.
 */
function weeklyWealthLevy(ctx: TurnContext): number {
  if (ctx.day % ctx.scenario.calendar.weekDays !== 0) return 0;
  const threshold = ctx.scenario.economy.wealthLevyThresholdCents;
  const bps = ctx.scenario.economy.wealthLevyBps;
  if (bps <= 0) return 0;
  let total = 0;
  for (const household of ctx.state.households.values()) {
    if (household.dissolvedDay !== null) continue;
    const cash = ctx.state.accounts.get(`household:${household.id}`)?.balanceCents ?? 0;
    if (cash <= threshold) continue;
    const levy = Math.floor(((cash - threshold) * bps) / 10_000);
    if (levy <= 0) continue;
    ctx.transfer({
      from: { type: 'household', id: household.id },
      to: { type: 'treasury', id: 0 },
      cents: levy,
      reason: 'wealth_levy',
    });
    ctx.tax(null, 'wealth_levy', levy);
    total += levy;
  }
  if (total > 0) {
    ctx.emit({
      kind: 'wealth_levy',
      actorId: null,
      targetId: null,
      visibility: 'public',
      importance: 20,
      title: `The council levied ${total} cents on large household reserves`,
      detail: { totalCents: total },
    });
  }
  return total;
}

export function ensureSeats(ctx: TurnContext): void {
  const required: Office[] = ['councillor', 'councillor', 'councillor', 'magistrate', 'guard_captain', 'clerk'];
  const counts = new Map<Office, number>();
  for (const seat of ctx.state.offices.values()) {
    counts.set(seat.office, Math.max(counts.get(seat.office) ?? 0, seat.seat + 1));
  }
  const needed = new Map<Office, number>();
  for (const office of required) needed.set(office, (needed.get(office) ?? 0) + 1);
  for (const [office, count] of needed) {
    const existing = counts.get(office) ?? 0;
    for (let seat = existing; seat < count; seat += 1) {
      const key = `${office}:${seat}`;
      ctx.state.offices.set(key, { key, office, seat, holderId: null, sinceDay: 0, untilDay: null });
    }
  }
}

function fillVacancies(ctx: TurnContext): number {
  let filled = 0;
  for (const seat of ctx.state.offices.values()) {
    if (seat.holderId !== null) {
      const holder = ctx.state.residents.get(seat.holderId);
      if (holder && holder.status === 'living' && (seat.untilDay === null || seat.untilDay > ctx.day)) continue;
      seat.holderId = null;
      seat.untilDay = ctx.day;
    }
    const candidate = bestCandidate(ctx, seat.office);
    if (!candidate) continue;
    seat.holderId = candidate.id;
    seat.sinceDay = ctx.day;
    seat.untilDay = null;
    filled += 1;
    ctx.emit({
      kind: 'office_filled',
      actorId: candidate.id,
      targetId: null,
      visibility: 'public',
      importance: 40,
      title: `${candidate.name} took office as ${seat.office.replace(/_/g, ' ')}`,
      detail: { office: seat.office, seat: seat.seat },
    });
  }
  return filled;
}

export function standingOf(ctx: TurnContext, resident: Resident): number {
  let score = (resident.traits.diligence ?? 50) + (resident.traits.honesty ?? 50);
  score += educationYears(ctx, resident.id) * 4;
  score -= resident.hungerDays * 5;
  for (const relationship of ctx.state.relationships.values()) {
    if (relationship.aId !== resident.id && relationship.bId !== resident.id) continue;
    if (relationship.kind === 'feud' && relationship.untilDay === null) score -= 15;
    if (relationship.kind === 'friend' && relationship.untilDay === null) score += 3;
  }
  for (const grievance of ctx.state.grievances.values()) {
    if (grievance.residentId === resident.id && grievance.untilDay === null) score -= Math.floor(grievance.severity / 4);
  }
  return score;
}

function eligibleAdults(ctx: TurnContext): Resident[] {
  return [...ctx.state.residents.values()]
    .filter((r) => r.status === 'living' && r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays)
    .sort((a, b) => a.id - b.id);
}

function bestCandidate(ctx: TurnContext, office: Office): Resident | null {
  const scores: { resident: Resident; score: number }[] = [];
  for (const resident of eligibleAdults(ctx)) {
    let score = standingOf(ctx, resident);
    if (office === 'clerk') score += (resident.skills.letters ?? 0) * 6 + educationYears(ctx, resident.id) * 6;
    if (office === 'magistrate') score += (resident.skills.literacy ?? 0) * 5;
    if (office === 'guard_captain') score += (resident.skills.brawling ?? 0) * 8;
    if (office === 'councillor') score += (resident.traits.sociability ?? 50) / 2;
    if (isOfficeHolder(ctx, resident.id)) score -= 20;
    scores.push({ resident, score });
  }
  scores.sort((a, b) => b.score - a.score || a.resident.id - b.resident.id);
  return scores[0]?.resident ?? null;
}

function isOfficeHolder(ctx: TurnContext, residentId: number): boolean {
  return [...ctx.state.offices.values()].some((s) => s.holderId === residentId && (s.untilDay === null || s.untilDay > ctx.day));
}

export function shouldHoldElection(ctx: TurnContext): boolean {
  const last = ctx.state.counters.get('lastElectionDay') ?? 0;
  return ctx.day - last >= ctx.scenario.calendar.daysPerYear;
}

export function runElection(ctx: TurnContext): void {
  const councillorSeats = [...ctx.state.offices.values()]
    .filter((s) => s.office === 'councillor')
    .sort((a, b) => a.seat - b.seat);
  const candidates = eligibleAdults(ctx)
    .filter((r) => standingOf(ctx, r) > 60)
    .slice(0, 12);
  if (candidates.length === 0) {
    ctx.state.counters.set('lastElectionDay', ctx.day);
    return;
  }

  const votes = new Map<number, number>();
  for (const voter of eligibleAdults(ctx)) {
    const rng = ctx.rngFor(voter.id, 'election');
    // Voters favour residents they trust higher, with a seeded wobble; deterministic per voter.
    const weights = candidates.map((candidate) => {
      let weight = standingOf(ctx, candidate) + rng.int(0, 25);
      const key = `friend:${Math.min(voter.id, candidate.id)}:${Math.max(voter.id, candidate.id)}`;
      const relationship = ctx.state.relationships.get(key);
      if (relationship) weight += relationship.trust - 50;
      return Math.max(1, weight);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = rng.int(1, total);
    for (let i = 0; i < candidates.length; i += 1) {
      pick -= weights[i] ?? 0;
      const candidate = candidates[i];
      if (pick <= 0 && candidate) {
        votes.set(candidate.id, (votes.get(candidate.id) ?? 0) + 1);
        break;
      }
    }
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, votes: votes.get(candidate.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.candidate.id - b.candidate.id);

  const results = ranked.map((entry) => ({ id: entry.candidate.id, name: entry.candidate.name, votes: entry.votes }));
  const electionId = nextId(stateForIds(ctx), 'event');
  void electionId;
  ranked.slice(0, councillorSeats.length).forEach((entry, index) => {
    const seat = councillorSeats[index];
    if (!seat) return;
    seat.holderId = entry.candidate.id;
    seat.sinceDay = ctx.day;
    seat.untilDay = ctx.day + ctx.scenario.calendar.daysPerYear;
  });

  ctx.state.counters.set('lastElectionDay', ctx.day);
  ctx.emit({
    kind: 'election_held',
    actorId: null,
    targetId: null,
    visibility: 'public',
    importance: 60,
    title: 'Tidehaven held its annual election',
    detail: { results: JSON.stringify(results.slice(0, 6)) },
  });
  for (const entry of ranked.slice(0, councillorSeats.length)) {
    ctx.remember(entry.candidate.id, 'civic', `I was elected to the council on day ${ctx.day}.`, 70, []);
  }
}

function stateForIds(ctx: TurnContext): TurnContext['state'] {
  return ctx.state;
}

function updateFactions(ctx: TurnContext): number {
  let active = 0;
  for (const faction of ctx.state.factions.values()) {
    if (faction.dissolvedDay !== null) continue;
    const members = [...ctx.state.factionMembers.values()].filter(
      (m) => m.factionId === faction.id && (m.leftDay === null || m.leftDay > ctx.day),
    );
    if (members.length === 0) {
      faction.dissolvedDay = ctx.day;
      continue;
    }
    active += 1;
    const adults = eligibleAdults(ctx).length;
    faction.supportBps = Math.min(10_000, Math.floor((members.length * 10_000) / Math.max(1, adults)));
    // Leadership passes to the most loyal member if the leader dies.
    if (faction.leaderId !== null) {
      const leader = ctx.state.residents.get(faction.leaderId);
      if (!leader || leader.status !== 'living') {
        const successor = members
          .map((m) => ctx.state.residents.get(m.residentId))
          .filter((r): r is Resident => r !== undefined && r.status === 'living')
          .sort((a, b) => a.id - b.id)[0];
        faction.leaderId = successor?.id ?? null;
      }
    }
    if (faction.supportBps === 0) faction.dissolvedDay = ctx.day;
  }

  // Factions form organically from sustained grievance plus ambition.
  const aggrieved = eligibleAdults(ctx).filter((r) => totalGrievance(ctx, r.id) >= 40);
  if (aggrieved.length >= 3) {
    const existingLeaderIds = new Set([...ctx.state.factions.values()].map((f) => f.leaderId));
    const leader = aggrieved
      .filter((r) => (r.traits.ambition ?? 0) >= 60 && !existingLeaderIds.has(r.id))
      .sort((a, b) => (b.traits.ambition ?? 0) - (a.traits.ambition ?? 0) || a.id - b.id)[0];
    if (leader) {
      const id = nextId(ctx.state, 'faction');
      const interest = totalGrievance(ctx, leader.id) > 0 ? 'fair_wages' : 'reform';
      ctx.state.factions.set(id, {
        id,
        name: `${leader.name.split(' ').slice(-1)[0]}'s circle`,
        interest,
        leaderId: leader.id,
        fundsCents: 0,
        supportBps: 0,
        createdDay: ctx.day,
        dissolvedDay: null,
      });
      for (const member of aggrieved.slice(0, 8)) {
        ctx.state.factionMembers.set(`${id}:${member.id}`, {
          key: `${id}:${member.id}`,
          factionId: id,
          residentId: member.id,
          joinedDay: ctx.day,
          leftDay: null,
          loyalty: 55,
        });
      }
      active += 1;
      ctx.emit({
        kind: 'faction_formed',
        actorId: leader.id,
        targetId: id,
        visibility: 'public',
        importance: 45,
        title: `A faction formed around ${leader.name}`,
        detail: { interest, members: aggrieved.slice(0, 8).map((m) => m.id) },
      });
    }
  }
  return active;
}

export function totalGrievance(ctx: TurnContext, residentId: number): number {
  let total = 0;
  for (const grievance of ctx.state.grievances.values()) {
    if (grievance.residentId !== residentId) continue;
    if (grievance.untilDay !== null && grievance.untilDay <= ctx.day) continue;
    total += grievance.severity;
  }
  return total;
}

export function updateLegitimacy(ctx: TurnContext): number {
  const adults = eligibleAdults(ctx);
  if (adults.length === 0) return 7_000;
  const aggrieved = adults.filter((r) => totalGrievance(ctx, r.id) >= 50).length;
  const ratio = aggrieved / adults.length;
  const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
  let legitimacy = 7_000 - Math.floor(ratio * 4_000);
  if (treasury < 5_000) legitimacy -= 1_000;
  if (treasury > 30_000) legitimacy += 500;
  legitimacy = Math.max(0, Math.min(10_000, legitimacy));
  ctx.state.counters.set('legitimacyBps', legitimacy);
  return legitimacy;
}

export function resolveGrievances(ctx: TurnContext, kind: string, amount: number): void {
  for (const grievance of ctx.state.grievances.values()) {
    if (grievance.kind !== kind) continue;
    grievance.severity = Math.max(0, grievance.severity - amount);
    if (grievance.severity === 0) grievance.untilDay = ctx.day;
  }
}

function bumpCounter(ctx: TurnContext, key: string, delta: number): void {
  ctx.state.counters.set(key, (ctx.state.counters.get(key) ?? 0) + delta);
}

export function officeHolderFor(ctx: TurnContext, office: Office): Resident | null {
  const seat = [...ctx.state.offices.values()]
    .filter((s) => s.office === office && s.holderId !== null)
    .filter((s) => s.untilDay === null || s.untilDay > ctx.day)
    .sort((a, b) => a.seat - b.seat)[0];
  if (!seat || seat.holderId === null) return null;
  const holder = ctx.state.residents.get(seat.holderId);
  return holder && holder.status === 'living' ? holder : null;
}

export const OFFICE_LIST = OFFICES;
