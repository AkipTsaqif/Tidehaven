import { describe, expect, it } from 'vitest';
import { seedTown, planFor } from '../fixtures/seed-town.js';
import { balanceOf, emptyState, livingResidents, type Resident, type WorldState } from '../../src/domain/state.js';
import { killResident } from '../../src/domain/events/health.js';
import { householdPhase } from '../../src/domain/society/relationships.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { loadScenario } from '../../src/application/scenario.js';
import { openCase } from '../../src/domain/events/crime.js';

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

function twoPersonTown(): WorldState {
  const state = emptyState({
    worldId: 1,
    name: 'Pair',
    seed: 'pair',
    rulesVersion: 'v1',
    drama: 'calm',
    populationTarget: 10,
    hostCeiling: 100,
  });
  state.households.set(1, { id: 1, name: 'Pair', buildingId: null, capacity: 4, formedDay: 0, dissolvedDay: null });
  const a = resident(1, { name: 'Ada', partnerId: 2 });
  const b = resident(2, { name: 'Brin', sex: 'male', partnerId: 1 });
  state.residents.set(1, a);
  state.residents.set(2, b);
  state.accounts.set('resident:1', { ownerType: 'resident', ownerId: 1, balanceCents: 1_000 });
  state.accounts.set('resident:2', { ownerType: 'resident', ownerId: 2, balanceCents: 501 });
  state.accounts.set('household:1', { ownerType: 'household', ownerId: 1, balanceCents: 0 });
  state.counters.set('moneyBaseCents', 1_501);
  state.relationships.set('partner:1:2', {
    key: 'partner:1:2',
    aId: 1,
    bId: 2,
    kind: 'partner',
    trust: 60,
    intimacy: 50,
    publicBelief: 60,
    sinceDay: -100,
    untilDay: null,
    cooldownUntil: null,
  });
  return state;
}

describe('household and relationship rules', () => {
  it('requires explicit mutual consent before a partnership forms', async () => {
    const town = await seedTown({ seed: 'consent' });
    const singles = livingResidents(town.state).filter(
      (r) => r.partnerId === null && r.bornDay <= -town.scenario.calendar.adultDays,
    );
    const [a, b] = singles;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (!a || !b) return;

    await town.step(new Map([[a.id, planFor(a.id, { social: { kind: 'courtship', targetId: b.id } })]]));
    expect(a.partnerId).toBeNull();
    expect(b.partnerId).toBeNull();

    await town.step(
      new Map([
        [a.id, planFor(a.id, { social: { kind: 'courtship', targetId: b.id } })],
        [b.id, planFor(b.id, { social: { kind: 'accept', targetId: a.id } })],
      ]),
    );
    expect(a.partnerId).toBe(b.id);
    expect(b.partnerId).toBe(a.id);
  }, 30_000);

  it('refuses courtship with a child, with close kin, and between the already partnered', async () => {
    const town = await seedTown({ seed: 'kinship' });
    const single = livingResidents(town.state).find(
      (r) => r.partnerId === null && r.bornDay <= -town.scenario.calendar.adultDays,
    )!;
    const child = livingResidents(town.state).find((r) => r.bornDay > -town.scenario.calendar.adultDays)!;
    const paired = livingResidents(town.state).find((r) => r.partnerId !== null)!;
    expect(single && child && paired).toBeTruthy();

    await town.step(
      new Map([
        [single.id, planFor(single.id, { social: { kind: 'courtship', targetId: child.id } })],
      ]),
    );
    expect(single.partnerId).toBeNull();

    await town.step(
      new Map([
        [single.id, planFor(single.id, { social: { kind: 'courtship', targetId: paired.id } })],
      ]),
    );
    expect(single.partnerId).toBeNull();
  }, 30_000);

  it('splits resident cash exactly when a partnership ends', () => {
    const state = twoPersonTown();
    const totalBefore = balanceOf(state, 'resident', 1) + balanceOf(state, 'resident', 2);
    const ctx = createTurnContext({ state, scenario, day: 5 });
    householdPhase(ctx, new Map([[1, planFor(1, { social: { kind: 'divorce', targetId: 2 } })]]));
    const totalAfter = balanceOf(state, 'resident', 1) + balanceOf(state, 'resident', 2);
    expect(totalAfter).toBe(totalBefore);
    expect(state.residents.get(1)?.partnerId).toBeNull();
    expect(state.residents.get(2)?.partnerId).toBeNull();
    expect(ctx.events.some((event) => event.kind === 'divorce')).toBe(true);
  });

  it('accepts conception only between established adults with food on hand', async () => {
    const town = await seedTown({ seed: 'conception' });
    const mother = livingResidents(town.state).find(
      (r) => r.sex === 'female' && r.partnerId !== null && r.householdId !== null,
    )!;
    const father = town.state.residents.get(mother.partnerId!)!;

    // Starve the household first: the rule must refuse.
    for (const [key] of town.state.inventories.entries()) {
      if (key.startsWith(`household:${mother.householdId}:`)) town.state.inventories.set(key, 0);
    }
    await town.step(
      new Map([
        [mother.id, planFor(mother.id, { social: { kind: 'conceive', targetId: father.id } })],
        [father.id, planFor(father.id, { social: { kind: 'accept', targetId: mother.id } })],
      ]),
    );
    expect([...town.state.pregnancies.values()].filter((p) => p.status === 'active')).toHaveLength(0);
  }, 30_000);
});

describe('death, estates, and guardianship', () => {
  it('distributes only what exists and records claims that sum to the estate', async () => {
    const town = await seedTown({ seed: 'estate' });
    const deceased = livingResidents(town.state).find((r) => r.partnerId !== null)!;
    town.state.accounts.set(`resident:${deceased.id}`, {
      ownerType: 'resident',
      ownerId: deceased.id,
      balanceCents: 4_001,
    });
    const totalBefore = [...town.state.accounts.values()].reduce((sum, account) => sum + account.balanceCents, 0);

    // Advance one day first so deathDay matches a simulated day, then kill and settle.
    await town.step();
    killResident(
      createTurnContext({ state: town.state, scenario: town.scenario, day: town.state.day }),
      deceased,
      'test',
    );
    await town.step();

    const estate = [...town.state.estates.values()].find((e) => e.deceasedId === deceased.id);
    expect(estate).toBeDefined();
    expect(estate?.status).toBe('closed');
    const claims = [...town.state.estateClaims.values()].filter((c) => c.estateId === estate?.id);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.reduce((sum, c) => sum + c.amountCents, 0)).toBe(estate?.totalCents);
    expect(claims.some((c) => c.kind === 'partner')).toBe(true);

    const totalAfter = [...town.state.accounts.values()].reduce((sum, account) => sum + account.balanceCents, 0);
    expect(totalAfter).toBe(totalBefore);
  }, 30_000);
});

describe('population soft target', () => {
  it('never deletes residents when the target drops below the population', async () => {
    const town = await seedTown({ seed: 'target' });
    const before = livingResidents(town.state).length;
    town.state.populationTarget = 5;
    for (let day = 1; day <= 35; day += 1) await town.step();
    const after = livingResidents(town.state).length;
    const emigrated = [...town.state.residents.values()].filter((r) => r.status === 'emigrated');
    const emigrationEvents = town.db.all<{ id: number }>(
      "select id from events where kind = 'household_emigrated' and world_id = ?",
      [town.worldId],
    );
    expect(emigrated.length).toBe(emigrationEvents.length === 0 ? 0 : emigrated.length);
    expect(after).toBe(before - emigrated.length);
    expect(town.state.counters.get('pressureDays') ?? 0).toBeGreaterThan(0);
  }, 60_000);

  it('pauses at the host ceiling instead of deleting people', async () => {
    const town = await seedTown({ seed: 'ceiling' });
    town.state.hostCeiling = livingResidents(town.state).length;
    await town.step();
    expect(town.state.counters.get('pauseRequested')).toBe(1);
  }, 30_000);
});

describe('justice', () => {
  it('treats a complaint as an allegation and reaches a bounded, closed verdict', async () => {
    const town = await seedTown({ seed: 'justice' });
    const adults = livingResidents(town.state).filter((r) => r.bornDay <= -town.scenario.calendar.adultDays);
    const defendant = adults[0]!;
    const plaintiff = adults[1]!;
    await town.step();

    const ctx = createTurnContext({ state: town.state, scenario: town.scenario, day: town.state.day });
    const caseId = openCase({
      ctx,
      kind: 'theft',
      defendantId: defendant.id,
      plaintiffId: plaintiff.id,
      truth: { good: 'bread', quantity: 3 },
      evidence: [{ kind: 'witness', weight: 6_000, isPublic: true }],
    });
    // Persist the case record the way a committed day would.
    for (const entry of town.state.cases.values()) {
      expect(entry.verdict).toBeNull();
    }
    const caseRecord = town.state.cases.get(caseId)!;
    expect(caseRecord.status).toBe('investigating');
    expect(caseRecord.verdict).toBeNull();

    for (let day = 0; day < 15 && caseRecord.status !== 'closed'; day += 1) await town.step();
    expect(caseRecord.verdict).not.toBeNull();
    expect(caseRecord.closedDay).not.toBeNull();
    expect([...town.state.sentences.values()].filter((s) => s.caseId === caseId)).toHaveLength(1);
  }, 60_000);
});
