import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { emptyState, GOODS, MAX_CENTS, type Good } from '../../src/domain/state.js';
import { loadScenario } from '../../src/application/scenario.js';
import { checkInvariants } from '../../src/domain/invariants.js';

const scenario = loadScenario(process.cwd());

function stateWithAccounts(balances: number[]) {
  const state = emptyState({
    worldId: 1,
    name: 'Prop',
    seed: 'prop',
    rulesVersion: 'v1',
    drama: 'calm',
    populationTarget: 10,
    hostCeiling: 100,
  });
  balances.forEach((balance, index) => {
    state.accounts.set(`resident:${index + 1}`, { ownerType: 'resident', ownerId: index + 1, balanceCents: balance });
  });
  const total = balances.reduce((a, b) => a + b, 0);
  state.counters.set('moneyBaseCents', total);
  return state;
}

describe('money is conserved under arbitrary transfers', () => {
  it('keeps the total constant for thousands of random internal transfers', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 2, maxLength: 6 }),
        fc.array(fc.tuple(fc.nat(5), fc.nat(5), fc.integer({ min: 1, max: 5_000 })), { maxLength: 40 }),
        (balances, transfers) => {
          const state = stateWithAccounts(balances);
          const ctx = createTurnContext({ state, scenario, day: 1 });
          const base = [...state.accounts.values()].reduce((sum, account) => sum + account.balanceCents, 0);
          for (const [fromIndex, toIndex, amount] of transfers) {
            const from = `resident:${(fromIndex % balances.length) + 1}`;
            const to = `resident:${(toIndex % balances.length) + 1}`;
            if (from === to) continue;
            const available = state.accounts.get(from)?.balanceCents ?? 0;
            if (available < amount) continue;
            const fromId = Number(from.split(':')[1]);
            const toId = Number(to.split(':')[1]);
            ctx.transfer({ from: { type: 'resident', id: fromId }, to: { type: 'resident', id: toId }, cents: amount, reason: 'prop' });
          }
          const after = [...state.accounts.values()].reduce((sum, account) => sum + account.balanceCents, 0);
          expect(after).toBe(base);
          for (const account of state.accounts.values()) {
            expect(account.balanceCents).toBeGreaterThanOrEqual(0);
            expect(Number.isSafeInteger(account.balanceCents)).toBe(true);
            expect(Math.abs(account.balanceCents)).toBeLessThan(MAX_CENTS);
          }
          return checkInvariants(state).violations.every((violation) => violation.code !== 'money_not_conserved');
        },
      ),
      { numRuns: 60 },
    );
  });

  it('never allows an internal account to go negative', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 1, max: 5_000 }), (balance, amount) => {
        const state = stateWithAccounts([balance, 0]);
        const ctx = createTurnContext({ state, scenario, day: 1 });
        if (amount <= balance) {
          ctx.transfer({ from: { type: 'resident', id: 1 }, to: { type: 'resident', id: 2 }, cents: amount, reason: 'prop' });
          return state.accounts.get('resident:1')?.balanceCents === balance - amount;
        }
        expect(() =>
          ctx.transfer({ from: { type: 'resident', id: 1 }, to: { type: 'resident', id: 2 }, cents: amount, reason: 'prop' }),
        ).toThrow();
        return true;
      }),
      { numRuns: 40 },
    );
  });
});

describe('goods accounting', () => {
  it('keeps quantities integral, non-negative, and explains stock by flows', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...GOODS), fc.integer({ min: -20, max: 40 })), { maxLength: 60 }),
        (ops) => {
          const state = emptyState({
            worldId: 1,
            name: 'Goods',
            seed: 'goods',
            rulesVersion: 'v1',
            drama: 'calm',
            populationTarget: 1,
            hostCeiling: 10,
          });
          const ctx = createTurnContext({ state, scenario, day: 1 });
          const flowTotals = new Map<string, number>();
          for (const [good, delta] of ops) {
            const current = state.inventories.get(`household:1:${good}`) ?? 0;
            const next = current + delta;
            if (next < 0) {
              expect(() =>
                ctx.shiftGoods({ owner: { type: 'household', id: 1 }, good, delta, reason: 'prop' }),
              ).toThrow();
            } else {
              ctx.shiftGoods({ owner: { type: 'household', id: 1 }, good: good as Good, delta, reason: 'prop' });
              flowTotals.set(good, (flowTotals.get(good) ?? 0) + delta);
            }
          }
          for (const [good, total] of flowTotals) {
            const stock = state.inventories.get(`household:1:${good}`) ?? 0;
            expect(stock).toBe(total);
            expect(Number.isInteger(stock)).toBe(true);
            expect(stock).toBeGreaterThanOrEqual(0);
          }
          return true;
        },
      ),
      { numRuns: 40 },
    );
  });
});
