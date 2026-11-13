import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import type { MarketReport } from '../economy/market.js';
import { nextId, quantityOf, type Good } from '../state.js';
import { addInjury } from './health.js';
import { officeHolderFor, resolveGrievances, totalGrievance, updateLegitimacy } from './politics.js';

/**
 * Collective unrest: strikes, protests, riots, and rebellion.
 *
 * Escalation has explicit thresholds. A protest only becomes a riot when documented conditions hold
 * and de-escalation has failed; a rebellion requires sustained grievance, organised backing, and weak
 * legitimacy. Every unrest state has a closure path and leaves the town's obligations intact.
 */

export interface UnrestReport {
  active: number;
  started: number;
  resolved: number;
  riotDamageCents: number;
  rebellionActive: boolean;
  authorityChanged: boolean;
}

export function addResidentGrievance(
  ctx: TurnContext,
  residentId: number | null,
  kind: string,
  severity: number,
  reason: string,
): void {
  if (residentId === null) {
    // Town-wide grievance (no specific resident) is tracked as a counter.
    ctx.state.counters.set(`grievanceWeight:${kind}`, (ctx.state.counters.get(`grievanceWeight:${kind}`) ?? 0) + severity);
    return;
  }
  const resident = ctx.state.residents.get(residentId);
  if (!resident || resident.status !== 'living') return;
  for (const grievance of ctx.state.grievances.values()) {
    if (grievance.residentId !== residentId || grievance.kind !== kind) continue;
    if (grievance.untilDay !== null && grievance.untilDay <= ctx.day) continue;
    grievance.severity = Math.min(100, grievance.severity + severity);
    return;
  }
  const id = nextId(ctx.state, 'grievance');
  ctx.state.grievances.set(id, {
    id,
    residentId,
    kind,
    severity: Math.min(100, severity),
    sinceDay: ctx.day,
    untilDay: null,
    reason,
  });
}

export function unrestPhase(ctx: TurnContext, plans: Map<number, ActorPlan>, market: MarketReport): UnrestReport {
  const report: UnrestReport = {
    active: 0,
    started: 0,
    resolved: 0,
    riotDamageCents: 0,
    rebellionActive: false,
    authorityChanged: false,
  };

  // Hunger and shortage create real grievances for the households that went without.
  if (market.shortage) {
    for (const resident of ctx.state.residents.values()) {
      if (resident.status !== 'living' || resident.hungerDays === 0) continue;
      addResidentGrievance(ctx, resident.id, 'hunger', 12, 'Not enough food in the house');
    }
  }

  // Grievances fade slowly when nothing renews them.
  for (const grievance of ctx.state.grievances.values()) {
    if (grievance.untilDay !== null && grievance.untilDay <= ctx.day) continue;
    grievance.severity = Math.max(0, grievance.severity - 1);
    if (grievance.severity === 0) grievance.untilDay = ctx.day;
  }

  // Actions from plans: calls for a strike/protest/riot/rebellion.
  const ordered = [...plans.values()].sort((a, b) => a.actorId - b.actorId);
  for (const actorPlan of ordered) {
    const actor = ctx.state.residents.get(actorPlan.actorId);
    if (!actor || actor.status !== 'living') continue;
    for (const intent of actorPlan.plan.intents ?? []) {
      if (intent.kind === 'strike_call') {
        const businessId = intent.businessId ?? null;
        if (businessId === null) continue;
        const support = [...ctx.state.contracts.values()].filter(
          (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === businessId,
        );
        if (support.length < 2) continue;
        if (hasActive(ctx, 'strike', businessId)) continue;
        const id = nextId(ctx.state, 'unrest');
        ctx.state.unrest.set(id, {
          id,
          kind: 'strike',
          startedDay: ctx.day,
          endedDay: null,
          demands: { businessId, wageBoostBps: 500 },
          participants: support.map((c) => c.aId),
          status: 'active',
          severity: 1,
        });
        report.started += 1;
        ctx.emit({
          kind: 'strike_started',
          actorId: actor.id,
          targetId: businessId,
          visibility: 'public',
          importance: 55,
          title: `Workers at ${ctx.state.businesses.get(businessId)?.name ?? 'a business'} walked out`,
          detail: { participants: support.map((c) => c.aId) },
        });
      }
      if (intent.kind === 'protest_call') {
        const support = [...ctx.state.residents.values()].filter(
          (r) => r.status === 'living' && totalGrievance(ctx, r.id) >= 20,
        );
        if (support.length < 3) continue;
        const id = nextId(ctx.state, 'unrest');
        ctx.state.unrest.set(id, {
          id,
          kind: 'protest',
          startedDay: ctx.day,
          endedDay: null,
          demands: { grievance: 'fair_treatment' },
          participants: support.map((r) => r.id),
          status: 'active',
          severity: 1,
        });
        report.started += 1;
        ctx.emit({
          kind: 'protest_started',
          actorId: actor.id,
          targetId: null,
          visibility: 'public',
          importance: 60,
          title: 'A crowd gathered outside the Town Hall',
          detail: { participants: support.map((r) => r.id), demand: intent.detail ?? 'fair treatment' },
        });
      }
      if (intent.kind === 'riot_call') {
        if (ctx.state.counters.get('legitimacyBps') === undefined) updateLegitimacy(ctx);
        const legitimacy = ctx.state.counters.get('legitimacyBps') ?? 7_000;
        const protest = [...ctx.state.unrest.values()].find((u) => u.kind === 'protest' && u.status === 'active');
        if (!protest || legitimacy > 4_000) continue;
        riot(ctx, protest.participants, report);
      }
      if (intent.kind === 'rebel') {
        attemptRebellion(ctx, actor.id, report);
      }
    }
  }

  // Threshold-driven escalation for existing unrest.
  for (const item of ctx.state.unrest.values()) {
    if (item.status !== 'active') continue;
    report.active += 1;
    const age = ctx.day - item.startedDay;
    if (item.kind === 'protest' && age >= 5) {
      const legitimacy = ctx.state.counters.get('legitimacyBps') ?? 7_000;
      const severity = meanGrievance(ctx, item.participants);
      if (legitimacy < 4_000 && severity >= 45 && ctx.rngFor(item.id, 'escalate').chanceBps(3_000)) {
        riot(ctx, item.participants, report);
        item.status = 'suppressed';
        item.endedDay = ctx.day;
      } else if (age >= 30) {
        item.status = 'resolved';
        item.endedDay = ctx.day;
        report.resolved += 1;
        resolveGrievances(ctx, 'hunger', 10);
        ctx.emit({
          kind: 'protest_ended',
          actorId: null,
          targetId: item.id,
          visibility: 'public',
          importance: 40,
          title: 'The protest broke up',
          detail: { age },
        });
      }
    }

    if (item.kind === 'strike') {
      const businessId = typeof item.demands.businessId === 'number' ? item.demands.businessId : null;
      const support = meanGrievance(ctx, item.participants);
      // A strike lasts at least three days: real walkouts are not settled the same afternoon.
      if (age >= 20 || (age >= 3 && support < 15)) {
        item.status = 'resolved';
        item.endedDay = ctx.day;
        report.resolved += 1;
        ctx.emit({
          kind: 'strike_ended',
          actorId: null,
          targetId: businessId,
          visibility: 'public',
          importance: 40,
          title: 'The strike ended and work resumed',
          detail: { age },
        });
      }
    }

    if (item.kind === 'riot' && age >= 3) {
      item.status = 'suppressed';
      item.endedDay = ctx.day;
      report.resolved += 1;
      // Arrests: at most 2 participants with the highest grievance are charged as unrest cases.
      const charged = item.participants
        .map((id) => ctx.state.residents.get(id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined && r.status === 'living')
        .sort((a, b) => totalGrievance(ctx, b.id) - totalGrievance(ctx, a.id))
        .slice(0, 2);
      for (const resident of charged) {
        ctx.emit({
          kind: 'arrest',
          actorId: resident.id,
          targetId: null,
          visibility: 'public',
          importance: 45,
          title: `${resident.name} was arrested after the riot`,
          detail: { unrestId: item.id },
        });
        resolveGrievances(ctx, 'hunger', 5);
      }
    }

    if (item.kind === 'rebellion') {
      report.rebellionActive = true;
      const ageDays = ctx.day - item.startedDay;
      if (ageDays >= 30) {
        resolveRebellion(ctx, item, report);
      }
    }
  }

  // Rebellion opportunity from sustained grievance + faction backing + weak legitimacy.
  if (![...ctx.state.unrest.values()].some((u) => u.kind === 'rebellion' && u.status === 'active')) {
    maybeStartRebellion(ctx, report);
  }

  return report;
}

function hasActive(ctx: TurnContext, kind: string, businessId: number): boolean {
  return [...ctx.state.unrest.values()].some(
    (u) => u.kind === kind && u.status === 'active' && u.demands.businessId === businessId,
  );
}

function meanGrievance(ctx: TurnContext, participants: number[]): number {
  if (participants.length === 0) return 0;
  let total = 0;
  for (const id of participants) total += totalGrievance(ctx, id);
  return Math.floor(total / participants.length);
}

function riot(ctx: TurnContext, participants: number[], report: UnrestReport): void {
  const id = nextId(ctx.state, 'unrest');
  ctx.state.unrest.set(id, {
    id,
    kind: 'riot',
    startedDay: ctx.day,
    endedDay: null,
    demands: { grievance: 'fair_treatment' },
    participants: participants.slice(0, 40),
    status: 'active',
    severity: 2,
  });
  report.started += 1;

  // Bounded material damage: one business, at most 10% of one good.
  const businesses = [...ctx.state.businesses.values()].filter((b) => b.status === 'open').sort((a, b) => a.id - b.id);
  const target = businesses[ctx.rngFor('riot', 'target').int(0, Math.max(0, businesses.length - 1))];
  if (target) {
    for (const good of ['grain', 'bread', 'tools'] as Good[]) {
      const stock = quantityOf(ctx.state, 'business', target.id, good);
      if (stock <= 0) continue;
      const lost = Math.max(1, Math.floor(stock / 10));
      ctx.shiftGoods({ owner: { type: 'business', id: target.id }, good, delta: -lost, reason: 'riot_damage' });
      report.riotDamageCents += lost * (ctx.state.prices.get(good) ?? 100);
      break;
    }
  }
  // Bounded injuries, always through the health resolver.
  for (const residentId of participants.slice(0, 8)) {
    const resident = ctx.state.residents.get(residentId);
    if (!resident || resident.status !== 'living') continue;
    if (!ctx.rngFor(residentId, 'riot-injury').chanceBps(1_500)) continue;
    addInjury({ ctx, residentId, kind: 'riot', severity: 1, days: 5 });
  }

  ctx.emit({
    kind: 'riot',
    actorId: null,
    targetId: target?.id ?? null,
    visibility: 'public',
    importance: 85,
    title: 'The protest turned into a riot',
    detail: { participants: participants.length, targetBusinessId: target?.id ?? null },
  });
}

function maybeStartRebellion(ctx: TurnContext, report: UnrestReport): void {
  const adults = [...ctx.state.residents.values()].filter(
    (r) => r.status === 'living' && r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays,
  );
  if (adults.length < 5) return;
  const stronglyAggrieved = adults.filter((r) => totalGrievance(ctx, r.id) >= 60).length;
  const ratioBps = Math.floor((stronglyAggrieved * 10_000) / adults.length);
  if (ratioBps < 2_500) {
    ctx.state.counters.set('rebellionPressureDays', 0);
    return;
  }
  const days = (ctx.state.counters.get('rebellionPressureDays') ?? 0) + 1;
  ctx.state.counters.set('rebellionPressureDays', days);
  const legitimacy = ctx.state.counters.get('legitimacyBps') ?? updateLegitimacy(ctx);
  if (days < 30 || legitimacy > 3_500) return;

  const faction = [...ctx.state.factions.values()]
    .filter((f) => f.dissolvedDay === null && f.supportBps >= 4_000)
    .sort((a, b) => b.supportBps - a.supportBps)[0];
  if (!faction) return;

  const id = nextId(ctx.state, 'unrest');
  ctx.state.unrest.set(id, {
    id,
    kind: 'rebellion',
    startedDay: ctx.day,
    endedDay: null,
    demands: { concession: 'council_seat', factionId: faction.id },
    participants: [...ctx.state.factionMembers.values()]
      .filter((m) => m.factionId === faction.id && (m.leftDay === null || m.leftDay > ctx.day))
      .map((m) => m.residentId),
    status: 'active',
    severity: 3,
  });
  report.started += 1;
  report.rebellionActive = true;
  ctx.emit({
    kind: 'rebellion_started',
    actorId: faction.leaderId,
    targetId: faction.id,
    visibility: 'public',
    importance: 100,
    title: 'Open rebellion against the council',
    detail: { supportBps: faction.supportBps, legitimacyBps: legitimacy, grievanceRatioBps: ratioBps },
  });
}

function attemptRebellion(ctx: TurnContext, actorId: number, report: UnrestReport): void {
  const legitimacy = ctx.state.counters.get('legitimacyBps') ?? 7_000;
  const support = totalGrievance(ctx, actorId);
  if (legitimacy > 4_500 || support < 60) {
    ctx.emit({
      kind: 'rebellion_rejected',
      actorId,
      targetId: null,
      visibility: 'private',
      importance: 20,
      title: 'A call for rebellion found no support',
      detail: { legitimacyBps: legitimacy, grievance: support },
    });
    return;
  }
  maybeStartRebellion(ctx, report);
}

function resolveRebellion(ctx: TurnContext, item: { id: number; demands: Record<string, number | string>; participants: number[]; startedDay: number; status: string; endedDay: number | null }, report: UnrestReport): void {
  const legitimacy = ctx.state.counters.get('legitimacyBps') ?? 7_000;
  const rng = ctx.rngFor(item.id, 'settlement');
  item.status = 'resolved';
  item.endedDay = ctx.day;
  report.resolved += 1;

  if (legitimacy < 2_000 && rng.chanceBps(4_000)) {
    // Bounded authority change: the council seats go to the rebellion's faction, property untouched.
    const factionId = typeof item.demands.factionId === 'number' ? item.demands.factionId : null;
    const faction = factionId === null ? null : ctx.state.factions.get(factionId);
    const leader = faction?.leaderId === null || faction?.leaderId === undefined ? null : ctx.state.residents.get(faction.leaderId);
    if (leader && leader.status === 'living') {
      const seats = [...ctx.state.offices.values()].filter((s) => s.office === 'councillor').sort((a, b) => a.seat - b.seat);
      seats.forEach((seat) => {
        seat.holderId = leader.id;
        seat.sinceDay = ctx.day;
        seat.untilDay = ctx.day + ctx.scenario.calendar.daysPerYear;
      });
      report.authorityChanged = true;
      ctx.emit({
        kind: 'authority_changed',
        actorId: leader.id,
        targetId: factionId,
        visibility: 'public',
        importance: 100,
        title: `${leader.name} took control of the council`,
        detail: { rebellionId: item.id },
      });
    }
  } else {
    // Negotiated settlement: concessions on grievances, offices and property untouched.
    for (const participant of item.participants.slice(0, 20)) {
      resolveGrievances(ctx, 'hunger', 25);
      resolveGrievances(ctx, 'unpaid_wages', 25);
      resolveGrievances(ctx, 'wage_conditions', 25);
      addResidentGrievance(ctx, participant, 'settled', 0, 'Rebellion settled');
    }
    ctx.emit({
      kind: 'rebellion_settled',
      actorId: null,
      targetId: item.id,
      visibility: 'public',
      importance: 90,
      title: 'The rebellion ended in a negotiated settlement',
      detail: { rebellionId: item.id },
    });
  }
  ctx.state.counters.set('rebellionPressureDays', 0);
}

export function officeholderForUnrest(ctx: TurnContext, office: 'magistrate' | 'guard_captain'): number | null {
  const holder = officeHolderFor(ctx, office);
  return holder?.id ?? null;
}
