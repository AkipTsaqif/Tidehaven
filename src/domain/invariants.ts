import {
  GOODS,
  MAX_QUANTITY,
  type Good,
  type WorldState,
  expectedBirths,
  population,
} from './state.js';
import { developmentViolations } from './development-invariants.js';

/**
 * Accounting invariants. Checked every day before commit; a failure pauses simulated time and never
 * "repairs" data silently.
 */

export interface InvariantViolation {
  code: string;
  detail: string;
}

export interface InvariantReport {
  ok: boolean;
  violations: InvariantViolation[];
  money: { totalCents: number; baseCents: number; treasuryCents: number };
  goods: Record<string, { total: number; reserved: number }>;
  population: number;
  expectedBirths: number;
}

export function checkInvariants(state: WorldState, flowTotals?: Record<string, number>): InvariantReport {
  const violations: InvariantViolation[] = [];

  let totalCents = 0;
  let treasuryCents = 0;
  for (const account of state.accounts.values()) {
    if (!Number.isSafeInteger(account.balanceCents)) {
      violations.push({
        code: 'money_non_integer',
        detail: `${account.ownerType}:${account.ownerId} has non-integer balance ${account.balanceCents}`,
      });
      continue;
    }
    totalCents += account.balanceCents;
    if (account.ownerType === 'treasury') treasuryCents = account.balanceCents;
    if (account.ownerType === 'treasury' && account.balanceCents < 0) {
      violations.push({ code: 'treasury_negative', detail: `Treasury overdrawn: ${account.balanceCents}` });
    }
    if (account.ownerType !== 'external' && account.balanceCents < 0) {
      violations.push({
        code: 'negative_balance',
        detail: `${account.ownerType}:${account.ownerId} balance ${account.balanceCents}`,
      });
    }
  }

  // Money is conserved across every account, external settlement included: bootstrap issuance is the
  // only creation event and is recorded as a counter.
  const baseCents = state.counters.get('moneyBaseCents') ?? 0;
  if (baseCents !== 0 && totalCents !== baseCents) {
    violations.push({
      code: 'money_not_conserved',
      detail: `total ${totalCents} != base ${baseCents} (difference ${totalCents - baseCents})`,
    });
  }

  const goods: Record<string, { total: number; reserved: number }> = {};
  for (const good of GOODS) goods[good] = { total: 0, reserved: 0 };

  for (const [key, quantity] of state.inventories.entries()) {
    const parts = key.split(':');
    const good = parts[2] as Good | undefined;
    if (!good || !GOODS.includes(good)) {
      violations.push({ code: 'unknown_good', detail: `inventory ${key}` });
      continue;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) {
      violations.push({ code: 'goods_negative', detail: `${key} = ${quantity}` });
      continue;
    }
    if (quantity > MAX_QUANTITY) {
      violations.push({ code: 'goods_overflow', detail: `${key} = ${quantity}` });
    }
    const bucket = goods[good];
    if (bucket) bucket.total += quantity;
  }

  for (const [key, reserved] of state.reserved.entries()) {
    const quantity = state.inventories.get(key) ?? 0;
    if (reserved > quantity) {
      violations.push({ code: 'over_reserved', detail: `${key} reserved ${reserved} > ${quantity}` });
    }
    if (!Number.isSafeInteger(reserved) || reserved < 0) {
      violations.push({ code: 'reserved_invalid', detail: `${key} reserved ${reserved}` });
    }
    const good = key.split(':')[2] as Good | undefined;
    if (good && goods[good]) goods[good].reserved += reserved;
  }
  for (const good of GOODS) {
    const bucket = goods[good];
    if (bucket && !Number.isSafeInteger(bucket.total)) {
      violations.push({ code: 'goods_total_invalid', detail: `${good} total ${bucket.total}` });
    }
  }

  for (const resident of state.residents.values()) {
    if (resident.status === 'living' && resident.deathDay !== null) {
      violations.push({ code: 'living_with_death', detail: `resident ${resident.id}` });
    }
    if (resident.status === 'dead' && resident.deathDay === null) {
      violations.push({ code: 'dead_without_day', detail: `resident ${resident.id}` });
    }
    if (resident.partnerId !== null) {
      const partner = state.residents.get(resident.partnerId);
      if (!partner) {
        violations.push({ code: 'partner_missing', detail: `resident ${resident.id} -> ${resident.partnerId}` });
      } else if (partner.partnerId !== resident.id) {
        violations.push({
          code: 'partner_asymmetric',
          detail: `resident ${resident.id} -> ${partner.id} but back is ${partner.partnerId}`,
        });
      }
    }
    if (resident.status === 'living' && resident.householdId === null) {
      violations.push({ code: 'homeless_resident', detail: `resident ${resident.id}` });
    }
  }

  // Relationship keys must be canonical (`kind:lo:hi`). A custom in-memory key is silently renaming
  // itself on reload, so the live state would diverge from its own committed hash.
  for (const [key, relationship] of state.relationships.entries()) {
    const expected = `${relationship.kind}:${Math.min(relationship.aId, relationship.bId)}:${Math.max(
      relationship.aId,
      relationship.bId,
    )}`;
    if (key !== expected) {
      violations.push({ code: 'relationship_key_noncanonical', detail: `${key} should be ${expected}` });
    }
  }

  // Account rows and inventories are keyed by their own owner/good fields; a mismatch does not round-trip.
  for (const [key, account] of state.accounts.entries()) {
    const expected = `${account.ownerType}:${account.ownerId}`;
    if (key !== expected) {
      violations.push({ code: 'account_key_noncanonical', detail: `${key} should be ${expected}` });
    }
  }

  for (const pregnancy of state.pregnancies.values()) {
    if (pregnancy.status === 'active' && pregnancy.dueDay <= pregnancy.conceivedDay) {
      violations.push({ code: 'pregnancy_timeline', detail: `pregnancy ${pregnancy.id}` });
    }
  }

  for (const price of state.prices.entries()) {
    if (!Number.isSafeInteger(price[1]) || price[1] < 0) {
      violations.push({ code: 'price_invalid', detail: `${price[0]} = ${price[1]}` });
    }
  }

  // Goods reconciliation is part of the commit gate, not a separate harness-only check: recorded
  // flows and physical stock must agree before a day is allowed to become authoritative.
  violations.push(...checkGoodsLedger(state, flowTotals));
  violations.push(...developmentViolations(state));

  const seatHolders = new Map<string, number>();
  for (const seat of state.offices.values()) {
    if (seat.holderId === null) continue;
    const count = (seatHolders.get(seat.key) ?? 0) + 1;
    seatHolders.set(seat.key, count);
  }

  return {
    ok: violations.length === 0,
    violations,
    money: { totalCents, baseCents, treasuryCents },
    goods,
    population: population(state),
    expectedBirths: expectedBirths(state),
  };
}

/**
 * Goods reconciliation: total stock of each good must equal the running total of every recorded flow
 * (production, imports, consumption, spoilage, transfers, destruction). Raw flow rows may be archived
 * away, so the authoritative figure is the persisted per-good counter.
 */
export function checkGoodsLedger(
  state: WorldState,
  flowTotals?: Record<string, number>,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const good of GOODS) {
    let stock = 0;
    for (const [key, quantity] of state.inventories.entries()) {
      if (key.endsWith(`:${good}`)) stock += quantity;
    }
    const flow = flowTotals?.[good] ?? state.counters.get(`goodsFlow:${good}`) ?? 0;
    if (stock !== flow) {
      violations.push({
        code: 'goods_unreconciled',
        detail: `${good}: stock ${stock} != recorded flows ${flow}`,
      });
    }
  }
  return violations;
}
