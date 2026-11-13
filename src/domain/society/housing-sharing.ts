import type { ActorPlan, SocialAction } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { isAdult } from '../clock.js';
import { isImprisoned } from '../economy/employment.js';
import {
  GOODS,
  balanceOf,
  nextId,
  quantityOf,
  reservedOf,
  type Household,
  type Proposal,
  type Resident,
} from '../state.js';
import { householdMembers } from './households.js';

/** Tunable switches for tests and for the parent turn-engine integration. */
export interface HousingSharingOptions {
  enabled?: boolean;
  maxPending?: number;
  requestDays?: number;
}

export type HousingReply = 'accept' | 'refuse';

export interface HousingResult {
  ok: boolean;
  proposalId?: number;
  moved?: boolean;
  reused?: boolean;
  reason?: string;
}

export interface HousingPhaseReport {
  requests: number;
  replies: number;
  moved: number;
  rejected: number;
}

interface HousingDetail {
  type: 'housing';
  requesterId: number;
  hostHouseholdId: number;
  hostBuildingId: number;
  hostRoster: string;
  approvals: string;
  assetConsent: 'sole_camp_assets';
}

interface HostSnapshot {
  household: Household;
  buildingId: number;
  members: Resident[];
  adultIds: number[];
  availableBeds: number;
}

const DEFAULT_MAX_PENDING = 32;
const DEFAULT_REQUEST_DAYS = 3;

/**
 * Resolve a request from a single adult in an independent camp to one current host resident.
 * The returned proposal is the sole durable record for the request; host approvals are encoded in
 * its detail so no per-host proposal can accidentally diverge from the captured roster.
 */
export function requestHousing(
  ctx: TurnContext,
  requester: Resident | number,
  host: Resident | number,
  options: HousingSharingOptions = {},
): HousingResult {
  const rules = resolveOptions(ctx, options);
  if (!rules.enabled) return reject(ctx, 'housing_sharing_disabled');

  const requesterResident = resolveResident(ctx, requester);
  const hostResident = resolveResident(ctx, host);
  if (!requesterResident || requesterResident.status !== 'living') return reject(ctx, 'requester_unavailable');
  if (!isAdultResident(ctx, requesterResident)) return reject(ctx, 'requester_must_be_adult');
  if (isImprisoned(ctx, requesterResident.id)) return reject(ctx, 'requester_imprisoned');
  const requesterCheck = independentCampReason(ctx, requesterResident);
  if (requesterCheck !== null) return reject(ctx, requesterCheck);
  if (!hostResident || hostResident.status !== 'living') return reject(ctx, 'host_unavailable');
  if (hostResident.id === requesterResident.id) return reject(ctx, 'same_resident');
  if (!isAdultResident(ctx, hostResident)) return reject(ctx, 'host_must_be_adult');
  if (isImprisoned(ctx, hostResident.id)) return reject(ctx, 'host_imprisoned');

  const hostSnapshot = currentHost(ctx, hostResident.householdId);
  if (!hostSnapshot) return reject(ctx, 'host_home_unavailable');
  if (!hostSnapshot.adultIds.includes(hostResident.id)) return reject(ctx, 'host_not_current_member');
  if (hostSnapshot.household.id === requesterResident.householdId) return reject(ctx, 'already_same_household');
  if (hostSnapshot.availableBeds <= 0) return reject(ctx, 'housing_full');

  const duplicate = [...ctx.state.proposals.values()]
    .filter(
      (proposal) =>
        proposal.kind === 'settle' &&
        proposal.status === 'pending' &&
        proposal.fromId === requesterResident.id &&
        numberDetail(proposal.detail.hostHouseholdId) === hostSnapshot.household.id,
    )
    .sort((a, b) => a.id - b.id)[0];
  if (duplicate) return { ok: true, proposalId: duplicate.id, reused: true, moved: false };

  const pending = pendingHousing(ctx);
  if (pending >= rules.maxPending) return reject(ctx, 'housing_requests_full');
  const createdToday = [...ctx.state.proposals.values()].filter(
    (proposal) =>
      proposal.kind === 'settle' &&
      proposal.day === ctx.day &&
      (proposal.fromId === requesterResident.id || proposal.toId === hostResident.id),
  ).length;
  if (createdToday >= rules.maxPending) return reject(ctx, 'housing_actor_day_limit');

  const proposalId = nextId(ctx.state, 'proposal');
  const detail: HousingDetail = {
    type: 'housing',
    requesterId: requesterResident.id,
    hostHouseholdId: hostSnapshot.household.id,
    hostBuildingId: hostSnapshot.buildingId,
    hostRoster: JSON.stringify(hostSnapshot.adultIds),
    approvals: JSON.stringify([]),
    assetConsent: 'sole_camp_assets',
  };
  const proposal: Proposal = {
    id: proposalId,
    day: ctx.day,
    fromId: requesterResident.id,
    toId: hostResident.id,
    kind: 'settle',
    status: 'pending',
    expiresDay: ctx.day + rules.requestDays,
    detail: detailRecord(detail),
  };
  ctx.state.proposals.set(proposalId, proposal);
  ctx.emit({
    kind: 'housing_request_made',
    actorId: requesterResident.id,
    targetId: hostResident.id,
    visibility: 'private',
    importance: 25,
    title: `${requesterResident.name} asked to join a household`,
    detail: { proposalId, hostHouseholdId: hostSnapshot.household.id, hostRoster: hostSnapshot.adultIds },
  });
  return { ok: true, proposalId, moved: false };
}

/** Record one host's explicit reply, and move the requester only after unanimous current consent. */
export function replyHousing(
  ctx: TurnContext,
  responder: Resident | number,
  proposalId: number,
  reply: HousingReply,
  options: HousingSharingOptions = {},
): HousingResult {
  const rules = resolveOptions(ctx, options);
  if (!rules.enabled) return reject(ctx, 'housing_sharing_disabled', proposalId);
  const actor = resolveResident(ctx, responder);
  if (!actor || actor.status !== 'living') return reject(ctx, 'responder_unavailable', proposalId);
  if (!isAdultResident(ctx, actor)) return reject(ctx, 'responder_must_be_adult', proposalId);
  if (isImprisoned(ctx, actor.id)) return reject(ctx, 'responder_imprisoned', proposalId);
  if (!Number.isSafeInteger(proposalId) || proposalId <= 0) return reject(ctx, 'invalid_proposal_id');

  const proposal = ctx.state.proposals.get(proposalId);
  if (!proposal || proposal.kind !== 'settle') return reject(ctx, 'not_housing_request', proposalId);
  if (proposal.status !== 'pending') return reject(ctx, 'housing_request_not_pending', proposalId);
  if (proposal.expiresDay < ctx.day || ctx.day > proposal.day + rules.requestDays) {
    proposal.status = 'expired';
    return reject(ctx, 'housing_request_expired', proposalId);
  }

  const detail = parseHousingDetail(proposal);
  if (!detail) {
    proposal.status = 'expired';
    return reject(ctx, 'housing_request_malformed', proposalId);
  }
  const roster = parseIds(detail.hostRoster);
  if (!roster.includes(actor.id)) return reject(ctx, 'responder_not_required_host', proposalId);

  if (reply === 'refuse') {
    proposal.status = 'refused';
    ctx.emit({
      kind: 'housing_request_refused',
      actorId: actor.id,
      targetId: proposal.fromId,
      visibility: 'private',
      importance: 20,
      title: `${actor.name} declined a housing request`,
      detail: { proposalId },
    });
    return { ok: true, proposalId, moved: false };
  }

  const requester = ctx.state.residents.get(detail.requesterId);
  const requesterReason = requester ? independentCampReason(ctx, requester) : 'requester_unavailable';
  const host = currentHost(ctx, detail.hostHouseholdId);
  if (requesterReason !== null) {
    proposal.status = 'expired';
    return reject(ctx, requesterReason, proposalId);
  }
  if (!host) {
    proposal.status = 'expired';
    return reject(ctx, 'host_home_unavailable', proposalId);
  }
  if (!sameIds(host.adultIds, roster)) {
    proposal.status = 'expired';
    return reject(ctx, 'host_roster_changed', proposalId);
  }
  if (host.buildingId !== detail.hostBuildingId) {
    proposal.status = 'expired';
    return reject(ctx, 'host_building_changed', proposalId);
  }
  if (host.availableBeds <= 0) {
    proposal.status = 'expired';
    return reject(ctx, 'housing_full', proposalId);
  }
  if (!allHostsAvailable(ctx, roster)) {
    proposal.status = 'expired';
    return reject(ctx, 'host_unavailable', proposalId);
  }

  const approvals = parseIds(detail.approvals).filter((id) => roster.includes(id));
  if (!approvals.includes(actor.id)) approvals.push(actor.id);
  approvals.sort((a, b) => a - b);
  proposal.detail.approvals = JSON.stringify(approvals);
  if (roster.some((id) => !approvals.includes(id))) return { ok: true, proposalId, moved: false };

  const moved = finalizeHousing(ctx, proposal, detail, requester!, host, roster);
  if (!moved) return reject(ctx, 'housing_final_revalidation_failed', proposalId);
  return { ok: true, proposalId, moved: true };
}

/**
 * Dedicated phase dispatcher. It intentionally does not handle romantic `accept`/`refuse`; those
 * remain in relationships.ts and cannot consume a `settle` proposal.
 */
export function housingSharingPhase(
  ctx: TurnContext,
  plans: Map<number, ActorPlan>,
  options: HousingSharingOptions = {},
): HousingPhaseReport {
  const report: HousingPhaseReport = { requests: 0, replies: 0, moved: 0, rejected: 0 };
  for (const actorPlan of [...plans.values()].sort((a, b) => a.actorId - b.actorId)) {
    const social: SocialAction | null = actorPlan.plan.social;
    if (!social) continue;
    const actor = ctx.state.residents.get(actorPlan.actorId);
    if (!actor || actor.status !== 'living') {
      rejectPlan(ctx, actorPlan, 'actor_unavailable');
      report.rejected += 1;
      continue;
    }
    let result: HousingResult | null = null;
    if (social.kind === 'request_housing') {
      if (social.targetId === null || social.targetId === undefined) result = reject(ctx, 'request_needs_host');
      else result = requestHousing(ctx, actor, social.targetId, options);
      report.requests += 1;
    } else if (social.kind === 'accept_housing' || social.kind === 'refuse_housing') {
      if (social.targetId === null || social.targetId === undefined) result = reject(ctx, 'reply_needs_proposal');
      else {
        result = replyHousing(ctx, actor, social.targetId, social.kind === 'accept_housing' ? 'accept' : 'refuse', options);
        report.replies += 1;
      }
    }
    if (result === null) continue;
    if (!result.ok) {
      rejectPlan(ctx, actorPlan, result.reason ?? 'housing_rejected');
      report.rejected += 1;
    } else if (result.moved) {
      report.moved += 1;
    }
  }
  return report;
}

function resolveOptions(ctx: TurnContext, options: HousingSharingOptions): Required<HousingSharingOptions> {
  const growth = ctx.scenario.growth;
  const enabled = options.enabled ?? (growth?.housingSharing === 'consent');
  const configuredMax = options.maxPending ?? growth?.maxPendingHousingRequests ?? DEFAULT_MAX_PENDING;
  const configuredDays = options.requestDays ?? growth?.housingRequestDays ?? DEFAULT_REQUEST_DAYS;
  return {
    enabled,
    maxPending: Math.max(1, Math.min(1_000, Math.trunc(configuredMax))),
    requestDays: Math.max(1, Math.min(365, Math.trunc(configuredDays))),
  };
}

function isAdultResident(ctx: TurnContext, resident: Resident): boolean {
  return isAdult(resident.bornDay, ctx.day, ctx.scenario.calendar);
}

function resolveResident(ctx: TurnContext, value: Resident | number): Resident | null {
  return typeof value === 'number' ? ctx.state.residents.get(value) ?? null : ctx.state.residents.get(value.id) ?? null;
}

function currentHost(ctx: TurnContext, householdId: number | null): HostSnapshot | null {
  if (householdId === null) return null;
  const household = ctx.state.households.get(householdId);
  if (!household || household.dissolvedDay !== null || household.buildingId === null) return null;
  const building = ctx.state.buildings.get(household.buildingId);
  if (!building || building.kind !== 'home' || building.destroyedDay !== null || building.conditionBps < 3_000) return null;
  const members = householdMembers(ctx, household.id).sort((a, b) => a.id - b.id);
  if (household.capacity > building.capacity) return null;
  const adultIds = members.filter((member) => isAdultResident(ctx, member)).map((member) => member.id);
  if (adultIds.length === 0) return null;
  return {
    household,
    buildingId: building.id,
    members,
    adultIds,
    availableBeds: Math.max(0, household.capacity - members.length),
  };
}

function independentCampReason(ctx: TurnContext, resident: Resident): string | null {
  if (resident.status !== 'living') return 'requester_unavailable';
  if (!isAdultResident(ctx, resident)) return 'requester_must_be_adult';
  if (resident.partnerId !== null) return 'requester_has_partner';
  if (resident.householdId === null) return 'requester_not_in_camp';
  const household = ctx.state.households.get(resident.householdId);
  if (!household || household.dissolvedDay !== null || household.buildingId !== null) return 'requester_not_in_camp';
  const members = householdMembers(ctx, household.id);
  if (members.length !== 1 || members[0]?.id !== resident.id) return 'requester_camp_not_independent';
  const dependent = [...ctx.state.residents.values()].some(
    (candidate) =>
      candidate.status === 'living' &&
      candidate.bornDay > ctx.day - ctx.scenario.calendar.adultDays &&
      (candidate.motherId === resident.id || candidate.fatherId === resident.id || candidate.guardianId === resident.id),
  );
  if (dependent) return 'requester_has_dependents';
  if (GOODS.some((good) => reservedOf(ctx.state, 'household', household.id, good) > 0)) {
    return 'requester_has_reserved_goods';
  }
  return null;
}

function finalizeHousing(
  ctx: TurnContext,
  proposal: Proposal,
  detail: HousingDetail,
  requester: Resident,
  host: HostSnapshot,
  roster: number[],
): boolean {
  if (requester.status !== 'living' || independentCampReason(ctx, requester) !== null) return false;
  const current = currentHost(ctx, detail.hostHouseholdId);
  if (!current || !sameIds(current.adultIds, roster) || current.buildingId !== detail.hostBuildingId || current.availableBeds <= 0) return false;
  if (!allHostsAvailable(ctx, roster)) return false;
  const oldHouseholdId = requester.householdId;
  if (oldHouseholdId === null || oldHouseholdId === current.household.id) return false;
  const oldHousehold = ctx.state.households.get(oldHouseholdId);
  if (!oldHousehold || oldHousehold.dissolvedDay !== null || householdMembers(ctx, oldHousehold.id).length !== 1) return false;

  transferCampAssets(ctx, oldHousehold.id, current.household.id);
  clearCampSiteOwners(ctx, oldHousehold.id);
  requester.householdId = current.household.id;
  oldHousehold.dissolvedDay = ctx.day;
  proposal.status = 'accepted';
  ctx.emit({
    kind: 'housing_shared',
    actorId: requester.id,
    targetId: current.household.id,
    locationId: current.buildingId,
    visibility: 'public',
    importance: 45,
    title: `${requester.name} joined a consenting household`,
    detail: { proposalId: proposal.id, householdId: current.household.id, buildingId: current.buildingId },
  });
  void host;
  return true;
}

function transferCampAssets(ctx: TurnContext, sourceHouseholdId: number, targetHouseholdId: number): void {
  const cash = balanceOf(ctx.state, 'household', sourceHouseholdId);
  if (cash > 0) {
    ctx.transfer({
      from: { type: 'household', id: sourceHouseholdId },
      to: { type: 'household', id: targetHouseholdId },
      cents: cash,
      reason: 'housing_share_household_cash',
    });
  }
  for (const good of GOODS) {
    const quantity = quantityOf(ctx.state, 'household', sourceHouseholdId, good);
    if (quantity > 0) {
      ctx.shiftGoods({
        owner: { type: 'household', id: sourceHouseholdId },
        good,
        delta: -quantity,
        reason: 'housing_share_household_goods',
      });
      ctx.shiftGoods({
        owner: { type: 'household', id: targetHouseholdId },
        good,
        delta: quantity,
        reason: 'housing_share_household_goods',
      });
    }
  }
}

function clearCampSiteOwners(ctx: TurnContext, householdId: number): void {
  for (const [key, value] of ctx.state.counters.entries()) {
    if (key.endsWith(':household') && value === householdId) ctx.state.counters.delete(key);
  }
}

function allHostsAvailable(ctx: TurnContext, roster: number[]): boolean {
  return roster.every((id) => {
    const resident = ctx.state.residents.get(id);
    return resident !== undefined && resident.status === 'living' && !isImprisoned(ctx, id);
  });
}

function pendingHousing(ctx: TurnContext): number {
  return [...ctx.state.proposals.values()].filter((proposal) => proposal.kind === 'settle' && proposal.status === 'pending').length;
}

function parseHousingDetail(proposal: Proposal): HousingDetail | null {
  if (proposal.detail.type !== 'housing') return null;
  const requesterId = numberDetail(proposal.detail.requesterId);
  const hostHouseholdId = numberDetail(proposal.detail.hostHouseholdId);
  const hostBuildingId = numberDetail(proposal.detail.hostBuildingId);
  const hostRoster = stringDetail(proposal.detail.hostRoster);
  const approvals = stringDetail(proposal.detail.approvals);
  const assetConsent = stringDetail(proposal.detail.assetConsent);
  if (
    requesterId === null ||
    hostHouseholdId === null ||
    hostBuildingId === null ||
    !hostRoster ||
    !approvals ||
    assetConsent !== 'sole_camp_assets'
  ) return null;
  return { type: 'housing', requesterId, hostHouseholdId, hostBuildingId, hostRoster, approvals, assetConsent };
}

function numberDetail(value: number | string | undefined): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringDetail(value: number | string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseIds(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item > 0);
    return [...new Set(ids)].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function sameIds(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function detailRecord(detail: HousingDetail): Record<string, number | string> {
  return {
    type: detail.type,
    requesterId: detail.requesterId,
    hostHouseholdId: detail.hostHouseholdId,
    hostBuildingId: detail.hostBuildingId,
    hostRoster: detail.hostRoster,
    approvals: detail.approvals,
    assetConsent: detail.assetConsent,
  };
}

function reject(ctx: TurnContext, reason: string, proposalId?: number): HousingResult {
  ctx.state.counters.set(`rejected:housing_${reason}`, (ctx.state.counters.get(`rejected:housing_${reason}`) ?? 0) + 1);
  return { ok: false, proposalId, reason };
}

function rejectPlan(ctx: TurnContext, plan: ActorPlan, reason: string): void {
  plan.fallbackReason = plan.fallbackReason ?? reason;
  ctx.state.counters.set(`rejected:housing_${reason}`, (ctx.state.counters.get(`rejected:housing_${reason}`) ?? 0) + 1);
}
