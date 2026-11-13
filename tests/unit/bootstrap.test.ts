import { describe, expect, it } from 'vitest';
import { loadScenario, scenarioHash } from '../../src/application/scenario.js';
import { buildState } from '../../src/application/bootstrap.js';
import { checkGoodsLedger, checkInvariants } from '../../src/domain/invariants.js';
import { GOODS, livingResidents, population } from '../../src/domain/state.js';
import { hashValue } from '../../src/domain/hash.js';

const scenario = loadScenario(process.cwd());

function freshState() {
  return buildState({
    worldId: 1,
    scenario,
    worldName: 'Tidehaven',
    seed: 'unit-seed',
    drama: 'dramatic',
    populationTarget: 120,
    hostCeiling: 500,
  });
}

describe('scenario contract', () => {
  it('defines every recipe referenced by a business and a price for every good', () => {
    for (const business of scenario.town.businesses) {
      expect(scenario.economy.recipes[business.kind]).toBeDefined();
    }
    for (const good of GOODS) {
      expect(scenario.economy.referencePrices[good].price).toBeGreaterThan(0);
    }
    expect(scenarioHash(scenario)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across loads (rules hash does not drift)', () => {
    const again = loadScenario(process.cwd());
    expect(hashValue(again)).toBe(hashValue(scenario));
  });
});

describe('founding town', () => {
  it('starts with exactly 25 named, housed residents of mixed ages', () => {
    const state = freshState();
    expect(population(state)).toBe(25);
    const names = new Set([...state.residents.values()].map((r) => r.name));
    expect(names.size).toBe(25);
    for (const resident of livingResidents(state)) {
      expect(resident.householdId).not.toBeNull();
    }
    const ages = [...state.residents.values()].map((r) => -r.bornDay / scenario.calendar.daysPerYear);
    expect(ages.some((age) => age < 18)).toBe(true);
    expect(ages.some((age) => age >= 18 && age < 65)).toBe(true);
    expect(ages.some((age) => age >= 65)).toBe(true);
  });

  it('starts with conserved money and reconcilable goods', () => {
    const state = freshState();
    const report = checkInvariants(state);
    expect(report.ok).toBe(true);
    expect(report.money.totalCents).toBe(report.money.baseCents);
    expect(report.money.treasuryCents).toBeGreaterThan(0);
  });

  it('seeds a working food economy with staffed businesses', () => {
    const state = freshState();
    const open = [...state.businesses.values()].filter((b) => b.status === 'open');
    expect(open.length).toBeGreaterThanOrEqual(6);
    const contracts = [...state.contracts.values()].filter((c) => c.status === 'active');
    expect(contracts.length).toBeGreaterThanOrEqual(12);
    expect([...state.offices.values()].filter((seat) => seat.holderId !== null).length).toBeGreaterThanOrEqual(6);
    expect(state.counters.get('moneyBaseCents')).toBeGreaterThan(0);
  });

  it('links founding couples symmetrically', () => {
    const state = freshState();
    for (const resident of livingResidents(state)) {
      if (resident.partnerId === null) continue;
      const partner = state.residents.get(resident.partnerId);
      expect(partner?.partnerId).toBe(resident.id);
    }
  });
});

describe('invariants catch corruption', () => {
  it('detects money creation', () => {
    const state = freshState();
    const account = state.accounts.get('treasury:0');
    if (account) account.balanceCents += 1;
    const report = checkInvariants(state);
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.code === 'money_not_conserved')).toBe(true);
  });

  it('detects negative goods and over-reservation', () => {
    const state = freshState();
    state.inventories.set('business:1:bread', -3);
    state.inventories.set('business:1:grain', 2);
    state.reserved.set('business:1:grain', 5);
    const report = checkInvariants(state);
    expect(report.violations.some((v) => v.code === 'goods_negative')).toBe(true);
    expect(report.violations.some((v) => v.code === 'over_reserved')).toBe(true);
  });

  it('reconciles stock against recorded goods flows', () => {
    const state = freshState();
    const flows: Record<string, number> = {};
    for (const [key, quantity] of state.inventories.entries()) {
      const good = key.split(':')[2] ?? '';
      flows[good] = (flows[good] ?? 0) + quantity;
    }
    expect(checkGoodsLedger(state, flows)).toHaveLength(0);
    expect(checkGoodsLedger(state, { ...flows, bread: (flows.bread ?? 0) + 1 })).not.toHaveLength(0);
  });

  it('detects a homeless resident and a one-sided partnership', () => {
    const state = freshState();
    const resident = livingResidents(state)[0]!;
    resident.householdId = null;
    const other = livingResidents(state).find((r) => r.id !== resident.id && r.partnerId === null) ?? livingResidents(state)[1]!;
    other.partnerId = resident.id;
    const report = checkInvariants(state);
    expect(report.violations.some((v) => v.code === 'homeless_resident')).toBe(true);
    expect(report.violations.some((v) => v.code === 'partner_asymmetric')).toBe(true);
  });
});
