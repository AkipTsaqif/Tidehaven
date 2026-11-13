import type { TurnContext } from '../turn-context.js';
import { balanceOf, ownerKey, type OwnerType } from '../state.js';

/**
 * Money helpers used by every economic rule. All of them go through ctx.transfer so each movement
 * produces exactly two ledger rows (double entry) with a stable transaction id.
 */

export function wagesDue(_ctx: TurnContext, wagePerDay: number, labourPoints: number): number {
  if (labourPoints <= 0) return 0;
  return Math.floor((wagePerDay * labourPoints) / 100);
}

export interface PayResult {
  paidCents: number;
  arrearsCents: number;
}

/** Pay a worker from a payer account, withholding income tax into the treasury. */
export function payWage(params: {
  ctx: TurnContext;
  fromOwner: OwnerType;
  fromId: number;
  workerId: number;
  grossCents: number;
  reason: string;
  eventId?: number | null;
}): PayResult {
  const { ctx, fromOwner, fromId, workerId, grossCents, reason, eventId = null } = params;
  if (grossCents <= 0) return { paidCents: 0, arrearsCents: 0 };
  const available = balanceOf(ctx.state, fromOwner, fromId);
  const paid = Math.min(grossCents, Math.max(0, available));
  if (paid === 0) return { paidCents: 0, arrearsCents: grossCents };

  const taxBps = Number(ctx.state.policies.get('incomeTaxBps') ?? ctx.scenario.economy.incomeTaxBps);
  const cappedBps = Math.min(taxBps, ctx.scenario.economy.maxIncomeTaxBps);
  const taxCents = Math.floor((paid * cappedBps) / 10_000);

  const netCents = paid - taxCents;
  const worker = ctx.state.residents.get(workerId);
  const householdId = worker?.householdId ?? null;
  const allowanceBps = ctx.scenario.economy.personalAllowanceBps;
  const allowance = householdId === null ? netCents : Math.floor((netCents * allowanceBps) / 10_000);
  const householdShare = netCents - allowance;
  ctx.transfer({
    from: { type: fromOwner, id: fromId },
    to: { type: 'resident', id: workerId },
    cents: allowance,
    reason,
    eventId,
  });
  if (householdId !== null && householdShare > 0) {
    ctx.transfer({
      from: { type: fromOwner, id: fromId },
      to: { type: 'household', id: householdId },
      cents: householdShare,
      reason: 'wage_to_household',
      eventId,
    });
  }
  if (taxCents > 0) {
    ctx.transfer({
      from: { type: fromOwner, id: fromId },
      to: { type: 'treasury', id: 0 },
      cents: taxCents,
      reason: 'income_tax',
      eventId,
    });
    ctx.tax(workerId, 'income', taxCents);
  }
  return { paidCents: paid, arrearsCents: grossCents - paid };
}

/** Business levy on gross proceeds, paid at market settlement. */
export function chargeBusinessLevy(params: {
  ctx: TurnContext;
  businessId: number;
  proceedsCents: number;
  eventId?: number | null;
}): number {
  const { ctx, businessId, proceedsCents, eventId = null } = params;
  const bps = Number(ctx.state.policies.get('businessLevyBps') ?? ctx.scenario.economy.businessLevyBps);
  if (bps <= 0 || proceedsCents <= 0) return 0;
  const levy = Math.min(Math.floor((proceedsCents * bps) / 10_000), balanceOf(ctx.state, 'business', businessId));
  if (levy <= 0) return 0;
  ctx.transfer({
    from: { type: 'business', id: businessId },
    to: { type: 'treasury', id: 0 },
    cents: levy,
    reason: 'business_levy',
    eventId,
  });
  ctx.tax(null, 'business_levy', levy);
  return levy;
}

/** Retail fee: a share of a household purchase paid to the open shop that served it. */
export function chargeRetailFee(params: {
  ctx: TurnContext;
  householdId: number;
  businessId: number;
  purchaseCents: number;
}): number {
  const { ctx, householdId, businessId, purchaseCents } = params;
  const bps = ctx.scenario.economy.retailFeeBps;
  if (bps <= 0) return 0;
  const fee = Math.min(
    Math.floor((purchaseCents * bps) / 10_000),
    balanceOf(ctx.state, 'household', householdId),
  );
  if (fee <= 0) return 0;
  ctx.transfer({
    from: { type: 'household', id: householdId },
    to: { type: 'business', id: businessId },
    cents: fee,
    reason: 'retail_fee',
  });
  return fee;
}

export function accountExists(ctx: TurnContext, ownerType: OwnerType, ownerId: number): boolean {
  return ctx.state.accounts.has(ownerKey(ownerType, ownerId));
}

/** Total money held by a sector (diagnostics and metrics). */
export function sectorTotal(ctx: TurnContext, ownerType: OwnerType): number {
  let total = 0;
  for (const account of ctx.state.accounts.values()) {
    if (account.ownerType === ownerType) total += account.balanceCents;
  }
  return total;
}
