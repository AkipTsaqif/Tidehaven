import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { nextId, quantityOf, type Good, type Resident } from '../state.js';
import { balanceOf } from '../state.js';
import { addInjury } from './health.js';
import { addResidentGrievance } from './unrest.js';

/**
 * Crime and social conflict. Every attempt needs access, motive, opportunity, and a valid target;
 * success transfers real assets (never more than exist) and may leave evidence. A report creates an
 * allegation, never guilt — that is the justice phase's job.
 */

export interface ConflictReport {
  crimes: number;
  casesOpened: number;
  assaults: number;
  thefts: number;
  prevented: number;
}

const ACCESS_HOUSEHOLD = 1;

export function conflictPhase(ctx: TurnContext, plans: Map<number, ActorPlan>): ConflictReport {
  const report: ConflictReport = { crimes: 0, casesOpened: 0, assaults: 0, thefts: 0, prevented: 0 };
  const ordered = [...plans.values()].sort((a, b) => a.actorId - b.actorId);

  for (const actorPlan of ordered) {
    const actor = ctx.state.residents.get(actorPlan.actorId);
    if (!actor || actor.status !== 'living') continue;
    for (const intent of actorPlan.plan.intents ?? []) {
      switch (intent.kind) {
        case 'theft': {
          const outcome = attemptTheft(ctx, actor, intent.targetId ?? null, intent.businessId ?? null, intent.good ?? null, intent.quantity ?? 1);
          if (outcome === 'done') {
            report.crimes += 1;
            report.thefts += 1;
            report.casesOpened += 1;
          } else if (outcome === 'blocked') report.prevented += 1;
          break;
        }
        case 'fraud': {
          const outcome = attemptFraud(ctx, actor, intent.targetId ?? null, intent.businessId ?? null, intent.amountCents ?? 100);
          if (outcome) {
            report.crimes += 1;
            report.casesOpened += 1;
          }
          break;
        }
        case 'bribery': {
          attemptBribery(ctx, actor, intent.targetId ?? null, intent.amountCents ?? 100);
          report.crimes += 1;
          break;
        }
        case 'tax_evasion': {
          attemptTaxEvasion(ctx, actor, intent.businessId ?? null);
          report.crimes += 1;
          break;
        }
        case 'assault': {
          const outcome = attemptAssault(ctx, actor, intent.targetId ?? null, intent.detail ?? '');
          if (outcome) {
            report.crimes += 1;
            report.assaults += 1;
            report.casesOpened += 1;
          }
          break;
        }
        case 'sabotage': {
          const done = attemptSabotage(ctx, actor, intent.businessId ?? null);
          if (done) {
            report.crimes += 1;
            report.casesOpened += 1;
          }
          break;
        }
        case 'intimidate': {
          attemptIntimidate(ctx, actor, intent.targetId ?? null);
          break;
        }
        case 'guard_patrol': {
          ctx.state.counters.set('guardPatrol', ctx.day);
          ctx.emit({
            kind: 'guard_patrol',
            actorId: actor.id,
            targetId: null,
            visibility: 'public',
            importance: 10,
            title: `${actor.name} walked the night watch`,
            detail: {},
          });
          break;
        }
        case 'teach': {
          const student =
            intent.targetId === null || intent.targetId === undefined
              ? null
              : (ctx.state.residents.get(intent.targetId) ?? null);
          if (student && student.bornDay > ctx.day - ctx.scenario.calendar.adultDays) {
            student.educationDays += 1;
          }
          break;
        }
        case 'treat_patient': {
          const patient =
            intent.targetId === null || intent.targetId === undefined
              ? null
              : (ctx.state.residents.get(intent.targetId) ?? null);
          if (patient && (patient.healthState === 'injured' || patient.healthState === 'recovering')) {
            patient.healthState = 'recovering';
            ctx.state.counters.set('clinicAssist', (ctx.state.counters.get('clinicAssist') ?? 0) + 1);
          }
          break;
        }
        default:
          // strike/protest/riot/rebel belong to the unrest phase; rumour/conceal to the household phase.
          break;
      }
    }
  }

  return report;
}

type TheftOutcome = 'done' | 'blocked' | 'failed';

function attemptTheft(
  ctx: TurnContext,
  actor: Resident,
  targetResidentId: number | null,
  targetBusinessId: number | null,
  good: Good | null,
  quantity: number,
): TheftOutcome {
  const target = targetResidentId === null ? null : (ctx.state.residents.get(targetResidentId) ?? null);
  const business = targetBusinessId === null ? null : ctx.state.businesses.get(targetBusinessId);
  if (!target && !business) return 'blocked';
  if (target && target.status !== 'living') return 'blocked';

  const access = hasAccess(ctx, actor, target, targetBusinessId);
  if (access === 0) return 'blocked';

  const motive = (actor.traits.honesty ?? 50) < 45 || actor.hungerDays > 0;
  if (!motive && !rlChance(ctx, actor, 'theft-motive', 400)) return 'blocked';

  const wanted = good ?? 'bread';
  const ownerType = business ? 'business' : 'resident';
  const ownerId = business ? business.id : targetResidentId;
  if (ownerId === null) return 'blocked';
  // Household stock is the accessible store for a resident target.
  const storeType = target ? 'household' : ownerType;
  const storeId = target ? (target.householdId ?? target.id) : ownerId;
  if (storeId === null || storeId === undefined) return 'blocked';
  const stock = quantityOf(ctx.state, storeType, storeId, wanted);
  if (stock <= 0) return 'blocked';

  const skill = actor.skills.stealth ?? 0;
  // Skill contests are basis points, not parts-per-million: a competent attempt is a coin flip, not a
  // 0.5% lottery. (Motive stays a rare ppm roll, as documented in docs/RULES.md.)
  const contest = rollBps(ctx, actor, `theft-contest:${ownerId}`, 4_500 + skill * 200 + access * 800);
  if (!contest) {
    // Failed attempt: witnesses are likely.
    const witnesses = witnessChance(ctx, actor, 4_000);
    if (witnesses > 0) {
      openCase({ ctx,
        kind: 'theft',
        defendantId: actor.id,
        plaintiffId: target?.id ?? null,
        truth: { good: wanted, quantity: 0, failed: 1 },
        evidence: [{ kind: 'witness', weight: 5_500, isPublic: true }],
      });
      return 'failed';
    }
    return 'failed';
  }

  const stolen = Math.min(quantity, Math.max(1, Math.floor(stock / 4)));
  ctx.shiftGoods({ owner: { type: storeType, id: storeId }, good: wanted, delta: -stolen, reason: 'theft_loss' });
  ctx.shiftGoods({ owner: { type: 'resident', id: actor.id }, good: wanted, delta: stolen, reason: 'theft_gain' });
  actor.skills.stealth = skill + 1;

  ctx.emit({
    kind: 'theft',
    actorId: actor.id,
    targetId: target?.id ?? null,
    locationId: business?.buildingId ?? null,
    visibility: 'secret',
    importance: 40,
    title: `${stolen} ${wanted} went missing`,
    detail: { good: wanted, quantity: stolen, storeType, storeId },
  });

  const witnesses = witnessChance(ctx, actor, access > ACCESS_HOUSEHOLD ? 3_000 : 800);
  if (witnesses > 0) {
    openCase({ ctx,
      kind: 'theft',
      defendantId: actor.id,
      plaintiffId: target?.id ?? null,
      truth: { good: wanted, quantity: stolen },
      evidence: [{ kind: 'witness', weight: 6_000, isPublic: true }],
    });
    addResidentGrievance(ctx, target?.id ?? null, 'theft', 30, `Lost ${stolen} ${wanted}`);
    return 'done';
  }
  return 'done';
}

/**
 * Physical/social access to the thing being stolen.
 *
 * Access is a *precondition*, not a bonus. Sharing a household is the strongest case; sharing the
 * same premises (two households in one building) is a weaker one; being employed at the target
 * business is access to its stores. A housed victim unrelated to the actor grants no access at all —
 * that was the bug that let any resident rob any household.
 */
function hasAccess(
  ctx: TurnContext,
  actor: Resident,
  target: Resident | null,
  businessId: number | null,
): number {
  if (target) {
    if (actor.householdId === null || target.householdId === null) return 0;
    if (actor.householdId === target.householdId) return ACCESS_HOUSEHOLD;
    // Shared premises: co-residents of one building can reach each other's stores.
    const actorHome = ctx.state.households.get(actor.householdId)?.buildingId ?? null;
    const targetHome = ctx.state.households.get(target.householdId)?.buildingId ?? null;
    if (actorHome !== null && targetHome !== null && actorHome === targetHome) return 1;
    return 0;
  }
  if (businessId !== null) {
    const employed = [...ctx.state.contracts.values()].some(
      (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === businessId && c.aId === actor.id,
    );
    if (employed) return 2;
    // Living in the same building as the business also grants physical access to the premises.
    const business = ctx.state.businesses.get(businessId);
    const buildingId = business?.buildingId ?? null;
    if (buildingId !== null && actor.householdId !== null) {
      const home = ctx.state.households.get(actor.householdId)?.buildingId ?? null;
      if (home !== null && home === buildingId) return 1;
    }
    return 0;
  }
  return 0;
}

/** An active office held by this resident, if any (clerk/magistrate/councillor all handle accounts). */
function officeHeld(ctx: TurnContext, residentId: number): string | null {
  for (const seat of ctx.state.offices.values()) {
    if (seat.holderId === residentId && seat.untilDay === null) return seat.office;
  }
  return null;
}

/** Money that has actually flowed *to* an owner today (the eligible base for a fraud cap). */
function recordedInflow(ctx: TurnContext, ownerType: 'resident' | 'business', ownerId: number): number {
  let total = 0;
  for (const entry of ctx.ledger) {
    if (entry.ownerType !== ownerType || entry.ownerId !== ownerId) continue;
    if (entry.deltaCents > 0) total += entry.deltaCents;
  }
  return total;
}

/**
 * Fraud / embezzlement.
 *
 * Requires an actual role (office or business role over the target) and an identified, traceable flow
 * to skim. The cap is 5% of that flow — never 5% of a standing balance, which would let a fraudster
 * drain savings that never moved.
 */
function attemptFraud(
  ctx: TurnContext,
  actor: Resident,
  targetResidentId: number | null,
  targetBusinessId: number | null,
  amountCents: number,
): boolean {
  const office = officeHeld(ctx, actor.id);
  let targetType: 'resident' | 'business';
  let targetId: number;
  let flowCents: number;
  let plaintiffId: number | null;

  if (targetBusinessId !== null) {
    const business = ctx.state.businesses.get(targetBusinessId);
    if (!business || business.status !== 'open') return false;
    const hasBusinessRole = business.ownerId === actor.id || business.managerId === actor.id;
    // An office or a role over the business is required; a stranger cannot "defraud" it.
    if (!hasBusinessRole && office === null) return false;
    // Identified eligible flow: the recorded revenue this business actually took.
    flowCents = ctx.state.counters.get(`revenue:${targetBusinessId}`) ?? 0;
    targetType = 'business';
    targetId = targetBusinessId;
    plaintiffId = business.ownerId;
  } else if (targetResidentId !== null) {
    const target = ctx.state.residents.get(targetResidentId);
    if (!target || target.status !== 'living' || target.id === actor.id) return false;
    // Only someone with administrative access to another resident's account can embezzle from it.
    if (office === null) return false;
    flowCents = recordedInflow(ctx, 'resident', target.id);
    targetType = 'resident';
    targetId = target.id;
    plaintiffId = target.id;
  } else {
    return false;
  }

  if (flowCents <= 0) return false;
  const cap = Math.max(1, Math.floor(flowCents / 20)); // never more than 5% of the touched flow
  const amount = Math.min(amountCents, cap, balanceOf(ctx.state, targetType, targetId));
  if (amount <= 0) return false;

  const success = rollBps(ctx, actor, `fraud:${targetId}`, 3_500 + (actor.traits.sociability ?? 50) * 30);
  if (!success) return false;
  ctx.transfer({
    from: { type: targetType, id: targetId },
    to: { type: 'resident', id: actor.id },
    cents: amount,
    reason: 'fraud_proceeds',
  });
  ctx.emit({
    kind: 'fraud',
    actorId: actor.id,
    targetId,
    visibility: 'secret',
    importance: 45,
    title: `An account was short by ${amount} cents`,
    detail: { amountCents: amount, targetType, touchedFlowCents: flowCents, role: office ?? 'business_role' },
  });
  if (witnessChance(ctx, actor, 2_500) > 0) {
    openCase({
      ctx,
      kind: 'fraud',
      defendantId: actor.id,
      plaintiffId,
      truth: { amountCents: amount, touchedFlowCents: flowCents },
      evidence: [{ kind: 'records', weight: 6_500, isPublic: true }],
    });
  }
  return true;
}

function attemptBribery(ctx: TurnContext, actor: Resident, officialId: number | null, amountCents: number): void {
  const official = officialId === null ? null : ctx.state.residents.get(officialId);
  if (!official || official.status !== 'living') return;
  const isOfficial = [...ctx.state.offices.values()].some((s) => s.holderId === official.id && s.untilDay === null);
  if (!isOfficial) return;
  const amount = Math.min(amountCents, balanceOf(ctx.state, 'resident', actor.id));
  if (amount <= 0) return;
  ctx.transfer({
    from: { type: 'resident', id: actor.id },
    to: { type: 'resident', id: official.id },
    cents: amount,
    reason: 'bribe',
  });
  // Find an open case against the actor and weaken the prosecution within bounds.
  for (const caseRecord of ctx.state.cases.values()) {
    if (caseRecord.defendantId !== actor.id) continue;
    if (caseRecord.status !== 'investigating' && caseRecord.status !== 'trial') continue;
    caseRecord.prosecutionBps = Math.max(0, caseRecord.prosecutionBps - Math.min(1_500, Math.floor(amount / 2)));
  }
  ctx.emit({
    kind: 'bribery',
    actorId: actor.id,
    targetId: official.id,
    visibility: 'secret',
    importance: 55,
    title: `${actor.name} paid ${official.name} for influence`,
    detail: { amountCents: amount },
  });
  if (witnessChance(ctx, actor, 3_000) > 0) {
    openCase({ ctx,
      kind: 'corruption',
      defendantId: official.id,
      plaintiffId: actor.id,
      truth: { amountCents: amount, briberId: actor.id },
      evidence: [{ kind: 'ledger', weight: 7_000, isPublic: true }],
    });
    addResidentGrievance(ctx, official.id, 'corruption_suspicion', 30, 'Suspected of taking bribes');
  }
}

function attemptTaxEvasion(ctx: TurnContext, actor: Resident, businessId: number | null): void {
  if (businessId === null) return;
  const business = ctx.state.businesses.get(businessId);
  if (!business || business.ownerId !== actor.id || business.status !== 'open') return;
  const cash = balanceOf(ctx.state, 'business', businessId);
  const hidden = Math.floor(cash / 10);
  if (hidden <= 0) return;
  ctx.transfer({
    from: { type: 'business', id: businessId },
    to: { type: 'resident', id: actor.id },
    cents: hidden,
    reason: 'untaxed_draw',
  });
  ctx.emit({
    kind: 'tax_evasion',
    actorId: actor.id,
    targetId: businessId,
    visibility: 'secret',
    importance: 35,
    title: `${business.name} paid its owner under the table`,
    detail: { amountCents: hidden },
  });
  if (witnessChance(ctx, actor, 2_000) > 0) {
    openCase({ ctx,
      kind: 'fraud',
      defendantId: actor.id,
      plaintiffId: null,
      truth: { amountCents: hidden, taxEvasion: 1 },
      evidence: [{ kind: 'ledger', weight: 7_500, isPublic: true }],
    });
  }
}

function attemptAssault(ctx: TurnContext, actor: Resident, targetId: number | null, detail: string): boolean {
  const target = targetId === null ? null : ctx.state.residents.get(targetId);
  if (!target || target.status !== 'living' || target.id === actor.id) return false;
  if (target.bornDay > ctx.day - ctx.scenario.calendar.adultDays) {
    addResidentGrievance(ctx, target.id, 'guardianship', 10, 'A child was threatened');
    return false;
  }
  const attackSkill = (actor.traits.temper ?? 50) + (actor.skills.brawling ?? 0) * 10;
  const defenceSkill = (target.traits.diligence ?? 50) + (target.skills.brawling ?? 0) * 10;
  const attackerWins = rollBps(ctx, actor, `assault:${target.id}`, 5_000 + (attackSkill - defenceSkill) * 10);
  if (!attackerWins) {
    target.skills.brawling = (target.skills.brawling ?? 0) + 1;
    ctx.emit({
      kind: 'scuffle',
      actorId: actor.id,
      targetId: target.id,
      visibility: 'public',
      importance: 30,
      title: `${actor.name} came off worse in a fight with ${target.name}`,
      detail: {},
    });
    if (witnessChance(ctx, actor, 6_000) > 0) {
      openCase({ ctx,
        kind: 'assault',
        defendantId: actor.id,
        plaintiffId: target.id,
        truth: { targetId: target.id, failed: 1 },
        evidence: [{ kind: 'witness', weight: 6_000, isPublic: true }],
      });
    }
    return false;
  }

  const severity = Math.min(3, 1 + Math.floor((attackSkill - defenceSkill) / 40));
  const injuryId = addInjury({ ctx, residentId: target.id, kind: 'assault', severity, days: 5 + severity * 5 });
  actor.skills.brawling = (actor.skills.brawling ?? 0) + 1;

  ctx.emit({
    kind: 'assault',
    actorId: actor.id,
    targetId: target.id,
    visibility: 'public',
    importance: 65,
    title: `${target.name} was attacked`,
    detail: { severity, injuryId, intent: detail },
  });
  addResidentGrievance(ctx, target.id, 'assault', 50, `Attacked by ${actor.name}`);

  // A fatal outcome is classified later by the justice phase, never declared here.
  const witnesses = witnessChance(ctx, actor, 7_000);
  openCase({ ctx,
    kind: 'assault',
    defendantId: actor.id,
    plaintiffId: target.id,
    truth: { targetId: target.id, severity, injuryId },
    evidence: witnesses > 0 ? [{ kind: 'witness', weight: 7_000, isPublic: true }] : [],
  });
  return true;
}

function attemptSabotage(ctx: TurnContext, actor: Resident, businessId: number | null): boolean {
  if (businessId === null) return false;
  const business = ctx.state.businesses.get(businessId);
  if (!business || business.status !== 'open') return false;

  // Sabotage needs the same opportunity tests as theft: a stranger cannot quietly reach the stores of
  // a business they have no connection to. Employment, management, ownership, or living on the
  // premises grants access; everything else is refused before any stock changes.
  const role =
    business.ownerId === actor.id ||
    business.managerId === actor.id ||
    [...ctx.state.contracts.values()].some(
      (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === businessId && c.aId === actor.id,
    );
  if (!role) {
    const buildingId = business.buildingId;
    const home = actor.householdId === null ? null : ctx.state.households.get(actor.householdId)?.buildingId ?? null;
    if (buildingId === null || home === null || home !== buildingId) return false;
  }
  // Motive: a grudge or a volatile temperament, matching the theft motive rule.
  const motive = (actor.traits.temper ?? 50) >= 60 || actor.hungerDays > 0;
  if (!motive && !rlChance(ctx, actor, 'sabotage-motive', 400)) return false;

  const good: Good = business.kind === 'bakery' ? 'grain' : business.kind === 'workshop' ? 'timber' : 'tools';
  const stock = quantityOf(ctx.state, 'business', businessId, good);
  if (stock <= 0) return false;
  const lost = Math.max(1, Math.floor(stock / 10));
  const success = rollBps(ctx, actor, `sabotage:${businessId}`, 3_000 + (actor.traits.temper ?? 50) * 20);
  if (!success) return false;
  ctx.shiftGoods({ owner: { type: 'business', id: businessId }, good, delta: -lost, reason: 'sabotage' });
  ctx.emit({
    kind: 'sabotage',
    actorId: actor.id,
    targetId: businessId,
    locationId: business.buildingId,
    visibility: 'secret',
    importance: 45,
    title: `${business.name} lost ${lost} ${good} to sabotage`,
    detail: { good, quantity: lost },
  });
  if (witnessChance(ctx, actor, 3_000) > 0) {
    openCase({ ctx,
      kind: 'fraud',
      defendantId: actor.id,
      plaintiffId: business.ownerId,
      truth: { sabotage: 1, businessId, good, quantity: lost },
      evidence: [{ kind: 'witness', weight: 5_000, isPublic: true }],
    });
    return true;
  }
  return true;
}

function attemptIntimidate(ctx: TurnContext, actor: Resident, targetId: number | null): void {
  const target = targetId === null ? null : ctx.state.residents.get(targetId);
  if (!target || target.status !== 'living') return;
  const success = rollBps(ctx, actor, `intimidate:${target.id}`, 4_500);
  if (!success) return;
  addResidentGrievance(ctx, target.id, 'intimidation', 25, `Threatened by ${actor.name}`);
  ctx.emit({
    kind: 'intimidation',
    actorId: actor.id,
    targetId: target.id,
    visibility: 'private',
    importance: 30,
    title: `${target.name} was threatened`,
    detail: {},
  });
}

export function openCase(params: {
  ctx: TurnContext;
  kind: 'theft' | 'fraud' | 'corruption' | 'assault' | 'murder' | 'estate_dispute' | 'unrest' | 'rebelling';
  defendantId: number;
  plaintiffId: number | null;
  truth: Record<string, number | string>;
  evidence: { kind: string; weight: number; isPublic: boolean }[];
}): number {
  const { ctx } = params;
  const id = nextId(ctx.state, 'case');
  ctx.state.cases.set(id, {
    id,
    kind: params.kind,
    defendantId: params.defendantId,
    plaintiffId: params.plaintiffId,
    openedDay: ctx.day,
    status: 'investigating',
    investigationDays: 0,
    prosecutionBps: 0,
    defenceBps: 0,
    verdict: null,
    closedDay: null,
    disputedEstateId: typeof params.truth.estateId === 'number' ? params.truth.estateId : null,
    truth: params.truth,
  });
  for (const item of params.evidence) {
    const evidenceId = nextId(ctx.state, 'evidence');
    ctx.state.evidence.set(evidenceId, {
      id: evidenceId,
      caseId: id,
      kind: item.kind,
      weightBps: item.weight,
      public: item.isPublic,
      sourceEventId: null,
      createdDay: ctx.day,
    });
  }
  const defendant = ctx.state.residents.get(params.defendantId);
  ctx.emit({
    kind: 'case_opened',
    actorId: params.plaintiffId,
    targetId: params.defendantId,
    visibility: 'public',
    importance: 50,
    title: `A ${params.kind.replace(/_/g, ' ')} complaint was filed against ${defendant?.name ?? 'a resident'}`,
    detail: { caseId: id, kind: params.kind },
  });
  if (defendant) {
    for (const observation of [...ctx.state.residents.values()].filter((r) => r.status === 'living').slice(0, 8)) {
      if (observation.id === defendant.id) continue;
      ctx.observe(observation.id, ctx.events[ctx.events.length - 1]?.id ?? 0, `A complaint was filed against ${defendant.name}.`);
    }
  }
  return id;
}

/** Witness probability is expressed in basis points (documented ppm values become bps here). */
function witnessChance(ctx: TurnContext, actor: Resident, bps: number): number {
  // A guard on patrol makes the town more watchful.
  const patrolBoost = ctx.state.counters.get('guardPatrol') === ctx.day ? 1_500 : 0;
  const rng = ctx.rngFor(actor.id, `witness:${ctx.day}`);
  if (!rng.chanceBps(Math.min(9_500, bps + patrolBoost))) return 0;
  return 1;
}

/** Skill contest roll in basis points, clamped to a sane band. */
function rollBps(ctx: TurnContext, actor: Resident, label: string, bps: number): boolean {
  return ctx.rngFor(actor.id, label).chanceBps(Math.max(300, Math.min(9_500, bps)));
}

function rlChance(ctx: TurnContext, actor: Resident, label: string, ppm: number): boolean {
  return ctx.rngFor(actor.id, label).chancePpm(ppm);
}
