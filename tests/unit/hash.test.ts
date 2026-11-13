import { describe, expect, it } from 'vitest';
import { canonicalStringify, hashValue, sha256, stateHash, stateSnapshot } from '../../src/domain/hash.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { emptyState, type WorldState } from '../../src/domain/state.js';
import { loadScenario } from '../../src/application/scenario.js';

const scenario = loadScenario(process.cwd());

function tinyState(): WorldState {
  const state = emptyState({
    worldId: 1,
    name: 'Test',
    seed: 'seed',
    rulesVersion: 'v1',
    drama: 'calm',
    populationTarget: 10,
    hostCeiling: 100,
  });
  state.residents.set(1, {
    id: 1,
    name: 'Ada Test',
    sex: 'female',
    bornDay: -10_000,
    origin: 'founder',
    status: 'living',
    deathDay: null,
    deathCause: null,
    householdId: 1,
    partnerId: null,
    motherId: null,
    fatherId: null,
    guardianId: null,
    traits: { diligence: 60 },
    skills: {},
    healthState: 'healthy',
    health: {},
    hungerDays: 0,
    educationDays: 0,
    legacyOf: null,
    emigratedDay: null,
    destination: null,
    rngSalt: 7,
  });
  state.households.set(1, { id: 1, name: 'Test', buildingId: null, capacity: 4, formedDay: 0, dissolvedDay: null });
  return state;
}

describe('canonical hashing', () => {
  it('is insensitive to key insertion order', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
    expect(hashValue({ x: [1, 2, { z: 1, y: 2 }] })).toBe(hashValue({ x: [1, 2, { y: 2, z: 1 }] }));
  });

  it('changes when any authoritative value changes', () => {
    const state = tinyState();
    const before = stateHash(state);
    state.residents.get(1)!.hungerDays = 1;
    expect(stateHash(state)).not.toBe(before);
  });

  it('ignores non-authoritative fields (timestamps, denormalised cash)', () => {
    const state = tinyState();
    const before = stateHash(state);
    state.residents.get(1)!.health.lastCheckDay = 999;
    expect(stateHash(state)).toBe(before);
  });

  it('produces a stable snapshot for the same state', () => {
    const a = tinyState();
    const b = tinyState();
    expect(stateSnapshot(a)).toEqual(stateSnapshot(b));
    expect(sha256('abc')).toHaveLength(64);
  });
});

describe('turn context accounting', () => {
  it('records two ledger rows per transfer and conserves money', () => {
    const state = tinyState();
    const ctx = createTurnContext({ state, scenario, day: 1 });
    state.accounts.set('treasury:0', { ownerType: 'treasury', ownerId: 0, balanceCents: 1_000 });
    ctx.transfer({ from: { type: 'treasury', id: 0 }, to: { type: 'resident', id: 1 }, cents: 250, reason: 'test' });

    expect(state.accounts.get('treasury:0')?.balanceCents).toBe(750);
    expect(state.accounts.get('resident:1')?.balanceCents).toBe(250);
    expect(ctx.ledger).toHaveLength(2);
    expect(ctx.ledger[0]?.deltaCents).toBe(-250);
    expect(ctx.ledger[1]?.deltaCents).toBe(250);
  });

  it('refuses to overdraw an internal account but allows the external settlement position', () => {
    const state = tinyState();
    const ctx = createTurnContext({ state, scenario, day: 1 });
    expect(() =>
      ctx.transfer({ from: { type: 'resident', id: 1 }, to: { type: 'treasury', id: 0 }, cents: 10, reason: 'x' }),
    ).toThrow(/Insufficient funds/);

    ctx.transfer({ from: { type: 'external', id: 0 }, to: { type: 'resident', id: 1 }, cents: 500, reason: 'export' });
    expect(state.accounts.get('external:0')?.balanceCents).toBe(-500);
  });

  it('records goods flows and rejects negative inventory', () => {
    const state = tinyState();
    const ctx = createTurnContext({ state, scenario, day: 1 });
    ctx.shiftGoods({ owner: { type: 'household', id: 1 }, good: 'bread', delta: 4, reason: 'test' });
    expect(state.inventories.get('household:1:bread')).toBe(4);
    expect(ctx.flows).toHaveLength(1);
    expect(() =>
      ctx.shiftGoods({ owner: { type: 'household', id: 1 }, good: 'bread', delta: -5, reason: 'test' }),
    ).toThrow(/Insufficient bread/);
  });
});
