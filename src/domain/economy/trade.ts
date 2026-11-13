import type { TurnContext } from '../turn-context.js';
import { isShippingDay } from '../clock.js';
import { FOOD_GOODS, type Business, type Good, type OwnerType } from '../state.js';
import { availableOf, quantityOf } from '../state.js';
import { balanceOf } from '../state.js';
import { chargeBusinessLevy } from './ledger.js';
import { bumpBusinessRevenue } from './market.js';

/**
 * External trade. The town is a small open economy: a weekly ship buys surplus at export prices and
 * sells imports at import prices, capped by finite capacity. The external account is a real account,
 * so money is conserved across imports/exports (its balance is the town's net trade position).
 */

export interface TradeReport {
  ran: boolean;
  exported: Partial<Record<Good, number>>;
  imported: Partial<Record<Good, number>>;
  exportProceedsCents: number;
  importCostCents: number;
  reliefDelivered: Partial<Record<Good, number>>;
}

export function runTrade(ctx: TurnContext): TradeReport {
  ctx.setPhase('trade');
  const report: TradeReport = {
    ran: false,
    exported: {},
    imported: {},
    exportProceedsCents: 0,
    importCostCents: 0,
    reliefDelivered: {},
  };
  if (!isShippingDay(ctx.day, ctx.scenario.calendar)) return report;
  report.ran = true;

  const capacity = ctx.scenario.economy.externalCapacityUnits;

  // ---------------------------------------------------------------- exports
  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    const recipe = ctx.scenario.economy.recipes[business.kind];
    if (!recipe) continue;
    for (const good of Object.keys(recipe.outputs ?? {}) as Good[]) {
      const buffer = Math.max(
        4,
        (recipe.outputs[good] ?? 0) * 2,
        ...Object.entries(recipe.inputs ?? {}).map(([, perBatch]) => perBatch * 2),
      );
      const stock = availableOf(ctx.state, 'business', business.id, good);
      const surplus = Math.max(0, stock - buffer);
      if (surplus <= 0) continue;
      const quantity = Math.min(surplus, capacity);
      const price = ctx.scenario.economy.referencePrices[good].export;
      const proceeds = quantity * price;
      // The outside world is not an infinite buyer: once its credit line to the town is exhausted it
      // stops buying, and surplus production must find a domestic use or spoil.
      const externalBalance = balanceOf(ctx.state, 'external', 0);
      const creditLimit = -ctx.scenario.economy.externalCreditLimitCents;
      if (externalBalance - proceeds < creditLimit) continue;
      ctx.shiftGoods({
        owner: { type: 'business', id: business.id },
        good,
        delta: -quantity,
        reason: 'export_sold',
      });
      ctx.transfer({
        from: { type: 'external', id: 0 },
        to: { type: 'business', id: business.id },
        cents: proceeds,
        reason: `export:${good}`,
      });
      chargeBusinessLevy({ ctx, businessId: business.id, proceedsCents: proceeds });
      bumpBusinessRevenue(ctx, business.id, proceeds);
      report.exported[good] = (report.exported[good] ?? 0) + quantity;
      report.exportProceedsCents += proceeds;
      ctx.shipping.push({ day: ctx.day, cashCents: proceeds, goods: { [good]: quantity }, direction: 'export' });
    }
  }

  // ---------------------------------------------------------------- imports (food security)
  const foodStock = totalStock(ctx, FOOD_GOODS);
  const populationCount = [...ctx.state.residents.values()].filter((r) => r.status === 'living').length;
  const dailyNeed = Math.max(1, populationCount * ctx.scenario.economy.foodNeedPerDay);
  const targetStock = dailyNeed * 5;
  if (foodStock < targetStock) {
    const missing = targetStock - foodStock;
    for (const good of ['bread', 'grain'] as Good[]) {
      const remaining = missing - Object.values(report.imported).reduce((a, b) => a + (b ?? 0), 0);
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, capacity);
      const unit = ctx.scenario.economy.referencePrices[good].import;
      const affordable = Math.floor(balanceOf(ctx.state, 'treasury', 0) / unit);
      const buy = Math.min(quantity, affordable);
      if (buy <= 0) break;
      const cost = buy * unit;
      ctx.transfer({
        from: { type: 'treasury', id: 0 },
        to: { type: 'external', id: 0 },
        cents: cost,
        reason: `import:${good}`,
      });
      ctx.shiftGoods({ owner: { type: 'treasury', id: 0 }, good, delta: buy, reason: 'import' });
      report.imported[good] = (report.imported[good] ?? 0) + buy;
      report.importCostCents += cost;
      ctx.shipping.push({ day: ctx.day, cashCents: -cost, goods: { [good]: buy }, direction: 'import' });
    }
    // Distribute imported food to households in proportion to members (relief, not a gift of cash).
    const households = [...ctx.state.households.values()].filter((h) => h.dissolvedDay === null);
    if (households.length > 0) {
      for (const good of ['bread', 'grain'] as Good[]) {
        const available = quantityOf(ctx.state, 'treasury', 0, good);
        if (available <= 0) continue;
        const perHousehold = Math.floor(available / households.length);
        if (perHousehold <= 0) continue;
        for (const household of households) {
          ctx.shiftGoods({
            owner: { type: 'treasury', id: 0 },
            good,
            delta: -perHousehold,
            reason: 'relief_issued',
          });
          ctx.shiftGoods({
            owner: { type: 'household', id: household.id },
            good,
            delta: perHousehold,
            reason: 'relief_received',
          });
          report.reliefDelivered[good] = (report.reliefDelivered[good] ?? 0) + perHousehold;
        }
      }
      if (Object.keys(report.reliefDelivered).length > 0) {
        ctx.emit({
          kind: 'relief_distributed',
          actorId: null,
          targetId: null,
          visibility: 'public',
          importance: 30,
          title: 'The council distributed relief food',
          detail: { goods: report.reliefDelivered, costCents: report.importCostCents },
        });
      }
    }
  }

  // ---------------------------------------------------------------- imports (medicine, tools)
  for (const [good, threshold] of [
    ['medicine', 6],
    ['tools', 6],
  ] as [Good, number][]) {
    const stock = totalStock(ctx, [good]);
    if (stock >= threshold) continue;
    const quantity = Math.min(threshold - stock, capacity);
    const unit = ctx.scenario.economy.referencePrices[good].import;
    const affordable = Math.floor(balanceOf(ctx.state, 'treasury', 0) / unit);
    const buy = Math.min(quantity, affordable);
    if (buy <= 0) continue;
    const cost = buy * unit;
    ctx.transfer({ from: { type: 'treasury', id: 0 }, to: { type: 'external', id: 0 }, cents: cost, reason: `import:${good}` });
    ctx.shiftGoods({ owner: { type: 'treasury', id: 0 }, good, delta: buy, reason: 'import' });
    report.imported[good] = (report.imported[good] ?? 0) + buy;
    report.importCostCents += cost;
    ctx.shipping.push({ day: ctx.day, cashCents: -cost, goods: { [good]: buy }, direction: 'import' });
  }

  if (report.exportProceedsCents > 0 || report.importCostCents > 0) {
    ctx.emit({
      kind: 'shipping_settled',
      actorId: null,
      targetId: null,
      visibility: 'public',
      importance: 15,
      title: 'The weekly ship came and went',
      detail: {
        exported: report.exported,
        imported: report.imported,
        proceedsCents: report.exportProceedsCents,
        costCents: report.importCostCents,
      },
    });
  }

  return report;
}

function totalStock(ctx: TurnContext, goods: readonly Good[]): number {
  let total = 0;
  for (const [key, quantity] of ctx.state.inventories.entries()) {
    const parts = key.split(':');
    const good = parts[2] as Good | undefined;
    if (!good || !goods.includes(good)) continue;
    const ownerType = parts[0] as OwnerType;
    if (ownerType === 'external') continue;
    total += quantity;
  }
  return total;
}

export function businessOutputStock(ctx: TurnContext, business: Business): number {
  const recipe = ctx.scenario.economy.recipes[business.kind];
  if (!recipe) return 0;
  let total = 0;
  for (const good of Object.keys(recipe.outputs ?? {}) as Good[]) {
    total += quantityOf(ctx.state, 'business', business.id, good);
  }
  return total;
}
