import type { TurnContext } from '../turn-context.js';
import { balanceOf, nextId, quantityOf, type Business, type Good } from '../state.js';
import { openBusinessCount } from '../growth-limits.js';

/**
 * Business founding and closure. Templates, capital, and location capacity are fixed by rules; a
 * model can ask to found or close a business, but cannot create money, buildings, or recipes.
 */

export const FOUNDING_CAPITAL_CENTS = 3_000;

export interface FoundResult {
  ok: boolean;
  businessId?: number;
  reason?: string;
}

export function foundBusiness(params: {
  ctx: TurnContext;
  founderId: number;
  kind: string;
  buildingId: number;
  name?: string;
}): FoundResult {
  const { ctx, founderId, kind, buildingId } = params;
  const founder = ctx.state.residents.get(founderId);
  if (!founder || founder.status !== 'living') return { ok: false, reason: 'founder_unavailable' };
  const recipe = ctx.scenario.economy.recipes[kind];
  if (!recipe) return { ok: false, reason: 'unknown_business_kind' };
  const building = ctx.state.buildings.get(buildingId);
  if (!building || building.destroyedDay !== null) return { ok: false, reason: 'building_unavailable' };
  if (building.privateFlag) return { ok: false, reason: 'not_a_premises' };
  if (ctx.scenario.growth) {
    if (openBusinessCount(ctx.state) >= ctx.scenario.growth.maxBusinesses) return { ok: false, reason: 'business_safety_limit' };
    if (building.capacity <= 0 || building.kind !== kind || building.conditionBps < 3_000) {
      return { ok: false, reason: 'premises_unavailable' };
    }
  }
  const occupied = [...ctx.state.businesses.values()].some(
    (b) => b.buildingId === buildingId && b.status === 'open',
  );
  if (occupied) return { ok: false, reason: 'premises_occupied' };
  if (balanceOf(ctx.state, 'resident', founderId) < FOUNDING_CAPITAL_CENTS) {
    return { ok: false, reason: 'insufficient_capital' };
  }

  const id = nextId(ctx.state, 'business');
  const business: Business = {
    id,
    name: params.name ?? `${founder.name}'s ${kind.replace(/_/g, ' ')}`,
    kind,
    ownerType: 'resident',
    ownerId: founderId,
    managerId: founderId,
    buildingId,
    cashCents: 0,
    openedDay: ctx.day,
    closedDay: null,
    status: 'open',
    settings: {},
  };
  ctx.state.businesses.set(id, business);
  ctx.transfer({
    from: { type: 'resident', id: founderId },
    to: { type: 'business', id },
    cents: FOUNDING_CAPITAL_CENTS,
    reason: 'business_capital',
  });
  ctx.emit({
    kind: 'business_founded',
    actorId: founderId,
    targetId: id,
    locationId: buildingId,
    visibility: 'public',
    importance: 35,
    title: `${business.name} opened`,
    detail: { kind, capitalCents: FOUNDING_CAPITAL_CENTS },
  });
  return { ok: true, businessId: id };
}

export interface ClosedResult {
  ok: boolean;
  reason?: string;
}

export function closeBusiness(params: {
  ctx: TurnContext;
  businessId: number;
  reason: string;
  eventKind?: string;
}): ClosedResult {
  const { ctx, businessId, reason } = params;
  const business = ctx.state.businesses.get(businessId);
  if (!business) return { ok: false, reason: 'unknown_business' };
  if (business.status !== 'open') return { ok: false, reason: 'already_closed' };

  business.status = 'closed';
  business.closedDay = ctx.day;

  // End employment contracts.
  for (const contract of ctx.state.contracts.values()) {
    if (contract.businessId === businessId && contract.status === 'active') {
      contract.status = 'ended';
      contract.endDay = ctx.day;
    }
  }

  // Return remaining cash to the owner (or the treasury for town businesses).
  const cash = balanceOf(ctx.state, 'business', businessId);
  if (cash > 0) {
    const target = business.ownerType === 'resident' && business.ownerId !== null
      ? { type: 'resident' as const, id: business.ownerId }
      : { type: 'treasury' as const, id: 0 };
    ctx.transfer({ from: { type: 'business', id: businessId }, to: target, cents: cash, reason: 'business_closure' });
  }

  // Liquidate remaining goods to the treasury (public store) so stock does not vanish.
  for (const good of ['grain', 'fish', 'bread', 'timber', 'tools', 'medicine', 'cloth'] as Good[]) {
    const quantity = quantityOf(ctx.state, 'business', businessId, good);
    if (quantity <= 0) continue;
    ctx.shiftGoods({ owner: { type: 'business', id: businessId }, good, delta: -quantity, reason: 'closure_liquidation' });
    ctx.shiftGoods({ owner: { type: 'treasury', id: 0 }, good, delta: quantity, reason: 'closure_liquidation' });
  }

  ctx.emit({
    kind: params.eventKind ?? 'business_closed',
    actorId: business.ownerId,
    targetId: businessId,
    visibility: 'public',
    importance: 40,
    title: `${business.name} closed`,
    detail: { reason },
  });
  return { ok: true };
}

/** Businesses that cannot pay wages two days running are put into closure by the labour phase. */
export function markBusinessInsolvent(ctx: TurnContext, businessId: number, arrearsCents: number): void {
  const business = ctx.state.businesses.get(businessId);
  if (business?.ownerType === 'town') {
    // Public services are backed by the treasury; they cannot be liquidated for arrears.
    return;
  }
  const key = `insolvent:${businessId}`;
  const days = (ctx.state.counters.get(key) ?? 0) + 1;
  ctx.state.counters.set(key, days);
  if (days >= 2) {
    closeBusiness({ ctx, businessId, reason: 'insolvent', eventKind: 'business_bankrupt' });
    ctx.state.counters.delete(key);
  } else if (arrearsCents > 0) {
    ctx.emit({
      kind: 'business_insolvent',
      actorId: null,
      targetId: businessId,
      visibility: 'public',
      importance: 25,
      title: `Wages went unpaid at ${ctx.state.businesses.get(businessId)?.name ?? businessId}`,
      detail: { arrearsCents },
    });
  }
}
