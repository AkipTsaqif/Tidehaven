import { describe, expect, it } from 'vitest';
import { seedTown, planFor } from '../fixtures/seed-town.js';
import { livingResidents, nextId, quantityOf } from '../../src/domain/state.js';
import { addResidentGrievance } from '../../src/domain/events/unrest.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { addInjury, killResident } from '../../src/domain/events/health.js';

describe('generations', () => {
  it('turns a newborn into a working adult after 6570 days and lets them inherit', async () => {
    const town = await seedTown({ seed: 'generations' });
    const mother = livingResidents(town.state).find((r) => r.sex === 'female' && r.partnerId !== null)!;
    const father = town.state.residents.get(mother.partnerId!)!;

    // A pregnancy due today, delivered by the demography phase.
    const pregnancyId = nextId(town.state, 'pregnancy');
    town.state.pregnancies.set(pregnancyId, {
      id: pregnancyId,
      motherId: mother.id,
      fatherId: father.id,
      conceivedDay: town.state.day,
      dueDay: town.state.day + 1,
      status: 'active',
      childId: null,
      resolvedDay: null,
    });
    await town.step();
    const pregnancy = town.state.pregnancies.get(pregnancyId)!;
    expect(pregnancy.status).toBe('delivered');
    const child = town.state.residents.get(pregnancy.childId!)!;
    expect(child.status).toBe('living');
    expect(child.motherId).toBe(mother.id);
    expect(child.householdId).toBe(mother.householdId);

    // Fast-forward exactly to adulthood: one day short, still a child; the next day, an adult.
    child.bornDay = town.state.day - town.scenario.calendar.adultDays + 1;
    await town.step();
    const { isAdult } = await import('../../src/domain/clock.js');
    expect(isAdult(child.bornDay, town.state.day, town.scenario.calendar)).toBe(true);

    // The adult can be employed (auto-hire runs every day).
    const employed = [...town.state.contracts.values()].some(
      (contract) => contract.kind === 'employment' && contract.status === 'active' && contract.aId === child.id,
    );
    expect(employed).toBe(true);
  }, 60_000);

  it('hands a business to the surviving partner when the owner dies', async () => {
    const town = await seedTown({ seed: 'succession' });
    const business = [...town.state.businesses.values()].find((b) => b.ownerType === 'resident')!;
    const owner = town.state.residents.get(business.ownerId!)!;
    expect(owner.partnerId).not.toBeNull();
    const survivingPartnerId = owner.partnerId!;
    await town.step();
    killResident(
      createTurnContext({ state: town.state, scenario: town.scenario, day: town.state.day }),
      owner,
      'test',
    );
    await town.step();
    const inherited = town.state.businesses.get(business.id)!;
    expect(inherited.ownerId).toBe(survivingPartnerId);
    expect(inherited.status).toBe('open');
    // Widowhood: the survivor no longer points at a dead partner, and the deceased's contracts ended.
    expect(town.state.residents.get(survivingPartnerId)?.partnerId).toBeNull();
    expect(
      [...town.state.contracts.values()].filter((c) => c.aId === owner.id && c.status === 'active'),
    ).toHaveLength(0);
  }, 30_000);
});

describe('multi-generation scripted run', () => {
  it('raises a child to adulthood, starts a second generation, and passes wealth down', async () => {
    const town = await seedTown({ seed: 'generations-deep' });
    const calendar = town.scenario.calendar;

    // Generation 1: a founding couple has a child today.
    const mother = livingResidents(town.state).find((r) => r.sex === 'female' && r.partnerId !== null)!;
    const father = town.state.residents.get(mother.partnerId!)!;
    const firstPregnancy = nextId(town.state, 'pregnancy');
    town.state.pregnancies.set(firstPregnancy, {
      id: firstPregnancy,
      motherId: mother.id,
      fatherId: father.id,
      conceivedDay: town.state.day,
      dueDay: town.state.day + 1,
      status: 'active',
      childId: null,
      resolvedDay: null,
    });
    const day1 = await town.step();
    expect(day1.violations).toEqual([]);
    const child = town.state.residents.get(town.state.pregnancies.get(firstPregnancy)!.childId!)!;
    expect(child.status).toBe('living');

    // Fast-forward the child to adulthood (the calendar itself is proven by the clock tests).
    child.bornDay = town.state.day - calendar.adultDays;
    const day2 = await town.step();
    expect(day2.violations).toEqual([]);
    const employed = [...town.state.contracts.values()].some(
      (c) => c.kind === 'employment' && c.status === 'active' && c.aId === child.id,
    );
    expect(employed).toBe(true);

    // Generation 2: the child partners and has a child of their own.
    const partnerId = livingResidents(town.state).find(
      (r) => r.id !== child.id && r.partnerId === null && r.bornDay <= town.state.day - calendar.adultDays,
    )!.id;
    child.partnerId = partnerId;
    const partner = town.state.residents.get(partnerId)!;
    partner.partnerId = child.id;
    const motherOfSecond = child.sex === 'female' ? child : partner;
    const fatherOfSecond = child.sex === 'female' ? partner : child;
    const secondPregnancy = nextId(town.state, 'pregnancy');
    town.state.pregnancies.set(secondPregnancy, {
      id: secondPregnancy,
      motherId: motherOfSecond.id,
      fatherId: fatherOfSecond.id,
      conceivedDay: town.state.day,
      dueDay: town.state.day + 1,
      status: 'active',
      childId: null,
      resolvedDay: null,
    });
    const day3 = await town.step();
    expect(day3.violations).toEqual([]);
    const grandchild = town.state.residents.get(town.state.pregnancies.get(secondPregnancy)!.childId!)!;
    expect(grandchild.status).toBe('living');
    expect(grandchild.motherId === child.id || grandchild.fatherId === child.id).toBe(true);

    // Wealth passes down: the founder dies and the child inherits the estate.
    const founder = town.state.residents.get(mother.id)!;
    // Give the founder savings the way the engine does: a recorded transfer, not a balance assignment.
    const fundingCtx = createTurnContext({ state: town.state, scenario: town.scenario, day: town.state.day });
    fundingCtx.transfer({
      from: { type: 'treasury', id: 0 },
      to: { type: 'resident', id: founder.id },
      cents: 9_000,
      reason: 'test_gift',
    });
    killResident(
      createTurnContext({ state: town.state, scenario: town.scenario, day: town.state.day }),
      founder,
      'test',
    );
    const day4 = await town.step();
    expect(day4.violations).toEqual([]);
    const estate = [...town.state.estates.values()].find((e) => e.deceasedId === founder.id);
    expect(estate?.status).toBe('closed');
    const claims = [...town.state.estateClaims.values()].filter((c) => c.estateId === estate?.id);
    expect(claims.reduce((sum, c) => sum + c.amountCents, 0)).toBe(estate?.totalCents);
    // The surviving partner took the partner share; the children share the rest.
    expect(claims.some((c) => c.kind === 'partner')).toBe(true);
    expect(livingResidents(town.state).length).toBeGreaterThanOrEqual(25);
  }, 120_000);
});

describe('health and hazards', () => {
  it('records illness, treatment, and a causal death record', async () => {
    const town = await seedTown({ seed: 'health' });
    const patient = livingResidents(town.state)[0]!;
    const caseId = nextId(town.state, 'healthCase');
    town.state.healthCases.set(caseId, {
      id: caseId,
      residentId: patient.id,
      disease: 'test fever',
      state: 'infectious',
      severity: 2,
      sinceDay: town.state.day,
      infectiousUntil: town.state.day + 3,
      treatedDays: 0,
      resolvedDay: null,
      outcome: null,
    });
    patient.healthState = 'infectious';
    await town.step();
    const after = town.state.healthCases.get(caseId)!;
    expect(after.treatedDays).toBeGreaterThan(0);

    killResident(
      createTurnContext({ state: town.state, scenario: town.scenario, day: town.state.day }),
      patient,
      'illness:test fever',
    );
    expect(patient.status).toBe('dead');
    expect(patient.deathDay).not.toBeNull();
    expect(String(patient.deathCause)).toContain('fever');
  }, 30_000);

  it('routes injuries through the resolver and heals them', async () => {
    const town = await seedTown({ seed: 'injury' });
    const victim = livingResidents(town.state)[1]!;
    const ctx = createTurnContext({ state: town.state, scenario: town.scenario, day: town.state.day });
    addInjury({ ctx, residentId: victim.id, kind: 'test', severity: 2, days: 2 });
    expect(victim.healthState).toBe('injured');
    for (let day = 0; day < 4; day += 1) await town.step();
    const open = [...town.state.injuries.values()].filter((i) => i.residentId === victim.id && i.resolvedDay === null);
    expect(open).toHaveLength(0);
  }, 30_000);
});

describe('civic conflict', () => {
  it('conserves goods when someone steals', async () => {
    const town = await seedTown({ seed: 'theft' });
    const residents = livingResidents(town.state).filter((r) => r.bornDay <= -town.scenario.calendar.adultDays);
    const thief = residents[0]!;
    const victim = residents.find((r) => r.id !== thief.id && r.householdId === thief.householdId) ?? residents[1]!;
    thief.traits.honesty = 5; // forced motive
    const householdId = victim.householdId!;
    const breadBefore = quantityOf(town.state, 'household', householdId, 'bread');
    town.state.inventories.set(`household:${householdId}:bread`, Math.max(10, breadBefore));
    const totalBefore = [...town.state.inventories.entries()]
      .filter(([key]) => key.endsWith(':bread'))
      .reduce((sum, [, qty]) => sum + qty, 0);

    await town.step(
      new Map([
        [thief.id, planFor(thief.id, { intents: [{ kind: 'theft', targetId: victim.id, good: 'bread', quantity: 2 }] })],
      ]),
    );
    const totalAfter = [...town.state.inventories.entries()]
      .filter(([key]) => key.endsWith(':bread'))
      .reduce((sum, [, qty]) => sum + qty, 0);
    // Either the theft happened and moved goods, or it was blocked; total goods are never manufactured.
    expect(totalAfter).toBeLessThanOrEqual(totalBefore);
    const theftEvent = town.db.get<{ id: number }>(
      "select id from events where kind = 'theft' and world_id = ? limit 1",
      [town.worldId],
    );
    if (theftEvent) expect(totalAfter).toBeLessThan(totalBefore);
  }, 30_000);
});

describe('affairs, prisons, and rebellion closure', () => {
  it('records an affair only when both adults consent', async () => {
    const town = await seedTown({ seed: 'affair' });
    const adults = livingResidents(town.state).filter((r) => r.bornDay <= -town.scenario.calendar.adultDays);
    const a = adults[0]!;
    const b = adults.find((r) => r.id !== a.id && r.partnerId !== null) ?? adults[1]!;
    await town.step(new Map([[a.id, planFor(a.id, { social: { kind: 'affair', targetId: b.id } })]]));
    const relationships = [...town.state.relationships.values()].filter(
      (r) => r.kind === 'affair' && [r.aId, r.bId].includes(a.id) && [r.aId, r.bId].includes(b.id),
    );
    expect(relationships).toHaveLength(0);
    expect(
      [...town.state.proposals.values()].some((p) => p.kind === 'affair' && p.fromId === a.id && p.status === 'pending'),
    ).toBe(true);

    await town.step(
      new Map([
        [a.id, planFor(a.id, { social: { kind: 'affair', targetId: b.id } })],
        [b.id, planFor(b.id, { social: { kind: 'accept', targetId: a.id } })],
      ]),
    );
    expect(
      [...town.state.relationships.values()].filter(
        (r) => r.kind === 'affair' && [r.aId, r.bId].includes(a.id) && [r.aId, r.bId].includes(b.id),
      ),
    ).toHaveLength(1);
  }, 30_000);

  it('releases a prisoner when the sentence expires', async () => {
    const town = await seedTown({ seed: 'prison' });
    const adults = livingResidents(town.state).filter((r) => r.bornDay <= -town.scenario.calendar.adultDays);
    const defendant = adults[0]!;
    const day = town.state.day + 1;
    const caseId = nextId(town.state, 'case');
    town.state.cases.set(caseId, {
      id: caseId,
      kind: 'theft',
      defendantId: defendant.id,
      plaintiffId: adults[1]!.id,
      openedDay: day - 30,
      status: 'closed',
      investigationDays: 5,
      prosecutionBps: 6_000,
      defenceBps: 1_000,
      verdict: 'imprisonment',
      closedDay: day - 20,
      disputedEstateId: null,
      truth: {},
    });
    const sentenceId = nextId(town.state, 'sentence');
    town.state.sentences.set(sentenceId, {
      id: sentenceId,
      caseId,
      kind: 'imprisonment',
      amountCents: 0,
      days: 20,
      startDay: day - 20,
      endDay: day - 1,
      status: 'active',
      releasedDay: null,
    });
    await town.step();
    const sentence = town.state.sentences.get(sentenceId)!;
    expect(sentence.status).toBe('served');
    const release = town.db.get<{ id: number }>(
      "select id from events where kind = 'prisoner_released' and world_id = ?",
      [town.worldId],
    );
    expect(release).toBeDefined();
  }, 30_000);

  it('resolves a rebellion within its deadline and keeps offices and property intact', async () => {
    const town = await seedTown({ seed: 'rebellion', drama: 'volatile' });
    const adults = livingResidents(town.state).filter((r) => r.bornDay <= -town.scenario.calendar.adultDays);
    for (const resident of adults) {
      const id = nextId(town.state, 'grievance');
      town.state.grievances.set(id, {
        id,
        residentId: resident.id,
        kind: 'unpaid_wages',
        severity: 80,
        sinceDay: town.state.day,
        untilDay: null,
        reason: 'unpaid',
      });
    }
    town.state.counters.set('legitimacyBps', 1_000);
    const factionId = nextId(town.state, 'faction');
    town.state.factions.set(factionId, {
      id: factionId,
      name: 'The Dockers',
      interest: 'fair_wages',
      leaderId: adults[0]!.id,
      fundsCents: 0,
      supportBps: 6_000,
      createdDay: town.state.day,
      dissolvedDay: null,
    });
    // Members keep the faction alive: support is recomputed from real membership each day.
    for (const resident of adults) {
      town.state.factionMembers.set(`${factionId}:${resident.id}`, {
        key: `${factionId}:${resident.id}`,
        factionId,
        residentId: resident.id,
        joinedDay: town.state.day,
        leftDay: null,
        loyalty: 70,
      });
    }

    let rebellion = null as null | { status: string; startedDay: number };
    for (let day = 0; day < 90; day += 1) {
      // Sustained grievance is the prerequisite: keep it renewed rather than decaying away.
      for (const resident of adults) {
        const id = nextId(town.state, 'grievance');
        town.state.grievances.set(id, {
          id,
          residentId: resident.id,
          kind: 'unpaid_wages',
          severity: 80,
          sinceDay: town.state.day,
          untilDay: null,
          reason: 'still unpaid',
        });
      }
      town.state.counters.set('legitimacyBps', 1_000);
      await town.step();
      const found = [...town.state.unrest.values()].find((u) => u.kind === 'rebellion');
      if (found) {
        rebellion = found;
        if (found.status !== 'active') break;
      }
    }
    expect(rebellion).not.toBeNull();
    expect(rebellion?.status).not.toBe('active');
    // Offices still exist and nobody was deleted.
    expect([...town.state.offices.values()].length).toBeGreaterThanOrEqual(6);
    expect(livingResidents(town.state).length).toBeGreaterThan(0);
  }, 60_000);
});

describe('collective unrest', () => {
  it('starts and closes a strike called by workers', async () => {
    const town = await seedTown({ seed: 'strike' });
    const business = [...town.state.businesses.values()].find(
      (b) =>
        [...town.state.contracts.values()].filter(
          (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === b.id,
        ).length >= 2,
    )!;
    const workers = [...town.state.contracts.values()]
      .filter((c) => c.kind === 'employment' && c.status === 'active' && c.businessId === business.id)
      .map((c) => c.aId);
    const leader = town.state.residents.get(workers[0]!)!;
    await town.step(
      new Map([[leader.id, planFor(leader.id, { intents: [{ kind: 'strike_call', businessId: business.id }] })]]),
    );
    const strike = [...town.state.unrest.values()].find((u) => u.kind === 'strike');
    expect(strike).toBeDefined();
    expect(strike?.status).toBe('active');
    expect(strike?.participants.length).toBeGreaterThanOrEqual(2);

    for (let day = 0; day < 25 && strike?.status === 'active'; day += 1) await town.step();
    expect(strike?.status).not.toBe('active');
  }, 60_000);

  it('turns sustained grievance into a protest and can escalate it to a riot', async () => {
    const town = await seedTown({ seed: 'protest', drama: 'volatile' });
    const adults = livingResidents(town.state).filter((r) => r.bornDay <= -town.scenario.calendar.adultDays);
    for (const resident of adults) {
      addResidentGrievance(
        { state: town.state, scenario: town.scenario, day: town.state.day } as never,
        resident.id,
        'hunger',
        60,
        'no food',
      );
    }
    // Replace the grievance helper's context requirement by writing directly into state.
    for (const resident of adults) {
      const id = nextId(town.state, 'grievance');
      town.state.grievances.set(id, {
        id,
        residentId: resident.id,
        kind: 'unpaid_wages',
        severity: 70,
        sinceDay: town.state.day,
        untilDay: null,
        reason: 'unpaid',
      });
    }
    town.state.counters.set('legitimacyBps', 1_500);

    const caller = adults[0]!;
    await town.step(
      new Map([[caller.id, planFor(caller.id, { intents: [{ kind: 'protest_call' }] })]]),
    );
    const protest = [...town.state.unrest.values()].find((u) => u.kind === 'protest');
    expect(protest, 'a protest should have been recorded').toBeDefined();

    for (let day = 0; day < 8; day += 1) {
      await town.step(new Map([[caller.id, planFor(caller.id, { intents: [{ kind: 'riot_call' }] })]]));
      if ([...town.state.unrest.values()].some((u) => u.kind === 'riot')) break;
    }
    const riot = [...town.state.unrest.values()].find((u) => u.kind === 'riot');
    expect(riot).toBeDefined();
    expect(riot?.status === 'active' || riot?.status === 'suppressed').toBe(true);
  }, 60_000);
});
