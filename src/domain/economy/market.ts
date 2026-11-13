import type { ActorPlan, MarketOrder } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { GOODS, type Good, type OwnerType, type Resident } from '../state.js';
import { availableOf, quantityOf } from '../state.js';
import { chargeBusinessLevy, chargeRetailFee } from './ledger.js';
import { activeEmploymentByBusiness, livingMembersByHousehold } from '../lookups.js';

/**
 * Market: households provision, businesses buy inputs and offer output, residents may place personal
 * orders, and the town trades surplus/shortfall externally. Orders are matched by price priority with
 * seeded tie-breaks; every fill re-checks stock and cash. Money moves only between counterparties.
 */

export interface MarketOrderRecord {
  id: string;
  side: 'buy' | 'sell';
  good: Good;
  quantity: number;
  remaining: number;
  limitPriceCents: number;
  ownerType: OwnerType;
  ownerId: number;
  actorId: number | null;
  reason: string;
  tieBreak: number;
  filledCents: number;
}

export interface TradeFill {
  good: Good;
  quantity: number;
  priceCents: number;
  buyerType: OwnerType;
  buyerId: number;
  sellerType: OwnerType;
  sellerId: number;
}

export interface MarketReport {
  buys: number;
  sells: number;
  fills: TradeFill[];
  volumeByGood: Partial<Record<Good, number>>;
  valueByGood: Partial<Record<Good, number>>;
  unmetDemandByGood: Partial<Record<Good, number>>;
  unsoldSupplyByGood: Partial<Record<Good, number>>;
  prices: Partial<Record<Good, number>>;
  shortage: boolean;
}

interface PendingCommitment {
  sold: Map<string, number>;
  spent: Map<string, number>;
}

export function runMarket(ctx: TurnContext, plans: Map<number, ActorPlan>): MarketReport {
  ctx.setPhase('market');
  const orders: MarketOrderRecord[] = [];
  const commitment: PendingCommitment = { sold: new Map(), spent: new Map() };
  let tieCounter = 0;

  const nextTie = (): number => {
    tieCounter += 1;
    return tieCounter;
  };

  // ---------------------------------------------------------- households provision
  const householdNeed = new Map<number, number>();
  // Provisioning moves money, never people, so one membership snapshot serves every household.
  const membersByHousehold = livingMembersByHousehold(ctx.state);
  for (const household of ctx.state.households.values()) {
    if (household.dissolvedDay !== null) continue;
    const members = membersByHousehold.get(household.id) ?? [];
    if (members.length === 0) continue;
    const need = members.length * ctx.scenario.economy.foodNeedPerDay;
    householdNeed.set(household.id, need);
    if (need <= 0) continue;

    // Household support: personal balances are part of the household's money in practice. Members with
    // spare cash move what the household needs, and any personal surplus above a small float goes home.
    const personalFloat = ctx.scenario.economy.personalFloatCents;
    let householdCash = ctx.state.accounts.get(`household:${household.id}`)?.balanceCents ?? 0;
    const averagePrice =
      ctx.scenario.economy.mealGoods.reduce(
        (sum, good) => sum + (ctx.state.prices.get(good) ?? ctx.scenario.economy.referencePrices[good].price),
        0,
      ) / Math.max(1, ctx.scenario.economy.mealGoods.length);
    const targetCash = Math.ceil(need * averagePrice * 3);
    const earners = members
      .map((member) => ({ member, cash: ctx.state.accounts.get(`resident:${member.id}`)?.balanceCents ?? 0 }))
      .sort((a, b) => b.cash - a.cash);
    for (const { member, cash } of earners) {
      const spare = Math.max(0, cash - personalFloat);
      if (spare <= 0) continue;
      const needed = Math.max(0, targetCash - householdCash);
      const move = needed > 0 ? Math.min(spare, needed) : spare;
      if (move <= 0) continue;
      ctx.transfer({
        from: { type: 'resident', id: member.id },
        to: { type: 'household', id: household.id },
        cents: move,
        reason: 'household_support',
      });
      householdCash += move;
    }

    const weights = ctx.scenario.economy.householdBasketWeights;
    for (const good of ctx.scenario.economy.mealGoods) {
      const weight = weights[good] ?? 0;
      if (weight <= 0) continue;
      const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
      const want = Math.max(1, Math.ceil((need * weight) / totalWeight));
      const reference = ctx.scenario.economy.referencePrices[good].price;
      const market = ctx.state.prices.get(good) ?? reference;
      // Bid above the reference AND above the current market price: otherwise a ratcheted price can
      // outrun every buy limit and freeze the market while people starve next to full warehouses.
      const limit = Math.max(Math.floor((reference * 135) / 100), Math.floor((market * 115) / 100));
      orders.push({
        id: `hb:${household.id}:${good}`,
        side: 'buy',
        good,
        quantity: want,
        remaining: want,
        limitPriceCents: limit,
        ownerType: 'household',
        ownerId: household.id,
        actorId: null,
        reason: 'household_provision',
        tieBreak: nextTie(),
        filledCents: 0,
      });
    }
  }

  // Residents with no valid household buy their own food from their own purse.
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    const household = resident.householdId === null ? null : ctx.state.households.get(resident.householdId);
    if (household && household.dissolvedDay === null) continue;
    const reference = ctx.scenario.economy.referencePrices[ctx.scenario.economy.mealGoods[0]!].price;
    for (const good of ctx.scenario.economy.mealGoods) {
      const price = ctx.state.prices.get(good) ?? ctx.scenario.economy.referencePrices[good].price;
      const limit = Math.max(Math.floor((price * 115) / 100), reference);
      orders.push({
        id: `pb:${resident.id}:${good}`,
        side: 'buy',
        good,
        quantity: ctx.scenario.economy.foodNeedPerDay,
        remaining: ctx.scenario.economy.foodNeedPerDay,
        limitPriceCents: limit,
        ownerType: 'resident',
        ownerId: resident.id,
        actorId: resident.id,
        reason: 'personal_provision',
        tieBreak: nextTie(),
        filledCents: 0,
      });
    }
  }

  // ---------------------------------------------------------- business input demand
  // Placing orders changes no contracts.
  const staffByBusiness = activeEmploymentByBusiness(ctx.state);
  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    const recipe = ctx.scenario.economy.recipes[business.kind];
    if (!recipe) continue;
    for (const [good, perBatch] of Object.entries(recipe.inputs ?? {})) {
      if (perBatch <= 0) continue;
      const staff = staffByBusiness.get(business.id)?.length ?? 0;
      const target = perBatch * Math.max(3, staff + 1);
      const have = availableOf(ctx.state, 'business', business.id, good as Good);
      if (have >= target) continue;
      const want = target - have;
      const reference = ctx.scenario.economy.referencePrices[good as Good].price;
      const market = ctx.state.prices.get(good as Good) ?? reference;
      const limit = Math.max(Math.floor((reference * 150) / 100), Math.floor((market * 125) / 100));
      orders.push({
        id: `bb:${business.id}:${good}`,
        side: 'buy',
        good: good as Good,
        quantity: want,
        remaining: want,
        limitPriceCents: limit,
        ownerType: 'business',
        ownerId: business.id,
        actorId: business.managerId,
        reason: 'production_input',
        tieBreak: nextTie(),
        filledCents: 0,
      });
    }
  }

  // ---------------------------------------------------------- business supply offers
  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    const recipe = ctx.scenario.economy.recipes[business.kind];
    if (!recipe) continue;
    const neededBySelf = new Set(Object.keys(recipe.inputs ?? {}));
    for (const good of Object.keys(recipe.outputs ?? {}) as Good[]) {
      const have = availableOf(ctx.state, 'business', business.id, good);
      if (have <= 0) continue;
      // Keep a small buffer of goods the business itself consumes.
      const buffer = neededBySelf.has(good) ? Math.max(1, recipe.inputs[good] ?? 0) : 0;
      const offer = Math.max(0, have - buffer);
      if (offer <= 0) continue;
      orders.push({
        id: `bs:${business.id}:${good}`,
        side: 'sell',
        good,
        quantity: offer,
        remaining: offer,
        limitPriceCents: ctx.state.prices.get(good) ?? ctx.scenario.economy.referencePrices[good].price,
        ownerType: 'business',
        ownerId: business.id,
        actorId: business.managerId,
        reason: `supply:${business.kind}`,
        tieBreak: nextTie(),
        filledCents: 0,
      });
    }
    // Export surplus medicine/tools held by the treasury is handled by the trade phase.
  }

  // ---------------------------------------------------------- model/market orders from plans
  for (const [actorId, actorPlan] of plans) {
    if (actorPlan.plan.orders.length === 0) continue;
    const resident = ctx.state.residents.get(actorId);
    if (!resident || resident.status !== 'living') continue;
    for (const order of actorPlan.plan.orders) {
      const validated = validateOrder(ctx, resident, order);
      if (!validated) continue;
      orders.push({
        id: `po:${actorId}:${order.good}:${order.side}`,
        side: order.side,
        good: order.good,
        quantity: validated,
        remaining: validated,
        limitPriceCents: order.limitPriceCents,
        ownerType: 'resident',
        ownerId: actorId,
        actorId,
        reason: `plan_order:${order.side}`,
        tieBreak: nextTie(),
        filledCents: 0,
      });
    }
  }

  if (process.env.TIDEHAVEN_DEBUG_MARKET === '1') {
    for (const good of ['timber', 'grain'] as Good[]) {
      const relevant = orders.filter((o) => o.good === good);
      console.error(
        `[market ${ctx.day}] ${good}: ` +
          relevant
            .map((o) => `${o.side}:${o.ownerType}:${o.ownerId} q${o.quantity} lim${o.limitPriceCents} why${o.reason}`)
            .join(' | '),
      );
    }
  }

  // ---------------------------------------------------------- match per good
  const fills: TradeFill[] = [];
  const volumeByGood: Partial<Record<Good, number>> = {};
  const valueByGood: Partial<Record<Good, number>> = {};
  const unmetDemandByGood: Partial<Record<Good, number>> = {};
  const unsoldSupplyByGood: Partial<Record<Good, number>> = {};

  for (const good of GOODS) {
    const buys = orders
      .filter((o) => o.good === good && o.side === 'buy')
      .sort(
        (a, b) =>
          b.limitPriceCents - a.limitPriceCents ||
          // Households are served before speculative business demand at the same price.
          priorityRank(a) - priorityRank(b) ||
          a.tieBreak - b.tieBreak,
      );
    const sells = orders
      .filter((o) => o.good === good && o.side === 'sell')
      .sort((a, b) => a.limitPriceCents - b.limitPriceCents || a.tieBreak - b.tieBreak);

    for (const buy of buys) {
      for (const sell of sells) {
        if (buy.remaining <= 0) break;
        if (sell.remaining <= 0) continue;
        if (sell.ownerType === buy.ownerType && sell.ownerId === buy.ownerId) continue;
        const price = Math.min(sell.limitPriceCents, buy.limitPriceCents);
        if (price <= 0) continue;
        const affordable = affordableQuantity(ctx, buy, price, commitment);
        const stock = sellableQuantity(ctx, sell, commitment);
        const quantity = Math.min(buy.remaining, sell.remaining, affordable, stock);
        if (quantity <= 0) continue;

        const cost = quantity * price;
        if (cost <= 0) continue;
        try {
          ctx.transfer({
            from: { type: buy.ownerType, id: buy.ownerId },
            to: { type: sell.ownerType, id: sell.ownerId },
            cents: cost,
            reason: `market:${good}`,
          });
          ctx.shiftGoods({
            owner: { type: sell.ownerType, id: sell.ownerId },
            good,
            delta: -quantity,
            reason: `market_sold:${good}`,
          });
          ctx.shiftGoods({
            owner: { type: buy.ownerType, id: buy.ownerId },
            good,
            delta: quantity,
            reason: `market_bought:${good}`,
          });
        } catch {
          // Insufficient funds/stock at resolution time: skip this pairing, keep the rest of the day.
          continue;
        }

        buy.remaining -= quantity;
        sell.remaining -= quantity;
        buy.filledCents += cost;
        sell.filledCents += cost;
        bump(commitment.sold, ownerKeyOf(sell.ownerType, sell.ownerId, good), quantity);
        bump(commitment.spent, ownerKeyOf(buy.ownerType, buy.ownerId, good), cost);

        volumeByGood[good] = (volumeByGood[good] ?? 0) + quantity;
        valueByGood[good] = (valueByGood[good] ?? 0) + cost;
        fills.push({
          good,
          quantity,
          priceCents: price,
          buyerType: buy.ownerType,
          buyerId: buy.ownerId,
          sellerType: sell.ownerType,
          sellerId: sell.ownerId,
        });

        if (sell.ownerType === 'business') {
          chargeBusinessLevy({ ctx, businessId: sell.ownerId, proceedsCents: cost });
          bumpBusinessRevenue(ctx, sell.ownerId, cost);
        }
        if (buy.ownerType === 'household') chargeRetailFeeToShop(ctx, buy.ownerId, cost);
      }
      if (buy.remaining > 0) {
        unmetDemandByGood[good] = (unmetDemandByGood[good] ?? 0) + buy.remaining;
      }
    }
    for (const sell of sells) {
      if (sell.remaining > 0) {
        unsoldSupplyByGood[good] = (unsoldSupplyByGood[good] ?? 0) + sell.remaining;
      }
    }
  }

  // Second provisioning pass: a household still short of food buys whatever meal good is left, so
  // a bad harvest of one crop does not starve a household that can afford the others.
  for (const [householdId, need] of householdNeed) {
    let held = 0;
    for (const good of ctx.scenario.economy.mealGoods) {
      held += quantityOf(ctx.state, 'household', householdId, good);
    }
    let missing = need - held;
    if (missing <= 0) continue;
    for (const good of ctx.scenario.economy.mealGoods) {
      if (missing <= 0) break;
      const sellers = orders
        .filter((o) => o.good === good && o.side === 'sell' && o.remaining > 0)
        .sort((a, b) => a.limitPriceCents - b.limitPriceCents || a.tieBreak - b.tieBreak);
      for (const sell of sellers) {
        if (missing <= 0) break;
        const price = sell.limitPriceCents;
        const cash = ctx.state.accounts.get(`household:${householdId}`)?.balanceCents ?? 0;
        const affordable = Math.floor(cash / Math.max(1, price));
        const quantity = Math.min(missing, sell.remaining, affordable);
        if (quantity <= 0) continue;
        try {
          ctx.transfer({
            from: { type: 'household', id: householdId },
            to: { type: sell.ownerType, id: sell.ownerId },
            cents: quantity * price,
            reason: `market:${good}`,
          });
          ctx.shiftGoods({ owner: { type: sell.ownerType, id: sell.ownerId }, good, delta: -quantity, reason: `market_sold:${good}` });
          ctx.shiftGoods({ owner: { type: 'household', id: householdId }, good, delta: quantity, reason: `market_bought:${good}` });
        } catch {
          continue;
        }
        sell.remaining -= quantity;
        missing -= quantity;
        volumeByGood[good] = (volumeByGood[good] ?? 0) + quantity;
        valueByGood[good] = (valueByGood[good] ?? 0) + quantity * price;
        if (sell.ownerType === 'business') {
          chargeBusinessLevy({ ctx, businessId: sell.ownerId, proceedsCents: quantity * price });
          bumpBusinessRevenue(ctx, sell.ownerId, quantity * price);
        }
      }
    }
  }

  for (const good of GOODS) {
    // Construction demand is consumed once: it raises today's shortage signal, then clears.
    const construction = ctx.state.counters.get(`constructionDemand:${good}`) ?? 0;
    if (construction > 0) ctx.state.counters.delete(`constructionDemand:${good}`);
    ctx.state.counters.set(`shortage:${good}`, (unmetDemandByGood[good] ?? 0) + construction);
  }

  distributeDividends(ctx);

  // ---------------------------------------------------------- consumption, spoilage, prices
  const shortage = consumeAndSpoil(ctx, householdNeed);
  const prices = updatePrices(ctx, unmetDemandByGood, unsoldSupplyByGood);

  return {
    buys: orders.filter((o) => o.side === 'buy').length,
    sells: orders.filter((o) => o.side === 'sell').length,
    fills,
    volumeByGood,
    valueByGood,
    unmetDemandByGood,
    unsoldSupplyByGood,
    prices,
    shortage,
  };
}

/** Rolling revenue estimate per business; hiring decisions use it so staffing follows demand. */
export function bumpBusinessRevenue(ctx: TurnContext, businessId: number, cents: number): void {
  const key = `revenue:${businessId}`;
  const previous = ctx.state.counters.get(key) ?? 0;
  // Exponential smoothing: 20% weight on today's proceeds.
  ctx.state.counters.set(key, Math.floor((previous * 8 + cents * 2) / 10));
}

export function distributeDividends(ctx: TurnContext): void {
  // Dividends and capital calls move money only; contracts are unchanged throughout.
  const staffByBusiness = activeEmploymentByBusiness(ctx.state);
  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    let cash = ctx.state.accounts.get(`business:${business.id}`)?.balanceCents ?? 0;
    // Reserve: enough to cover the next fortnight of payroll, so a slow week cannot cause arrears.
    let wageBill = 0;
    for (const contract of staffByBusiness.get(business.id) ?? []) {
      const wage = typeof contract.terms.wageCents === 'number' ? contract.terms.wageCents : 300;
      wageBill += wage;
    }
    const reserve = Math.max(ctx.scenario.economy.dividendReserveCents, wageBill * 10);

    // Owner recapitalisation: a business that cannot cover a fortnight of payroll calls on its owner's
    // household rather than freezing (a liquidity trap would otherwise stop production forever).
    if (business.ownerType === 'resident' && business.ownerId !== null && cash < reserve) {
      const owner = ctx.state.residents.get(business.ownerId);
      const householdId = owner?.householdId ?? null;
      const householdCash = householdId === null ? 0 : ctx.state.accounts.get(`household:${householdId}`)?.balanceCents ?? 0;
      const shortfall = reserve - cash;
      const injection = Math.min(shortfall, householdCash);
      if (householdId !== null && injection > 0) {
        ctx.transfer({
          from: { type: 'household', id: householdId },
          to: { type: 'business', id: business.id },
          cents: injection,
          reason: 'owner_capital_call',
        });
        cash += injection;
        ctx.emit({
          kind: 'capital_call',
          actorId: business.ownerId,
          targetId: business.id,
          visibility: 'private',
          importance: 20,
          title: `${owner?.name ?? 'The owner'} put ${injection} cents into ${business.name}`,
          detail: { injectionCents: injection },
        });
      }
    }

    const surplus = cash - reserve;
    if (surplus <= 0) continue;

    if (business.ownerType === 'town') {
      ctx.transfer({
        from: { type: 'business', id: business.id },
        to: { type: 'treasury', id: 0 },
        cents: surplus,
        reason: 'town_business_surplus',
      });
      continue;
    }
    if (business.ownerId === null) continue;
    const owner = ctx.state.residents.get(business.ownerId);
    if (!owner || owner.status !== 'living') continue;
    const target =
      owner.householdId === null
        ? { type: 'resident' as const, id: owner.id }
        : { type: 'household' as const, id: owner.householdId };
    ctx.transfer({
      from: { type: 'business', id: business.id },
      to: target,
      cents: surplus,
      reason: 'business_dividend',
    });
  }
}

function priorityRank(order: MarketOrderRecord): number {
  // Productive inputs outrank discretionary household purchases: a bakery converting grain into bread
  // feeds more people than a household eating the grain raw.
  if (order.reason === 'production_input') return 0;
  if (order.reason === 'household_provision' || order.reason === 'personal_provision') return 1;
  return 2;
}

function ownerKeyOf(ownerType: OwnerType, ownerId: number, good: Good): string {
  return `${ownerType}:${ownerId}:${good}`;
}

function bump(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function affordableQuantity(
  ctx: TurnContext,
  order: MarketOrderRecord,
  price: number,
  commitment: PendingCommitment,
): number {
  const account = ctx.state.accounts.get(`${order.ownerType}:${order.ownerId}`);
  const cash = account?.balanceCents ?? 0;
  const already = commitment.spent.get(ownerKeyOf(order.ownerType, order.ownerId, order.good)) ?? 0;
  const remainingCash = cash - already;
  if (remainingCash <= 0) return 0;
  return Math.floor(remainingCash / price);
}

function sellableQuantity(
  ctx: TurnContext,
  order: MarketOrderRecord,
  commitment: PendingCommitment,
): number {
  const available = availableOf(ctx.state, order.ownerType, order.ownerId, order.good);
  const already = commitment.sold.get(ownerKeyOf(order.ownerType, order.ownerId, order.good)) ?? 0;
  return Math.max(0, available - already);
}

function chargeRetailFeeToShop(ctx: TurnContext, householdId: number, purchaseCents: number): void {
  for (const business of ctx.state.businesses.values()) {
    if (business.kind !== 'shop' || business.status !== 'open') continue;
    chargeRetailFee({ ctx, householdId, businessId: business.id, purchaseCents });
    return;
  }
}

function validateOrder(ctx: TurnContext, resident: Resident, order: MarketOrder): number | null {
  if (order.quantity <= 0) return null;
  if (!GOODS.includes(order.good)) return null;
  const reference = ctx.scenario.economy.referencePrices[order.good].price;
  const bounds = ctx.scenario.economy.priceBoundsBps;
  const low = Math.floor((reference * bounds.low) / 10_000);
  const high = Math.floor((reference * bounds.high) / 10_000);
  if (order.limitPriceCents < low || order.limitPriceCents > high * 2) return null;
  if (order.side === 'sell') {
    const available = availableOf(ctx.state, 'resident', resident.id, order.good);
    if (available <= 0) return null;
    return Math.min(order.quantity, available);
  }
  const cash = ctx.state.accounts.get(`resident:${resident.id}`)?.balanceCents ?? 0;
  if (cash < order.limitPriceCents) return null;
  return order.quantity;
}

/**
 * The town granary. The founding charter keeps the staple trades in common hands, so a household that
 * cannot buy enough food takes the shortfall from town stock and pays what it can; the treasury covers
 * the rest. Hunger then only happens when the town genuinely has no food, not when a family is poor.
 */
function granaryTopUp(ctx: TurnContext, householdId: number, need: number): void {
  const held = ctx.scenario.economy.mealGoods.reduce(
    (sum, good) => sum + quantityOf(ctx.state, 'household', householdId, good),
    0,
  );
  let missing = need - held;
  if (missing <= 0) return;

  const townStores: { ownerId: number; ownerType: 'treasury' }[] = [{ ownerId: 0, ownerType: 'treasury' }];
  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    if (business.ownerType !== 'town') continue;
    townStores.push({ ownerId: business.id, ownerType: 'treasury' });
  }

  for (const good of ctx.scenario.economy.mealGoods) {
    if (missing <= 0) break;
    for (const store of townStores) {
      if (missing <= 0) break;
      const ownerType = store.ownerId === 0 ? 'treasury' : 'business';
      const stock = quantityOf(ctx.state, ownerType, store.ownerId, good);
      if (stock <= 0) continue;
      const take = Math.min(stock, missing);
      const price = ctx.state.prices.get(good) ?? ctx.scenario.economy.referencePrices[good].price;
      const householdCash = ctx.state.accounts.get(`household:${householdId}`)?.balanceCents ?? 0;
      const paid = Math.min(householdCash, take * price);
      ctx.shiftGoods({ owner: { type: ownerType, id: store.ownerId }, good, delta: -take, reason: 'granary_issue' });
      ctx.shiftGoods({ owner: { type: 'household', id: householdId }, good, delta: take, reason: 'granary_received' });
      if (paid > 0) {
        ctx.transfer({
          from: { type: 'household', id: householdId },
          to: { type: ownerType, id: store.ownerId },
          cents: paid,
          reason: 'granary_purchase',
        });
      }
      const uncovered = take * price - paid;
      const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
      if (uncovered > 0 && treasury >= uncovered) {
        ctx.transfer({
          from: { type: 'treasury', id: 0 },
          to: { type: ownerType, id: store.ownerId },
          cents: uncovered,
          reason: 'granary_relief',
        });
      }
      missing -= take;
    }
  }
  if (missing < 0) missing = 0;
}

function consumeAndSpoil(ctx: TurnContext, householdNeed: Map<number, number>): boolean {
  let shortage = false;
  const order: Good[] = ['bread', 'fish', 'grain'];
  for (const [householdId, need] of householdNeed) {
    granaryTopUp(ctx, householdId, need);
  }
  // Eating changes stock and hunger counters, never household membership or life status.
  const membersByHousehold = livingMembersByHousehold(ctx.state);
  for (const [householdId, need] of householdNeed) {
    let remaining = need;
    for (const good of order) {
      if (remaining <= 0) break;
      const have = quantityOf(ctx.state, 'household', householdId, good);
      if (have <= 0) continue;
      const eat = Math.min(have, remaining);
      ctx.shiftGoods({
        owner: { type: 'household', id: householdId },
        good,
        delta: -eat,
        reason: 'household_consumption',
      });
      remaining -= eat;
    }
    const members = membersByHousehold.get(householdId) ?? [];
    if (remaining > 0) {
      shortage = true;
      for (const resident of members) {
        resident.hungerDays += 1;
      }
      if (members.length > 0) {
        ctx.emit({
          kind: 'food_shortage',
          actorId: null,
          targetId: householdId,
          visibility: 'public',
          importance: 30,
          title: `Household ${ctx.state.households.get(householdId)?.name ?? householdId} went hungry`,
          detail: { missingMeals: remaining, residents: members.map((m) => m.id) },
        });
      }
    } else {
      for (const resident of members) {
        resident.hungerDays = Math.max(0, resident.hungerDays - 1);
      }
    }
  }

  // Spoilage of perishables held by any owner.
  const spoilage = ctx.scenario.economy.spoilageBps;
  for (const [key, quantity] of [...ctx.state.inventories.entries()]) {
    const parts = key.split(':');
    const good = parts[2] as Good | undefined;
    if (!good) continue;
    const bps = spoilage[good] ?? 0;
    if (bps <= 0 || quantity <= ctx.scenario.economy.spoilageMinStock) continue;
    const lost = Math.floor((quantity * bps) / 10_000);
    if (lost <= 0) continue;
    ctx.shiftGoods({
      owner: { type: parts[0] as OwnerType, id: Number(parts[1]) },
      good,
      delta: -lost,
      reason: 'spoilage',
    });
  }
  return shortage;
}

function updatePrices(
  ctx: TurnContext,
  unmet: Partial<Record<Good, number>>,
  unsold: Partial<Record<Good, number>>,
): Partial<Record<Good, number>> {
  const bounds = ctx.scenario.economy.priceBoundsBps;
  const step = ctx.scenario.economy.priceStepBps;
  const prices: Partial<Record<Good, number>> = {};
  for (const good of GOODS) {
    const reference = ctx.scenario.economy.referencePrices[good].price;
    const current = ctx.state.prices.get(good) ?? reference;
    const demand = unmet[good] ?? 0;
    const supply = unsold[good] ?? 0;
    let next = current;
    if (demand > 0 && supply === 0) next = Math.floor((current * (10_000 + step)) / 10_000);
    else if (supply > 0 && demand === 0) next = Math.floor((current * (10_000 - step)) / 10_000);
    next = Math.max(Math.floor((reference * bounds.low) / 10_000), Math.min(Math.floor((reference * bounds.high) / 10_000), next));
    next = Math.max(1, Math.trunc(next));
    ctx.state.prices.set(good, next);
    prices[good] = next;
  }
  return prices;
}

export function marketPrice(ctx: TurnContext, good: Good): number {
  return ctx.state.prices.get(good) ?? ctx.scenario.economy.referencePrices[good].price;
}
