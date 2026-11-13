import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { lifeStage } from '../clock.js';
import { balanceOf, nextId, relationshipKey, type Relationship, type Resident } from '../state.js';
import { createHousehold, householdFoodDays, householdMembers, moveResident, findVacantHome } from './households.js';
import { moodConceptionPercent } from './happiness.js';

/**
 * Household and relationship phase: courtship, affairs, conception, divorce, friendship, feuds.
 *
 * Consent is explicit: a proposal only becomes a relationship when the other party issues an accept for
 * that proposal before it expires. Silence is refusal. Affairs and pregnancies additionally require
 * eligibility, capacity, and (for conception) food security.
 */

export function householdPhase(ctx: TurnContext, plans: Map<number, ActorPlan>): void {
  // Actions in a deterministic order (by actor id, then action kind) so provider ordering never leaks.
  const ordered = [...plans.values()].sort((a, b) => a.actorId - b.actorId);
  for (const actorPlan of ordered) {
    const actor = ctx.state.residents.get(actorPlan.actorId);
    if (!actor || actor.status !== 'living') {
      logRejected(ctx, actorPlan, 'actor_unavailable');
      continue;
    }
    const social = actorPlan.plan.social;
    if (social) applySocialAction(ctx, actor, actorPlan, social.kind, social.targetId ?? null, social.detail ?? '');
    for (const intent of actorPlan.plan.intents ?? []) {
      if (intent.kind === 'conceal_affair') {
        concealAffair(ctx, actor, intent.targetId ?? null);
      }
      if (intent.kind === 'spread_rumour') {
        spreadRumour(ctx, actor, intent.targetId ?? null, intent.detail ?? '');
      }
    }
  }

  // Existing courtships progress: seeded chance of a next step, never automatic consent.
  discoveryPhase(ctx);
}

function applySocialAction(
  ctx: TurnContext,
  actor: Resident,
  actorPlan: ActorPlan,
  kind: string,
  targetId: number | null,
  detail: string,
): void {
  const target = targetId === null ? null : ctx.state.residents.get(targetId);
  switch (kind) {
    case 'courtship':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return propose(ctx, actor, target, 'courtship', actorPlan);
    case 'affair':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return propose(ctx, actor, target, 'affair', actorPlan);
    case 'conceive':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return propose(ctx, actor, target, 'conception', actorPlan, { detail });
    case 'accept':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return acceptProposal(ctx, actor, target, actorPlan);
    case 'refuse':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return refuseProposal(ctx, actor, target, actorPlan);
    case 'divorce':
      return divorce(ctx, actor, targetId, actorPlan);
    case 'talk':
    case 'befriend':
    case 'reconcile':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return adjustTrust(ctx, actor, target, kind === 'reconcile' ? 18 : 8, kind);
    case 'feud':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return startFeud(ctx, actor, target, detail);
    case 'report_crime':
    case 'accuse':
      // Handled by the conflict/justice phases; recorded here so nothing is silently dropped.
      logRejected(ctx, actorPlan, 'handled_in_conflict_phase');
      return;
    case 'defend':
      logRejected(ctx, actorPlan, 'handled_in_justice_phase');
      return;
    case 'apologise':
      if (!target) return logRejected(ctx, actorPlan, 'no_target');
      return adjustTrust(ctx, actor, target, 12, 'apologise');
    // Housing-sharing actions are resolved by the dedicated housing phase. Keep them out of the
    // romantic resolver so a valid growth action is not recorded as an unknown social action while
    // that phase is being introduced.
    case 'request_housing':
    case 'accept_housing':
    case 'refuse_housing':
      return;
    default:
      logRejected(ctx, actorPlan, 'unknown_social_action');
  }
}

export function isAdultResident(ctx: TurnContext, resident: Resident): boolean {
  return lifeStage(resident.bornDay, ctx.day, ctx.scenario.calendar) !== 'child';
}

/**
 * Consanguinity check.
 *
 * Depth 2 covers every relation that matters for consent in this simulation: parents and children,
 * siblings, grandparents and grandchildren, avuncular pairs (an aunt/uncle is a parent's sibling, so
 * they share a grandparent), and first cousins. Blood relations are blocked; in-law and step relations
 * are not.
 */
export function kinshipBlocked(ctx: TurnContext, a: Resident, b: Resident): boolean {
  if (a.id === b.id) return true;
  const aAncestors = ancestorIds(ctx, a.id, 2);
  const bAncestors = ancestorIds(ctx, b.id, 2);
  if (aAncestors.has(b.id) || bAncestors.has(a.id)) return true;
  for (const id of aAncestors) if (bAncestors.has(id)) return true;
  return false;
}

/** Parents, grandparents, ... up to `depth` generations (bounded, cycle-safe). */
/** True when this household has an undissolved building and room for one more resident. */
function hasSpareCapacity(ctx: TurnContext, householdId: number | null): boolean {
  if (householdId === null) return false;
  const household = ctx.state.households.get(householdId);
  if (!household || household.dissolvedDay !== null) return false;
  return householdMembers(ctx, household.id).length < household.capacity;
}

function ancestorIds(ctx: TurnContext, residentId: number, depth: number): Set<number> {
  const found = new Set<number>();
  let frontier = [residentId];
  for (let level = 0; level < depth; level += 1) {
    const next: number[] = [];
    for (const id of frontier) {
      const resident = ctx.state.residents.get(id);
      if (!resident) continue;
      for (const parentId of [resident.motherId, resident.fatherId]) {
        if (parentId === null || found.has(parentId)) continue;
        found.add(parentId);
        next.push(parentId);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return found;
}

/**
 * One eligibility validator shared by proposal and final resolution.
 *
 * Proposing and accepting are the same decision made twice, so they must apply the same prerequisites:
 * if acceptance re-derived a weaker or stronger rule, a stale or manipulated proposal could bypass
 * capacity, consent, or food checks. Returns the rejection reason, or null when eligible.
 */
export function pairEligibility(
  ctx: TurnContext,
  kind: 'courtship' | 'affair' | 'conception',
  a: Resident,
  b: Resident,
): string | null {
  if (a.status !== 'living' || b.status !== 'living') return 'participant_unavailable';
  if (!isAdultResident(ctx, a) || !isAdultResident(ctx, b)) return 'participants_must_be_adults';
  if (kinshipBlocked(ctx, a, b)) return 'kinship_blocked';

  if (kind === 'courtship') {
    if (a.partnerId !== null) return 'already_partnered';
    if (b.partnerId !== null) return 'target_already_partnered';
    // A partnership is a household change: the pair must end up housed *together*. Capacity is
    // reserved here (so acceptance cannot silently fail to move anyone), but either household may
    // host the couple.
    // Already sharing a home: no household change is needed, so capacity is irrelevant.
    if (a.householdId !== null && a.householdId === b.householdId) return null;
    if (
      !hasSpareCapacity(ctx, b.householdId) &&
      !hasSpareCapacity(ctx, a.householdId) &&
      findVacantHome(ctx) === null
    ) {
      return 'no_housing_capacity';
    }
    return null;
  }

  if (kind === 'affair') return null;

  // conception
  const mother = a.sex === 'female' ? a : b;
  const father = a.sex === 'female' ? b : a;
  if (mother.sex !== 'female') return 'no_mother';
  const age = ctx.day - mother.bornDay;
  if (age > 45 * ctx.scenario.calendar.daysPerYear) return 'mother_too_old';
  if (mother.householdId === null) return 'no_household';
  if (householdFoodDays(ctx, mother.householdId) < 3) return 'food_insecure';
  const existing = [...ctx.state.pregnancies.values()].find(
    (p) => p.status === 'active' && (p.motherId === mother.id || p.fatherId === father.id),
  );
  if (existing) return 'pregnancy_active';
  // Protected-birth capacity: the optional soft target and the hard host ceiling bind conception.
  if (ctx.state.populationPolicyEnabled && livingPlusExpected(ctx) >= ctx.state.populationTarget) {
    return 'population_target_reached';
  }
  if (livingPlusExpected(ctx) >= ctx.state.hostCeiling) return 'population_ceiling_reached';
  const key = relationshipKey(a.id, b.id, 'partner');
  const affairKey = relationshipKey(a.id, b.id, 'affair');
  if (!ctx.state.relationships.has(key) && !ctx.state.relationships.has(affairKey)) return 'not_partners';
  return null;
}

function propose(
  ctx: TurnContext,
  actor: Resident,
  target: Resident,
  kind: 'courtship' | 'affair' | 'conception',
  actorPlan: ActorPlan,
  detail: Record<string, number | string> = {},
): void {
  const rejection = pairEligibility(ctx, kind, actor, target);
  if (rejection !== null) return logRejected(ctx, actorPlan, rejection);

  const id = nextId(ctx.state, 'proposal');
  ctx.state.proposals.set(id, {
    id,
    day: ctx.day,
    fromId: actor.id,
    toId: target.id,
    kind,
    status: 'pending',
    expiresDay: ctx.day + 2,
    detail,
  });
  ctx.emit({
    kind: 'proposal_made',
    actorId: actor.id,
    targetId: target.id,
    visibility: 'private',
    importance: kind === 'conception' ? 40 : 25,
    title:
      kind === 'courtship'
        ? `${actor.name} proposed to ${target.name}`
        : kind === 'affair'
          ? `${actor.name} made an advance to ${target.name}`
          : `${actor.name} proposed starting a family with ${target.name}`,
    detail: { proposalId: id, kind },
  });
}

function acceptProposal(ctx: TurnContext, actor: Resident, proposer: Resident, actorPlan: ActorPlan): void {
  const proposal = [...ctx.state.proposals.values()]
    .filter((p) => p.status === 'pending' && p.fromId === proposer.id && p.toId === actor.id && p.expiresDay >= ctx.day)
    .sort((a, b) => b.day - a.day)[0];
  if (!proposal) return logRejected(ctx, actorPlan, 'no_pending_proposal');
  if (proposal.kind !== 'courtship' && proposal.kind !== 'affair' && proposal.kind !== 'conception') {
    proposal.status = 'expired';
    return logRejected(ctx, actorPlan, 'unsupported_proposal_kind');
  }

  // A proposal is not a promise: revalidate every prerequisite at resolution time. A stale proposal
  // (proposer died, left, or partnered since) must not be accepted.
  const rejection = pairEligibility(ctx, proposal.kind, proposer, actor);
  if (rejection !== null) {
    proposal.status = 'expired';
    return logRejected(ctx, actorPlan, rejection);
  }
  proposal.status = 'accepted';

  if (proposal.kind === 'courtship') {
    actor.partnerId = proposer.id;
    proposer.partnerId = actor.id;
    const key = relationshipKey(actor.id, proposer.id, 'partner');
    const relationship: Relationship = {
      key,
      aId: Math.min(actor.id, proposer.id),
      bId: Math.max(actor.id, proposer.id),
      kind: 'partner',
      trust: 65,
      intimacy: 45,
      publicBelief: 60,
      sinceDay: ctx.day,
      untilDay: null,
      cooldownUntil: null,
    };
    ctx.state.relationships.set(key, relationship);
    ctx.emit({
      kind: 'partnership_formed',
      actorId: actor.id,
      targetId: proposer.id,
      visibility: 'public',
      importance: 50,
      title: `${proposer.name} and ${actor.name} became partners`,
      detail: {},
    });
    // The couple must share a home: the proposer moves in with the accepter, or the accepter moves in
    // with the proposer, whichever household actually has the reserved capacity.
    if (actor.householdId !== proposer.householdId) {
      const moved = actor.householdId !== null && moveResident(ctx, proposer.id, actor.householdId);
      if (!moved && proposer.householdId !== null) moveResident(ctx, actor.id, proposer.householdId);
      if (!moved && proposer.householdId !== actor.householdId) {
        // Neither household had room: found a new one in a vacant home, as eligibility reserved.
        const buildingId = findVacantHome(ctx);
        if (buildingId !== null) {
          const building = ctx.state.buildings.get(buildingId);
          const household = createHousehold(
            ctx,
            `${actor.name} and ${proposer.name}'s house`,
            buildingId,
            building?.capacity ?? 4,
          );
          moveResident(ctx, actor.id, household.id);
          moveResident(ctx, proposer.id, household.id);
          ctx.emit({
            kind: 'household_formed',
            actorId: actor.id,
            targetId: household.id,
            visibility: 'public',
            importance: 30,
            title: `${actor.name} and ${proposer.name} set up home together`,
            detail: { buildingId },
          });
        }
      }
    }
    return;
  }

  if (proposal.kind === 'affair') {
    const key = relationshipKey(actor.id, proposer.id, 'affair');
    ctx.state.relationships.set(key, {
      key,
      aId: Math.min(actor.id, proposer.id),
      bId: Math.max(actor.id, proposer.id),
      kind: 'affair',
      trust: 40,
      intimacy: 30,
      publicBelief: 5,
      sinceDay: ctx.day,
      untilDay: null,
      cooldownUntil: null,
    });
    ctx.emit({
      kind: 'affair_started',
      actorId: actor.id,
      targetId: proposer.id,
      visibility: 'secret',
      importance: 45,
      title: `${proposer.name} and ${actor.name} began an affair`,
      detail: {},
    });
    return;
  }

  if (proposal.kind === 'conception') {
    attemptConception(ctx, proposer, actor);
  }
}

function attemptConception(ctx: TurnContext, a: Resident, b: Resident): void {
  const mother = a.sex === 'female' ? a : b;
  const father = a.sex === 'female' ? b : a;
  if (mother.sex !== 'female') return;
  if (ctx.state.populationPolicyEnabled && livingPlusExpected(ctx) >= ctx.state.populationTarget) {
    ctx.emit({
      kind: 'conception_declined',
      actorId: mother.id,
      targetId: father.id,
      visibility: 'private',
      importance: 20,
      title: 'The council has no room for a new child at present',
      detail: { target: ctx.state.populationTarget },
    });
    return;
  }
  const rng = ctx.rngFor(mother.id, `conception:${father.id}`);
  const age = ctx.day - mother.bornDay;
  const ageBonus = Math.max(0, Math.floor(((35 * ctx.scenario.calendar.daysPerYear - age) / 1_000) * 1_500));
  // Mood (growth towns only): unhappy couples are less likely to start a family.
  const chance = Math.floor((Math.min(6_000, 2_500 + ageBonus) * moodConceptionPercent(ctx, mother, father)) / 100);
  const healthPenalty = mother.hungerDays > 0 ? 50_000 : 0;
  if (!rng.chancePpm(Math.max(0, chance - healthPenalty))) {
    ctx.emit({
      kind: 'conception_unsuccessful',
      actorId: mother.id,
      targetId: father.id,
      visibility: 'private',
      importance: 15,
      title: 'No child was conceived this month',
      detail: {},
    });
    return;
  }
  const id = nextId(ctx.state, 'pregnancy');
  ctx.state.pregnancies.set(id, {
    id,
    motherId: mother.id,
    fatherId: father.id,
    conceivedDay: ctx.day,
    dueDay: ctx.day + ctx.scenario.calendar.pregnancyDays,
    status: 'active',
    childId: null,
    resolvedDay: null,
  });
  ctx.emit({
    kind: 'pregnancy',
    actorId: mother.id,
    targetId: father.id,
    visibility: 'private',
    importance: 55,
    title: `${mother.name} is expecting a child`,
    detail: { pregnancyId: id, dueDay: ctx.day + ctx.scenario.calendar.pregnancyDays },
  });
}

function refuseProposal(ctx: TurnContext, actor: Resident, proposer: Resident, actorPlan: ActorPlan): void {
  const proposal = [...ctx.state.proposals.values()]
    .filter((p) => p.status === 'pending' && p.fromId === proposer.id && p.toId === actor.id)
    .sort((a, b) => b.day - a.day)[0];
  if (!proposal) return logRejected(ctx, actorPlan, 'no_pending_proposal');
  proposal.status = 'refused';
  const key = relationshipKey(actor.id, proposer.id, 'partner');
  const existing = ctx.state.relationships.get(key);
  if (existing) existing.cooldownUntil = ctx.day + 10;
  else {
    ctx.state.relationships.set(key, {
      key,
      aId: Math.min(actor.id, proposer.id),
      bId: Math.max(actor.id, proposer.id),
      kind: 'partner',
      trust: 30,
      intimacy: 0,
      publicBelief: 0,
      sinceDay: ctx.day,
      untilDay: ctx.day,
      cooldownUntil: ctx.day + 10,
    });
  }
  ctx.emit({
    kind: 'proposal_refused',
    actorId: actor.id,
    targetId: proposer.id,
    visibility: 'private',
    importance: 20,
    title: `${actor.name} declined ${proposer.name}`,
    detail: { proposalId: proposal.id },
  });
}

function divorce(ctx: TurnContext, actor: Resident, targetId: number | null, actorPlan: ActorPlan): void {
  const partnerId = targetId ?? actor.partnerId;
  const partner = partnerId === null ? null : ctx.state.residents.get(partnerId);
  if (!partner || partner.status !== 'living') return logRejected(ctx, actorPlan, 'no_partner');
  if (actor.partnerId !== partner.id) return logRejected(ctx, actorPlan, 'not_partners');

  const key = relationshipKey(actor.id, partner.id, 'partner');
  const relationship = ctx.state.relationships.get(key);
  if (relationship) {
    relationship.untilDay = ctx.day;
  }
  actor.partnerId = null;
  partner.partnerId = null;

  // Asset split: cash divided so the two shares sum exactly to the total.
  const total = balanceOf(ctx.state, 'resident', actor.id) + balanceOf(ctx.state, 'resident', partner.id);
  const actorShare = Math.floor(total / 2);
  const partnerShare = total - actorShare;
  const actorCash = balanceOf(ctx.state, 'resident', actor.id);
  const partnerCash = balanceOf(ctx.state, 'resident', partner.id);
  if (actorCash > actorShare) {
    ctx.transfer({ from: { type: 'resident', id: actor.id }, to: { type: 'resident', id: partner.id }, cents: actorCash - actorShare, reason: 'divorce_settlement' });
  } else if (partnerCash > partnerShare) {
    ctx.transfer({ from: { type: 'resident', id: partner.id }, to: { type: 'resident', id: actor.id }, cents: partnerCash - partnerShare, reason: 'divorce_settlement' });
  }

  // Residence: the lower earner moves out; a new household is founded if there is a vacant home.
  const mover = (actor.skills.income ?? 0) >= (partner.skills.income ?? 0) ? partner : actor;
  const householdsWithRoom = [...ctx.state.households.values()]
    .filter((h) => h.dissolvedDay === null && h.id !== mover.householdId)
    .filter((h) => householdMembers(ctx, h.id).length < h.capacity)
    .sort((a, b) => a.id - b.id);
  const destination = householdsWithRoom[0];
  if (destination) {
    moveResident(ctx, mover.id, destination.id);
  } else {
    const vacantHome = [...ctx.state.buildings.values()].find(
      (b) =>
        b.kind === 'home' &&
        b.destroyedDay === null &&
        ![...ctx.state.households.values()].some((h) => h.buildingId === b.id && h.dissolvedDay === null),
    );
    if (vacantHome) {
      const household = createHousehold(ctx, `${mover.name}'s house`, vacantHome.id, vacantHome.capacity);
      moveResident(ctx, mover.id, household.id);
    }
  }

  // Dependants stay with the primary caregiver (most education days / lowest hunger).
  for (const child of ctx.state.residents.values()) {
    if (child.status !== 'living') continue;
    if (child.motherId !== actor.id && child.fatherId !== actor.id) continue;
    if (child.bornDay <= ctx.day - ctx.scenario.calendar.adultDays) continue;
    const caregiver = [actor, partner].sort((a, b) => (b.traits.diligence ?? 0) - (a.traits.diligence ?? 0))[0];
    if (caregiver) {
      child.guardianId = caregiver.id;
      if (caregiver.householdId !== null) moveResident(ctx, child.id, caregiver.householdId);
    }
  }

  ctx.emit({
    kind: 'divorce',
    actorId: actor.id,
    targetId: partner.id,
    visibility: 'public',
    importance: 60,
    title: `${actor.name} and ${partner.name} separated`,
    detail: { splitCents: { [actor.id]: actorShare, [partner.id]: partnerShare } },
  });
}

function adjustTrust(ctx: TurnContext, actor: Resident, target: Resident, delta: number, kind: string): void {
  const key = relationshipKey(actor.id, target.id, 'friend');
  const existing = ctx.state.relationships.get(key);
  if (existing) {
    existing.trust = Math.max(0, Math.min(100, existing.trust + delta));
    existing.untilDay = null;
  } else {
    ctx.state.relationships.set(key, {
      key,
      aId: Math.min(actor.id, target.id),
      bId: Math.max(actor.id, target.id),
      kind: 'friend',
      trust: Math.max(0, Math.min(100, 45 + delta)),
      intimacy: 10,
      publicBelief: 40,
      sinceDay: ctx.day,
      untilDay: null,
      cooldownUntil: null,
    });
  }
  if (kind === 'reconcile') {
    for (const feud of ctx.state.relationships.values()) {
      if (feud.kind !== 'feud') continue;
      if (![feud.aId, feud.bId].includes(actor.id) || ![feud.aId, feud.bId].includes(target.id)) continue;
      feud.untilDay = ctx.day;
      ctx.emit({
        kind: 'feud_ended',
        actorId: actor.id,
        targetId: target.id,
        visibility: 'public',
        importance: 30,
        title: `${actor.name} and ${target.name} made peace`,
        detail: {},
      });
    }
  }
}

function startFeud(ctx: TurnContext, actor: Resident, target: Resident, detail: string): void {
  if (actor.id === target.id) return;
  const key = relationshipKey(actor.id, target.id, 'feud');
  if (ctx.state.relationships.has(key)) return;
  ctx.state.relationships.set(key, {
    key,
    aId: Math.min(actor.id, target.id),
    bId: Math.max(actor.id, target.id),
    kind: 'feud',
    trust: 10,
    intimacy: 0,
    publicBelief: 30,
    sinceDay: ctx.day,
    untilDay: null,
    cooldownUntil: null,
  });
  const grievanceId = nextId(ctx.state, 'grievance');
  ctx.state.grievances.set(grievanceId, {
    id: grievanceId,
    residentId: actor.id,
    kind: 'feud',
    severity: 25,
    sinceDay: ctx.day,
    untilDay: null,
    reason: detail || `Feud with ${target.name}`,
  });
  ctx.emit({
    kind: 'feud_started',
    actorId: actor.id,
    targetId: target.id,
    visibility: 'public',
    importance: 35,
    title: `${actor.name} and ${target.name} fell out`,
    detail: { detail },
  });
}

function concealAffair(ctx: TurnContext, actor: Resident, targetId: number | null): void {
  const target = targetId === null ? null : ctx.state.residents.get(targetId);
  if (!target) return;
  const key = relationshipKey(actor.id, target.id, 'affair');
  const affair = ctx.state.relationships.get(key);
  if (!affair) return;
  affair.publicBelief = Math.max(0, affair.publicBelief - 5);
  ctx.emit({
    kind: 'affair_concealed',
    actorId: actor.id,
    targetId: target.id,
    visibility: 'secret',
    importance: 15,
    title: `${actor.name} covered their tracks`,
    detail: {},
  });
}

function spreadRumour(ctx: TurnContext, actor: Resident, targetId: number | null, detail: string): void {
  const target = targetId === null ? null : ctx.state.residents.get(targetId);
  if (!target) return;
  ctx.emit({
    kind: 'rumour',
    actorId: actor.id,
    targetId: target.id,
    visibility: 'rumor',
    importance: 20,
    title: `A rumour about ${target.name} is going around`,
    detail: { detail },
  });
}

/** Affairs are eventually discovered; a discovery is a scandal, not an instant fact for everyone. */
function discoveryPhase(ctx: TurnContext): void {
  for (const relationship of ctx.state.relationships.values()) {
    if (relationship.kind !== 'affair') continue;
    if (relationship.untilDay !== null) continue;
    const rng = ctx.rngFor(relationship.aId, `discovery:${relationship.bId}`);
    if (!rng.chancePpm(2_000)) continue;
    relationship.publicBelief = Math.min(100, relationship.publicBelief + 40);
    const a = ctx.state.residents.get(relationship.aId);
    const b = ctx.state.residents.get(relationship.bId);
    if (!a || !b) continue;
    ctx.emit({
      kind: 'affair_discovered',
      actorId: a.id,
      targetId: b.id,
      visibility: 'public',
      importance: 55,
      title: `${a.name} and ${b.name} were seen together`,
      detail: { affair: true },
    });
    for (const participant of [a, b]) {
      if (participant.partnerId === null) continue;
      const partner = ctx.state.residents.get(participant.partnerId);
      if (!partner) continue;
      const trustKey = relationshipKey(participant.id, partner.id, 'partner');
      const partnership = ctx.state.relationships.get(trustKey);
      if (partnership) partnership.trust = Math.max(0, partnership.trust - 25);
      const grievanceId = nextId(ctx.state, 'grievance');
      ctx.state.grievances.set(grievanceId, {
        id: grievanceId,
        residentId: partner.id,
        kind: 'infidelity',
        severity: 40,
        sinceDay: ctx.day,
        untilDay: null,
        reason: `${participant.name} was unfaithful`,
      });
      ctx.remember(partner.id, 'betrayal', `${participant.name} was unfaithful.`, 80, []);
    }
  }
}

export function livingPlusExpected(ctx: TurnContext): number {
  const living = [...ctx.state.residents.values()].filter((r) => r.status === 'living').length;
  const expected = [...ctx.state.pregnancies.values()].filter((p) => p.status === 'active').length;
  return living + expected;
}

export function logRejected(ctx: TurnContext, actorPlan: ActorPlan, reason: string): void {
  actorPlan.fallbackReason = actorPlan.fallbackReason ?? reason;
  ctx.state.counters.set(`rejected:${reason}`, (ctx.state.counters.get(`rejected:${reason}`) ?? 0) + 1);
}
