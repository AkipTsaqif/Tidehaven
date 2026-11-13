import { describe, expect, it } from 'vitest';
import { seedTown, planFor } from '../fixtures/seed-town.js';
import { emptyState, type Business, type Resident, type WorldState } from '../../src/domain/state.js';
import { loadScenario } from '../../src/application/scenario.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { conflictPhase } from '../../src/domain/events/crime.js';
import { householdPhase, kinshipBlocked, pairEligibility } from '../../src/domain/society/relationships.js';
import { minorTrustEscrowId, recordWill, releaseMinorTrust, settleEstate } from '../../src/domain/society/estates.js';
import { justicePhase } from '../../src/domain/events/justice.js';
import { protectivePhase } from '../../src/domain/events/disasters.js';
import { applyDeathLifecycle } from '../../src/domain/society/lifecycle.js';
import { balanceOf } from '../../src/domain/state.js';
import { runProduction } from '../../src/domain/economy/production.js';
import type { ActorPlan } from '../../src/contracts/actions.js';

/** Regression tests for the domain findings F4, F5, F14, F15, F16, F17, F18, F19. */

const scenario = loadScenario(process.cwd());

function resident(id: number, overrides: Partial<Resident> = {}): Resident {
  return {
    id,
    name: `Resident ${id}`,
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
    traits: { diligence: 60, honesty: 60, temper: 30, sociability: 50, ambition: 40 },
    skills: {},
    healthState: 'healthy',
    health: {},
    hungerDays: 0,
    educationDays: 0,
    legacyOf: null,
    emigratedDay: null,
    destination: null,
    rngSalt: id,
    ...overrides,
  };
}

function townState(): WorldState {
  const state = emptyState({
    worldId: 1,
    name: 'Rules',
    seed: 'rules',
    rulesVersion: 'v1',
    drama: 'calm',
    populationTarget: 20,
    hostCeiling: 100,
  });
  state.households.set(1, { id: 1, name: 'One', buildingId: 1, capacity: 6, formedDay: 0, dissolvedDay: null });
  state.households.set(2, { id: 2, name: 'Two', buildingId: 2, capacity: 6, formedDay: 0, dissolvedDay: null });
  state.buildings.set(1, { id: 1, name: 'Home One', kind: 'home', capacity: 6, conditionBps: 10_000, builtDay: 0, destroyedDay: null, privateFlag: true });
  state.buildings.set(2, { id: 2, name: 'Home Two', kind: 'home', capacity: 6, conditionBps: 10_000, builtDay: 0, destroyedDay: null, privateFlag: true });
  state.accounts.set('household:1', { ownerType: 'household', ownerId: 1, balanceCents: 0 });
  state.accounts.set('household:2', { ownerType: 'household', ownerId: 2, balanceCents: 0 });
  return state;
}

describe('production prorates partial labour (F4)', () => {
  it('turns an elder’s 50 labour points into four grain instead of zero', () => {
    const state = townState();
    state.buildings.set(10, {
      id: 10,
      name: 'Farm',
      kind: 'farm',
      capacity: 4,
      conditionBps: 10_000,
      builtDay: 0,
      destroyedDay: null,
      privateFlag: false,
    });
    const business: Business = {
      id: 1,
      name: 'Farm',
      kind: 'farm',
      ownerType: 'town',
      ownerId: null,
      managerId: null,
      buildingId: 10,
      cashCents: 5_000,
      openedDay: 0,
      closedDay: null,
      status: 'open',
      settings: {},
    };
    state.businesses.set(1, business);
    state.accounts.set('business:1', { ownerType: 'business', ownerId: 1, balanceCents: 5_000 });
    state.accounts.set('treasury:0', { ownerType: 'treasury', ownerId: 0, balanceCents: 10_000 });
    state.inventories.set('business:1:tools', 4);
    const elder = resident(1, { bornDay: -scenario.calendar.elderDays - 10 });
    state.residents.set(1, elder);
    state.contracts.set(1, {
      id: 1,
      kind: 'employment',
      aId: 1,
      bId: 1,
      businessId: 1,
      terms: { wageClass: 'unskilled', wageCents: 400 },
      startDay: 0,
      endDay: null,
      status: 'active',
    });
    const ctx = createTurnContext({ state, scenario, day: 1 });
    const outcome = runProduction(ctx, new Map([[1, planFor(1, { primary: { kind: 'work' } })]]));
    const report = outcome.reports.find((candidate) => candidate.businessId === 1)!;
    expect(report.appliedLabour).toBe(50);
    expect(report.produced.grain).toBe(4);
  });
});

describe('crime requires real access and a real role (F5)', () => {
  it('refuses theft from an unrelated housed household', () => {
    const state = townState();
    const thief = resident(1, { householdId: 1, traits: { honesty: 5, diligence: 50, temper: 30, sociability: 50, ambition: 50 } });
    const victim = resident(2, { householdId: 2 });
    state.residents.set(1, thief);
    state.residents.set(2, victim);
    state.inventories.set('household:2:bread', 20);
    const ctx = createTurnContext({ state, scenario, day: 1 });
    const plan: ActorPlan = planFor(1, { intents: [{ kind: 'theft', targetId: 2, good: 'bread', quantity: 3 }] });
    const report = conflictPhase(ctx, new Map([[1, plan]]));
    expect(report.thefts).toBe(0);
    expect(state.inventories.get('household:2:bread')).toBe(20);
    expect(state.inventories.get('resident:1:bread') ?? 0).toBe(0);
  });

  it('allows theft inside a shared household and transfers the real asset', () => {
    const state = townState();
    const thief = resident(1, { householdId: 1, traits: { honesty: 5, diligence: 50, temper: 30, sociability: 50, ambition: 50 } });
    const victim = resident(2, { householdId: 1 });
    state.residents.set(1, thief);
    state.residents.set(2, victim);
    state.inventories.set('household:1:bread', 40);
    // The contest is stochastic; retry across days (each day gets its own seeded stream) rather than
    // asserting a single lucky roll.
    let succeeded = false;
    for (let day = 1; day <= 40 && !succeeded; day += 1) {
      const ctx = createTurnContext({ state, scenario, day });
      const plan: ActorPlan = planFor(1, { intents: [{ kind: 'theft', targetId: 2, good: 'bread', quantity: 5 }] });
      succeeded = conflictPhase(ctx, new Map([[1, plan]])).thefts === 1;
    }
    expect(succeeded).toBe(true);
    const householdStock = state.inventories.get('household:1:bread') ?? 0;
    const thiefStock = state.inventories.get('resident:1:bread') ?? 0;
    expect(householdStock + thiefStock).toBe(40);
    expect(thiefStock).toBeGreaterThan(0);
  });

  it('refuses sabotage from an unrelated resident without touching the stock', () => {
    const state = townState();
    const saboteur = resident(1, { householdId: 1, traits: { honesty: 60, diligence: 50, temper: 80, sociability: 50, ambition: 50 } });
    state.residents.set(1, saboteur);
    const business: Business = {
      id: 7,
      name: 'Bakery',
      kind: 'bakery',
      ownerType: 'town',
      ownerId: null,
      managerId: null,
      buildingId: 2,
      cashCents: 1_000,
      openedDay: 0,
      closedDay: null,
      status: 'open',
      settings: {},
    };
    state.businesses.set(7, business);
    state.inventories.set('business:7:grain', 100);
    const ctx = createTurnContext({ state, scenario, day: 2 });
    const plan: ActorPlan = planFor(1, { intents: [{ kind: 'sabotage', businessId: 7 }] });
    for (let day = 1; day <= 10; day += 1) {
      conflictPhase(createTurnContext({ state, scenario, day }), new Map([[1, plan]]));
    }
    expect(state.inventories.get('business:7:grain')).toBe(100);
    void ctx;
  });

  it('allows sabotage by an employee of the business', () => {
    const state = townState();
    const sabotagingWorker = resident(1, { householdId: 1, traits: { honesty: 60, diligence: 50, temper: 80, sociability: 50, ambition: 50 } });
    state.residents.set(1, sabotagingWorker);
    const business: Business = {
      id: 7,
      name: 'Bakery',
      kind: 'bakery',
      ownerType: 'town',
      ownerId: null,
      managerId: null,
      buildingId: 2,
      cashCents: 1_000,
      openedDay: 0,
      closedDay: null,
      status: 'open',
      settings: {},
    };
    state.businesses.set(7, business);
    state.inventories.set('business:7:grain', 100);
    state.contracts.set(1, {
      id: 1,
      kind: 'employment',
      aId: 1,
      bId: 7,
      businessId: 7,
      terms: { wageClass: 'skilled', wageCents: 500 },
      startDay: 0,
      endDay: null,
      status: 'active',
    });
    let lost = 0;
    for (let day = 1; day <= 40 && lost === 0; day += 1) {
      const before = state.inventories.get('business:7:grain') ?? 0;
      const plan: ActorPlan = planFor(1, { intents: [{ kind: 'sabotage', businessId: 7 }] });
      conflictPhase(createTurnContext({ state, scenario, day }), new Map([[1, plan]]));
      lost = before - (state.inventories.get('business:7:grain') ?? 0);
    }
    expect(lost).toBeGreaterThan(0);
  });

  it('refuses fraud without a role or an identified flow', () => {
    const state = townState();
    const actor = resident(1, { householdId: 1 });
    const target = resident(2, { householdId: 2 });
    state.residents.set(1, actor);
    state.residents.set(2, target);
    state.accounts.set('resident:2', { ownerType: 'resident', ownerId: 2, balanceCents: 50_000 });
    const ctx = createTurnContext({ state, scenario, day: 1 });
    const plan: ActorPlan = planFor(1, { intents: [{ kind: 'fraud', targetId: 2, amountCents: 1_000 }] });
    conflictPhase(ctx, new Map([[1, plan]]));
    expect(balanceOf(state, 'resident', 2)).toBe(50_000);
    expect(balanceOf(state, 'resident', 1)).toBe(0);
  });
});

describe('kinship depth and stale proposals (F14)', () => {
  it('blocks grandparent/grandchild and avuncular pairs', () => {
    const state = townState();
    // 1 = grandparent, 2 = parent, 3 = grandchild; 4 = sibling of the parent (avuncular).
    state.residents.set(1, resident(1, { bornDay: -30_000 }));
    state.residents.set(2, resident(2, { motherId: 1, bornDay: -20_000 }));
    state.residents.set(3, resident(3, { motherId: 2, bornDay: -8_000 }));
    state.residents.set(4, resident(4, { motherId: 1, bornDay: -18_000 }));
    const ctx = createTurnContext({ state, scenario, day: 1 });
    expect(kinshipBlocked(ctx, state.residents.get(1)!, state.residents.get(3)!)).toBe(true);
    expect(kinshipBlocked(ctx, state.residents.get(3)!, state.residents.get(1)!)).toBe(true);
    expect(kinshipBlocked(ctx, state.residents.get(4)!, state.residents.get(3)!)).toBe(true);
    expect(kinshipBlocked(ctx, state.residents.get(2)!, state.residents.get(4)!)).toBe(true);
  });

  it('refuses to accept a proposal whose proposer has died', () => {
    const state = townState();
    const proposer = resident(1, { status: 'dead', deathDay: 1 });
    const accepter = resident(2);
    state.residents.set(1, proposer);
    state.residents.set(2, accepter);
    state.proposals.set(1, {
      id: 1,
      day: 1,
      fromId: 1,
      toId: 2,
      kind: 'courtship',
      status: 'pending',
      expiresDay: 5,
      detail: {},
    });
    const ctx = createTurnContext({ state, scenario, day: 2 });
    householdPhase(ctx, new Map([[2, planFor(2, { social: { kind: 'accept', targetId: 1 } })]]));
    expect(accepter.partnerId).toBeNull();
    expect(state.proposals.get(1)?.status).toBe('expired');
  });

  it('reports the same eligibility reason for proposal and acceptance', () => {
    const state = townState();
    state.residents.set(1, resident(1, { bornDay: -8_000 }));
    state.residents.set(2, resident(2, { bornDay: -8_000, partnerId: 3 }));
    state.residents.set(3, resident(3, { bornDay: -8_000, partnerId: 2 }));
    const ctx = createTurnContext({ state, scenario, day: 1 });
    expect(pairEligibility(ctx, 'courtship', state.residents.get(1)!, state.residents.get(2)!)).toBe(
      'target_already_partnered',
    );
  });
});

function estateTown(): { state: WorldState } {
  const state = townState();
  const deceased = resident(1, { partnerId: 2 });
  const partner = resident(2, { partnerId: 1, sex: 'male' });
  state.residents.set(1, deceased);
  state.residents.set(2, partner);
  state.accounts.set('resident:1', { ownerType: 'resident', ownerId: 1, balanceCents: 10_000 });
  state.accounts.set('resident:2', { ownerType: 'resident', ownerId: 2, balanceCents: 1_000 });
  state.counters.set('moneyBaseCents', 11_000);
  return { state };
}

describe('estate precedence, wills, minor trusts, disputes (F15)', () => {
  it('pays recorded obligations before distributing to heirs', () => {
    const { state } = estateTown();
    const ctx = createTurnContext({ state, scenario, day: 5 });
    state.sentences.set(1, {
      id: 1,
      caseId: 9,
      kind: 'fine',
      amountCents: 4_000,
      days: 0,
      startDay: 1,
      endDay: 1,
      status: 'active',
      releasedDay: null,
    });
    state.cases.set(9, {
      id: 9,
      kind: 'theft',
      defendantId: 1,
      plaintiffId: null,
      openedDay: 1,
      status: 'sentenced',
      investigationDays: 0,
      prosecutionBps: 6_000,
      defenceBps: 1_000,
      verdict: 'fine',
      closedDay: 1,
      disputedEstateId: null,
      truth: {},
    });
    const estateId = settleEstate(ctx, 1)!;
    const claims = [...state.estateClaims.values()].filter((c) => c.estateId === estateId);
    const creditor = claims.find((c) => c.kind === 'creditor');
    expect(creditor).toBeDefined();
    expect(creditor?.amountCents).toBe(4_000);
    expect(claims.reduce((sum, c) => sum + c.amountCents, 0)).toBe(10_000);
  });

  it('honours a recorded will and keeps a minor heir’s share out of the guardian’s hands', () => {
    const { state, deceased } = estateTown();
    const minorId = 3;
    state.residents.set(
      minorId,
      resident(minorId, { bornDay: -100, motherId: 1, fatherId: 2, guardianId: 2, householdId: 1 }),
    );
    const ctx = createTurnContext({ state, scenario, day: 5 });
    // Half to the surviving partner, half to the minor: nobody is disinherited, so no dispute.
    expect(recordWill(ctx, 1, { '2': 5_000, [String(minorId)]: 5_000 }).ok).toBe(true);
    const estateId = settleEstate(ctx, 1)!;
    const estate = state.estates.get(estateId)!;
    expect(estate.status).toBe('closed');
    expect(balanceOf(state, 'escrow', minorTrustEscrowId(minorId))).toBe(5_000);
    // The guardian (the partner) received only their own share, never the minor's trust.
    expect(balanceOf(state, 'resident', 2)).toBe(6_000);
    expect(balanceOf(state, 'resident', minorId)).toBe(0);
    void deceased;
  });

  it('escrows a disputed will for the court instead of silently overriding a natural heir', () => {
    const { state } = estateTown();
    state.residents.set(3, resident(3, { bornDay: -100, motherId: 1, fatherId: 2, guardianId: 2 }));
    const ctx = createTurnContext({ state, scenario, day: 5 });
    expect(recordWill(ctx, 1, { '3': 6_000 }).ok).toBe(true);
    const estateId = settleEstate(ctx, 1)!;
    const estate = state.estates.get(estateId)!;
    expect(estate.status).toBe('disputed');
    expect(estate.disputeDeadlineDay).toBeGreaterThan(5);
    expect(estate.escrowCents).toBe(10_000);
    expect([...state.cases.values()].some((c) => c.kind === 'estate_dispute')).toBe(true);

    // The court rules at the deadline and the escrow settles.
    for (let day = 6; day <= (estate.disputeDeadlineDay ?? 20); day += 1) {
      ctx.setPhase('justice');
      justicePhase(createTurnContext({ state, scenario, day }));
      if (estate.status === 'closed') break;
    }
    expect(estate.status).toBe('closed');
    expect(estate.escrowCents).toBe(0);
    const total = [...state.accounts.values()].reduce((sum, account) => sum + account.balanceCents, 0);
    expect(total).toBe(11_000);
  });

  it('routes a disputed award to a minor heir’s protected trust, not a spendable account', () => {
    const { state } = estateTown();
    const minorId = 3;
    state.residents.set(minorId, resident(minorId, { bornDay: -100, motherId: 1, fatherId: 2, guardianId: 2 }));
    const ctx = createTurnContext({ state, scenario, day: 5 });
    // The minor is the only named heir; the partner is disinherited, so the estate is disputed.
    expect(recordWill(ctx, 1, { [String(minorId)]: 10_000 }).ok).toBe(true);
    const estateId = settleEstate(ctx, 1)!;
    const estate = state.estates.get(estateId)!;
    expect(estate.status).toBe('disputed');

    for (let day = 6; day <= (estate.disputeDeadlineDay ?? 20) + 2; day += 1) {
      justicePhase(createTurnContext({ state, scenario, day }));
      if (estate.status === 'closed') break;
    }
    expect(estate.status).toBe('closed');
    // Protected ownership survives the court: the money is in the minor's trust, not their account.
    expect(balanceOf(state, 'escrow', minorTrustEscrowId(minorId))).toBeGreaterThan(0);
    expect(balanceOf(state, 'resident', minorId)).toBe(0);
  });

  it('releases a protected minor trust exactly at adulthood', () => {
    const { state } = estateTown();
    const minorId = 3;
    const bornDay = 10 - scenario.calendar.adultDays + 1;
    state.residents.set(minorId, resident(minorId, { bornDay, motherId: 1, fatherId: 2, guardianId: 2 }));
    const ctx = createTurnContext({ state, scenario, day: 5 });
    expect(recordWill(ctx, 1, { [String(minorId)]: 10_000, '2': 0 }).ok).toBe(true);
    settleEstate(ctx, 1);
    // Force the funds into the trust directly (dispute resolution is covered separately).
    state.accounts.set(`escrow:${minorTrustEscrowId(minorId)}`, {
      ownerType: 'escrow',
      ownerId: minorTrustEscrowId(minorId),
      balanceCents: 4_000,
    });
    state.counters.set(`minorTrust:${minorId}`, 5);
    const before = balanceOf(state, 'resident', minorId);
    const released = releaseMinorTrust(createTurnContext({ state, scenario, day: 5 }), minorId);
    expect(released).toBe(4_000);
    expect(balanceOf(state, 'resident', minorId)).toBe(before + 4_000);
  });
});

describe('departure lifecycle (F16)', () => {
  it('ends employment and offices, clears the partnership, and settles resident-owned assets on death', () => {
    const { state } = estateTown();
    // A real fixture: an employment contract, an office, a resident-owned business with stock, and
    // resident-level goods that must not stay attached to the deceased.
    state.buildings.set(11, {
      id: 11,
      name: 'Bakery',
      kind: 'bakery',
      capacity: 4,
      conditionBps: 10_000,
      builtDay: 0,
      destroyedDay: null,
      privateFlag: false,
    });
    state.businesses.set(1, {
      id: 1,
      name: 'Ada’s Bakery',
      kind: 'bakery',
      ownerType: 'resident',
      ownerId: 1,
      managerId: 1,
      buildingId: 11,
      cashCents: 2_000,
      openedDay: 0,
      closedDay: null,
      status: 'open',
      settings: {},
    });
    state.contracts.set(1, {
      id: 1,
      kind: 'employment',
      aId: 1,
      bId: 1,
      businessId: 1,
      terms: { wageClass: 'skilled', wageCents: 500 },
      startDay: 0,
      endDay: null,
      status: 'active',
    });
    state.offices.set('magistrate:0', { key: 'magistrate:0', office: 'magistrate', seat: 0, holderId: 1, sinceDay: 0, untilDay: null });
    state.inventories.set('resident:1:bread', 6);
    state.residents.set(1, { ...state.residents.get(1)!, status: 'dead', deathDay: 5 });

    const ctx = createTurnContext({ state, scenario, day: 5 });
    applyDeathLifecycle(ctx, state.residents.get(1)!);

    expect(state.contracts.get(1)?.status).toBe('ended');
    expect(state.contracts.get(1)?.endDay).toBe(5);
    expect(state.offices.get('magistrate:0')?.holderId).toBeNull();
    expect(state.offices.get('magistrate:0')?.untilDay).toBe(5);
    expect(state.residents.get(2)?.partnerId).toBeNull();
    // The resident-owned business passes to the town and the resident stock moves to the household.
    expect(state.businesses.get(1)?.ownerType).toBe('town');
    expect(state.businesses.get(1)?.ownerId).toBeNull();
    expect(state.inventories.get('resident:1:bread') ?? 0).toBe(0);
    expect(state.inventories.get('household:1:bread')).toBe(6);

    // Idempotent: a second call does nothing and emits no duplicate widowhood event.
    applyDeathLifecycle(ctx, state.residents.get(1)!);
    expect(ctx.events.filter((event) => event.kind === 'widowed')).toHaveLength(1);
  });
});

describe('a served sentence is released exactly once (F17)', () => {
  it('emits one release event across several days and a restart', async () => {
    const town = await seedTown({ seed: 'release-restart' });
    const defendant = [...town.state.residents.values()].find((r) => r.status === 'living')!;
    const day = town.state.day + 1;
    town.state.cases.set(1, {
      id: 1,
      kind: 'theft',
      defendantId: defendant.id,
      plaintiffId: null,
      openedDay: 1,
      status: 'sentenced',
      investigationDays: 0,
      prosecutionBps: 5_000,
      defenceBps: 1_000,
      verdict: 'imprisonment',
      closedDay: 1,
      disputedEstateId: null,
      truth: {},
    });
    town.state.sentences.set(1, {
      id: 1,
      caseId: 1,
      kind: 'imprisonment',
      amountCents: 0,
      days: 10,
      startDay: day - 5,
      endDay: day - 1,
      status: 'active',
      releasedDay: null,
    });
    // Persist the fixture through a committed day, then advance several days through the real pipeline.
    await town.step();
    for (let i = 0; i < 4; i += 1) await town.step();

    const releases = town.db.all<{ id: number }>(
      "select id from events where kind = 'prisoner_released' and world_id = ?",
      [town.worldId],
    );
    expect(releases).toHaveLength(1);
    expect(town.state.sentences.get(1)?.releasedDay).not.toBeNull();

    // A restart (reload from SQLite) must not re-emit the release on later days.
    const { readWorld, loadState } = await import('../../src/storage/repositories.js');
    const reloaded = loadState(town.db, readWorld(town.db, town.worldId)!);
    const { justicePhase } = await import('../../src/domain/events/justice.js');
    for (let extra = 1; extra <= 3; extra += 1) {
      justicePhase(createTurnContext({ state: reloaded, scenario: town.scenario, day: reloaded.day + extra }));
    }
    expect(reloaded.sentences.get(1)?.releasedDay).toBe(town.state.sentences.get(1)?.releasedDay);
    expect(
      town.db.all("select id from events where kind = 'prisoner_released' and world_id = ?", [town.worldId]),
    ).toHaveLength(1);
    town.db.close();
  }, 30_000);
});

describe('model-requested founding and migration execute (F18)', () => {
  it('founds a business and lets a resident leave through ordinary plans', async () => {
    const town = await seedTown({ seed: 'primary-actions' });
    const day = town.state.day + 1;
    const founder = [...town.state.residents.values()].find(
      (r) => r.status === 'living' && r.bornDay <= day - town.scenario.calendar.adultDays && r.householdId !== null,
    )!;
    town.state.accounts.set(`resident:${founder.id}`, {
      ownerType: 'resident',
      ownerId: founder.id,
      balanceCents: 20_000,
    });
    // A vacant, non-private premises (the seeded town occupies every one it has).
    town.state.buildings.set(999, {
      id: 999,
      name: 'Empty Workshop',
      kind: 'workshop',
      capacity: 4,
      conditionBps: 10_000,
      builtDay: 0,
      destroyedDay: null,
      privateFlag: false,
    });
    const occupied = new Set(
      [...town.state.businesses.values()].filter((b) => b.status === 'open').map((b) => b.buildingId),
    );
    const vacant = [...town.state.buildings.values()].find(
      (b) => b.destroyedDay === null && !b.privateFlag && !occupied.has(b.id),
    );
    expect(vacant).toBeDefined();
    const plans = new Map<number, ActorPlan>([
      [founder.id, planFor(founder.id, { primary: { kind: 'found_business', businessId: vacant!.id, detail: 'shop' } })],
    ]);
    const { runDay } = await import('../../src/domain/turn-engine.js');
    const result = runDay({ state: town.state, scenario: town.scenario, day, plans });
    expect(result.reports.primary.founded).toBe(1);
    const founded = [...town.state.businesses.values()].find((b) => b.buildingId === vacant!.id && b.ownerId === founder.id);
    expect(founded).toBeDefined();
  }, 30_000);

  it('marks a migrating resident as emigrated and closes their obligations', async () => {
    const town = await seedTown({ seed: 'primary-migrate' });
    const day = town.state.day + 1;
    const mover = [...town.state.residents.values()].find(
      (r) => r.status === 'living' && r.bornDay <= day - town.scenario.calendar.adultDays,
    )!;
    const plans = new Map<number, ActorPlan>([[mover.id, planFor(mover.id, { primary: { kind: 'migrate' } })]]);
    const { runDay } = await import('../../src/domain/turn-engine.js');
    const result = runDay({ state: town.state, scenario: town.scenario, day, plans });
    expect(result.reports.primary.departed).toBe(1);
    expect(mover.status).toBe('emigrated');
    expect(
      [...town.state.contracts.values()].filter((c) => c.aId === mover.id && c.status === 'active'),
    ).toHaveLength(0);
  }, 30_000);
});

describe('disaster recovery is resource-constrained (F19/R4)', () => {
  function disasterTown(): void {
    return;
  }

  it('does not repair without materials and funds', () => {
    const state = townState();
    state.buildings.set(10, {
      id: 10,
      name: 'Bakery',
      kind: 'bakery',
      capacity: 4,
      conditionBps: 5_000,
      builtDay: 0,
      destroyedDay: null,
      privateFlag: false,
    });
    state.disasters.set(1, {
      id: 1,
      kind: 'storm',
      day: 1,
      severity: 2,
      buildingId: 10,
      stage: 'rebuilding',
      damage: {},
      closedDay: null,
    });
    state.accounts.set('treasury:0', { ownerType: 'treasury', ownerId: 0, balanceCents: 5_000 });
    protectivePhase(createTurnContext({ state, scenario, day: 2 }), { occurred: [], opportunities: 0 });
    expect(state.buildings.get(10)?.conditionBps).toBe(5_000);

    state.accounts.set('escrow:2000001', { ownerType: 'escrow', ownerId: 2_000_001, balanceCents: 1_000 });
    state.inventories.set('treasury:0:timber', 4);
    protectivePhase(createTurnContext({ state, scenario, day: 3 }), { occurred: [], opportunities: 0 });
    expect(state.buildings.get(10)?.conditionBps).toBeGreaterThan(5_000);
    void disasterTown;
  });

  it('closes the disaster and refunds unspent relief to the treasury', () => {
    const state = townState();
    state.buildings.set(10, {
      id: 10,
      name: 'Bakery',
      kind: 'bakery',
      capacity: 4,
      conditionBps: 8_500,
      builtDay: 0,
      destroyedDay: null,
      privateFlag: false,
    });
    state.disasters.set(1, {
      id: 1,
      kind: 'storm',
      day: 1,
      severity: 2,
      buildingId: 10,
      stage: 'rebuilding',
      damage: {},
      closedDay: null,
    });
    state.accounts.set('treasury:0', { ownerType: 'treasury', ownerId: 0, balanceCents: 5_000 });
    state.accounts.set('escrow:2000001', { ownerType: 'escrow', ownerId: 2_000_001, balanceCents: 1_000 });
    state.inventories.set('treasury:0:timber', 4);
    const treasuryBefore = balanceOf(state, 'treasury', 0);
    protectivePhase(createTurnContext({ state, scenario, day: 3 }), { occurred: [], opportunities: 0 });

    const disaster = state.disasters.get(1)!;
    expect(disaster.stage).toBe('closed');
    expect(disaster.closedDay).toBe(3);
    expect(balanceOf(state, 'escrow', 2_000_001)).toBe(0);
    // Repair labour is paid into the treasury, and the unspent relief is refunded with it.
    expect(balanceOf(state, 'treasury', 0)).toBeGreaterThan(treasuryBefore);
  });

  it('compensates a disaster injury once, from its own disaster only', () => {
    const state = townState();
    state.residents.set(1, resident(1));
    state.buildings.set(10, {
      id: 10,
      name: 'Bakery',
      kind: 'bakery',
      capacity: 4,
      conditionBps: 9_500,
      builtDay: 0,
      destroyedDay: null,
      privateFlag: false,
    });
    // One unresolved injury, causally attributed to storm 1 (the first disaster).
    state.injuries.set(1, {
      id: 1,
      residentId: 1,
      kind: 'storm',
      severity: 2,
      sinceDay: 0,
      untilDay: 50,
      disability: 0,
      resolvedDay: null,
    });
    state.counters.set('injuryDisaster:1', 1);
    for (const id of [1, 2]) {
      state.disasters.set(id, {
        id,
        kind: 'storm',
        day: 1,
        severity: 2,
        buildingId: 10,
        stage: 'relief',
        damage: {},
        closedDay: null,
      });
      state.accounts.set(`escrow:${2_000_000 + id}`, {
        ownerType: 'escrow',
        ownerId: 2_000_000 + id,
        balanceCents: 500,
      });
    }
    const before = balanceOf(state, 'resident', 1);
    protectivePhase(createTurnContext({ state, scenario, day: 2 }), { occurred: [], opportunities: 0 });
    const paid = balanceOf(state, 'resident', 1) - before;
    expect(paid).toBeGreaterThan(0);
    // The second storm did not pay the same injury again.
    expect(balanceOf(state, 'escrow', 2_000_002)).toBe(500);
    protectivePhase(createTurnContext({ state, scenario, day: 3 }), { occurred: [], opportunities: 0 });
    expect(balanceOf(state, 'resident', 1) - before).toBe(paid);
  });
});
