import type { TurnContext } from '../turn-context.js';
import { GOODS, quantityOf, relationshipKey, type Good, type Resident } from '../state.js';

/**
 * The departure lifecycle.
 *
 * Death and emigration are not just status changes: they end obligations, release offices, break
 * partnerships (so no widow stays "married" to a corpse), and settle assets that would otherwise stay
 * attached to someone who is no longer there. Death runs this *after* the estate has distributed cash
 * and businesses, so inheritance still sees the deceased's original holdings.
 *
 * Every step is idempotent: a restart between death and settlement must not apply it twice.
 */

const DEPARTED_PREFIX = 'departed:';

function alreadyApplied(ctx: TurnContext, residentId: number): boolean {
  return ctx.state.counters.has(`${DEPARTED_PREFIX}${residentId}`);
}

/**
 * End the obligations a departing resident holds.
 *
 * Employment contracts stop immediately, offices fall vacant, and a partnership is formally ended on
 * both sides with a widowhood record. Lineage (parents, children, history) is never touched.
 */
export function endObligations(ctx: TurnContext, resident: Resident, reason: string): void {
  for (const contract of ctx.state.contracts.values()) {
    if (contract.status !== 'active') continue;
    if (contract.aId !== resident.id) continue;
    contract.status = 'ended';
    contract.endDay = ctx.day;
  }

  for (const seat of ctx.state.offices.values()) {
    if (seat.holderId !== resident.id || seat.untilDay !== null) continue;
    seat.holderId = null;
    seat.untilDay = ctx.day;
    ctx.emit({
      kind: 'office_vacated',
      actorId: resident.id,
      targetId: null,
      visibility: 'public',
      importance: 35,
      title: `${resident.name} left the office of ${seat.office.replace(/_/g, ' ')}`,
      detail: { office: seat.office, seat: seat.seat, reason },
    });
  }

  clearPartnership(ctx, resident, reason);
}

/**
 * Break a partnership because one partner died or left.
 *
 * The surviving partner is explicitly widowed (not left pointing at a dead resident), and the
 * relationship row is closed rather than deleted so the history stays readable.
 */
export function clearPartnership(ctx: TurnContext, resident: Resident, reason: string): void {
  if (resident.partnerId === null) return;
  const partner = ctx.state.residents.get(resident.partnerId);
  const key = relationshipKey(resident.id, resident.partnerId, 'partner');
  const relationship = ctx.state.relationships.get(key);
  if (relationship && relationship.untilDay === null) relationship.untilDay = ctx.day;
  resident.partnerId = null;
  if (partner) {
    partner.partnerId = null;
    ctx.emit({
      kind: reason === 'death' ? 'widowed' : 'partnership_ended',
      actorId: partner.id,
      targetId: resident.id,
      visibility: 'public',
      importance: 60,
      title: `${partner.name} lost their partner ${resident.name}`,
      detail: { reason },
    });
    ctx.remember(partner.id, 'grief', `${resident.name} is gone.`, 90, []);
  }
}

/**
 * Settle the assets a departing resident still owns.
 *
 * Resident-owned businesses pass to the town when no successor exists (death inheritance already
 * re-homed them when a heir was found), and resident-level stock moves to the household — or the
 * public store when there is no household. Nothing is deleted; money never vanishes.
 */
export function settleDepartureAssets(ctx: TurnContext, resident: Resident, reason: string): void {
  for (const business of ctx.state.businesses.values()) {
    if (business.ownerType !== 'resident' || business.ownerId !== resident.id) continue;
    business.ownerType = 'town';
    business.ownerId = null;
    if (business.managerId === resident.id) business.managerId = null;
    ctx.emit({
      kind: 'business_escheated',
      actorId: null,
      targetId: business.id,
      visibility: 'public',
      importance: 40,
      title: `${business.name} passed to the town after ${resident.name} left`,
      detail: { reason },
    });
  }

  const destination: { type: 'household' | 'treasury'; id: number } =
    resident.householdId !== null && ctx.state.households.get(resident.householdId)?.dissolvedDay === null
      ? { type: 'household', id: resident.householdId }
      : { type: 'treasury', id: 0 };
  for (const good of GOODS as readonly Good[]) {
    const quantity = quantityOf(ctx.state, 'resident', resident.id, good);
    if (quantity <= 0) continue;
    ctx.shiftGoods({
      owner: { type: 'resident', id: resident.id },
      good,
      delta: -quantity,
      reason: 'departure_stock',
    });
    ctx.shiftGoods({ owner: destination, good, delta: quantity, reason: 'departure_stock' });
  }
}

/** Full death lifecycle; called by demography after the estate has settled. */
export function applyDeathLifecycle(ctx: TurnContext, resident: Resident): void {
  if (alreadyApplied(ctx, resident.id)) return;
  ctx.state.counters.set(`${DEPARTED_PREFIX}${resident.id}`, ctx.day);
  endObligations(ctx, resident, 'death');
  settleDepartureAssets(ctx, resident, 'death');
}

/** Full emigration lifecycle; called by the population resolver for every departing member. */
export function applyDepartureLifecycle(ctx: TurnContext, resident: Resident): void {
  if (alreadyApplied(ctx, resident.id)) return;
  ctx.state.counters.set(`${DEPARTED_PREFIX}${resident.id}`, ctx.day);
  endObligations(ctx, resident, 'departure');
  settleDepartureAssets(ctx, resident, 'departure');
}
