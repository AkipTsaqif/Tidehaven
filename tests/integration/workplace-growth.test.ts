import { describe, expect, it } from 'vitest';
import { createTown } from '../../src/application/bootstrap.js';
import { loadScenario } from '../../src/application/scenario.js';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { loadState } from '../../src/storage/repositories.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { developmentPhase, startDevelopment, workOnDevelopment, cancelDevelopment } from '../../src/domain/society/development.js';
import { developmentRules } from '../../src/domain/development-rules.js';
import { hireWorker } from '../../src/domain/economy/employment.js';
import { runProduction } from '../../src/domain/economy/production.js';
import { balanceOf, getAccount, quantityOf, type WorldState } from '../../src/domain/state.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import type { GrowthRules } from '../../src/contracts/growth.js';
import type { Scenario } from '../../src/contracts/scenario.js';

function growth(): GrowthRules {
  return {
    populationPolicyEnabled: false,
    housingSharing: 'consent',
    maxBuildings: 100,
    maxBusinesses: 100,
    maxActiveProjects: 4,
    maxProjects: 20,
    maxPendingHousingRequests: 10,
    housingRequestDays: 7,
    workplaceTemplates: {
      farm: {
        capacity: 2,
        labourDays: 1,
        materials: { timber: 2 },
        constructionCostCents: 100,
        startupCapitalCents: 500,
      },
    },
    expansionTemplates: {
      farm: {
        capacityCeiling: 20,
        labourDaysPerCapacity: 1,
        materialsPerCapacity: { timber: 1 },
        constructionCostCentsPerCapacity: 50,
      },
    },
  };
}

function town(): { db: ReturnType<typeof openDatabase>; state: WorldState; scenario: Scenario; actorId: number } {
  const db = openDatabase(':memory:');
  migrate(db);
  const base = loadScenario(process.cwd());
  const scenario = { ...base, growth: growth() } as Scenario;
  const created = createTown({
    db,
    scenario,
    worldName: 'Growth Testhaven',
    seed: 'growth-test',
    populationTarget: 120,
    hostCeiling: 500,
    drama: 'calm',
  });
  const state = loadState(db, created.world);
  const actor = [...state.residents.values()].find((resident) => resident.status === 'living');
  if (!actor) throw new Error('test town has no living actor');
  return { db, state, scenario, actorId: actor.id };
}

function ctx(state: WorldState, scenario: Scenario, day = 1) {
  return createTurnContext({ state, scenario, day });
}

function plan(actorId: number, primary: ActorPlan['plan']['primary']): ActorPlan {
  return { actorId, plan: { primary, social: null, orders: [], intents: [], summary: '' }, source: 'operator', summary: '' };
}

function fundActor(state: WorldState, actorId: number, amount = 10_000): void {
  const treasury = getAccount(state, 'treasury', 0);
  const resident = getAccount(state, 'resident', actorId);
  const transfer = Math.min(amount, treasury.balanceCents);
  treasury.balanceCents -= transfer;
  resident.balanceCents += transfer;
}

describe('funded workplace development', () => {
  it('rejects an unknown template without creating a project or site', () => {
    const fixture = town();
    try {
      const result = startDevelopment(ctx(fixture.state, fixture.scenario), fixture.state.development, developmentRules(growth()), {
        actorId: fixture.actorId,
        kind: 'workplace',
        businessKind: 'unknown_kind',
      });
      expect(result).toEqual({ ok: false, reason: 'unknown_business_kind' });
      expect(fixture.state.development.projects).toHaveLength(0);
      expect([...fixture.state.buildings.values()].filter((building) => building.kind === 'development_site')).toHaveLength(0);
    } finally {
      fixture.db.close();
    }
  });

  it('funds a private site, keeps capacity at zero, then completes a resident-owned business', () => {
    const fixture = town();
    try {
      fundActor(fixture.state, fixture.actorId);
      fixture.state.inventories.set(`resident:${fixture.actorId}:timber`, 2);
      const rules = developmentRules(growth());
      const start = startDevelopment(ctx(fixture.state, fixture.scenario), fixture.state.development, rules, {
        actorId: fixture.actorId,
        kind: 'workplace',
        businessKind: 'farm',
      });
      expect(start.ok).toBe(true);
      const projectId = start.projectId!;
      const project = fixture.state.development.projects.get(projectId)!;
      const site = fixture.state.buildings.get(project.targetBuildingId)!;
      expect(site.kind).toBe('development_site');
      expect(site.capacity).toBe(0);
      expect(site.privateFlag).toBe(true);
      expect([...fixture.state.businesses.values()].some((business) => business.buildingId === site.id)).toBe(false);

      const firstWork = workOnDevelopment(ctx(fixture.state, fixture.scenario, 2), fixture.state.development, rules, projectId, fixture.actorId);
      expect(firstWork.ok).toBe(true);
      expect(fixture.state.development.projects.get(projectId)?.status).toBe('active');
      expect(site.capacity).toBe(0);

      const secondWork = workOnDevelopment(ctx(fixture.state, fixture.scenario, 3), fixture.state.development, rules, projectId, fixture.actorId);
      expect(secondWork.ok).toBe(true);
      const phase = developmentPhase(
        ctx(fixture.state, fixture.scenario, 3),
        new Map(),
        fixture.state.development,
        rules,
      );
      expect(phase.completed).toBe(1);
      expect(site.kind).toBe('farm');
      expect(site.capacity).toBe(2);
      const business = [...fixture.state.businesses.values()].find((candidate) => candidate.buildingId === site.id);
      expect(business?.ownerType).toBe('resident');
      expect(business?.ownerId).toBe(fixture.actorId);
      expect(balanceOf(fixture.state, 'business', business!.id)).toBe(500);
      expect(quantityOf(fixture.state, 'resident', fixture.actorId, 'timber')).toBe(0);
    } finally {
      fixture.db.close();
    }
  });

  it('does not allocate a duplicate target and refunds startup capital and materials on cancellation', () => {
    const fixture = town();
    try {
      fundActor(fixture.state, fixture.actorId);
      fixture.state.inventories.set(`resident:${fixture.actorId}:timber`, 4);
      const rules = developmentRules(growth());
      const first = startDevelopment(ctx(fixture.state, fixture.scenario), fixture.state.development, rules, {
        actorId: fixture.actorId,
        kind: 'workplace',
        businessKind: 'farm',
      });
      expect(first.ok).toBe(true);
      const projectId = first.projectId!;
      const beforeCancel = balanceOf(fixture.state, 'resident', fixture.actorId);
      const duplicate = startDevelopment(ctx(fixture.state, fixture.scenario, 2), fixture.state.development, rules, {
        actorId: fixture.actorId,
        kind: 'workplace',
        businessKind: 'farm',
      });
      expect(duplicate.ok).toBe(true);
      const cancelled = cancelDevelopment(ctx(fixture.state, fixture.scenario, 2), fixture.state.development, projectId, 'test_cancel');
      expect(cancelled.ok).toBe(true);
      expect(fixture.state.development.projects.get(projectId)?.status).toBe('cancelled');
      expect(quantityOf(fixture.state, 'resident', fixture.actorId, 'timber')).toBe(2);
      // Construction cost is paid to the town and is not refundable; startup capital and materials are.
      expect(balanceOf(fixture.state, 'resident', fixture.actorId)).toBe(beforeCancel - 100);
    } finally {
      fixture.db.close();
    }
  });
});

describe('completed capacity feeds real production', () => {
  async function farmOutput(expand: boolean, staffExtra: boolean): Promise<number> {
    const fixture = town();
    try {
      const rules = developmentRules(growth());
      const farm = [...fixture.state.businesses.values()].find((b) => b.kind === 'farm')!;
      const building = fixture.state.buildings.get(farm.buildingId!)!;
      const ownerId = fixture.actorId;
      farm.ownerType = 'resident';
      farm.ownerId = ownerId;
      fundActor(fixture.state, ownerId, 20_000);
      fixture.state.inventories.set(`resident:${ownerId}:timber`, 10);
      if (expand) {
        const day1 = ctx(fixture.state, fixture.scenario, 1);
        const start = startDevelopment(day1, fixture.state.development, rules,
          { actorId: ownerId, kind: 'expansion', targetId: building.id, capacityDelta: 4 });
        expect(start).toMatchObject({ ok: true });
        for (let day = 2; day < 12; day += 1) {
          const c = ctx(fixture.state, fixture.scenario, day);
          const project = fixture.state.development.projects.get(start.projectId!)!;
          if (project.status !== 'active') break;
          workOnDevelopment(c, fixture.state.development, rules, start.projectId!, ownerId);
          developmentPhase(c, new Map(), fixture.state.development, rules);
        }
        expect(fixture.state.development.projects.get(start.projectId!)?.status).toBe('completed');
      }
      // Fill every place the building now has with an eligible adult.
      const c = ctx(fixture.state, fixture.scenario, 20);
      const staff = () => [...fixture.state.contracts.values()].filter((k) => k.status === 'active' && k.businessId === farm.id).length;
      if (staffExtra) {
        const adults = [...fixture.state.residents.values()].filter((r) => r.status === 'living' && r.bornDay <= 20 - fixture.scenario.calendar.adultDays);
        for (const adult of adults) {
          if (staff() >= building.capacity) break;
          for (const k of fixture.state.contracts.values()) if (k.aId === adult.id && k.status === 'active') k.status = 'ended';
          getAccount(fixture.state, 'business', farm.id).balanceCents = 1_000_000;
          hireWorker({ ctx: c, businessId: farm.id, residentId: adult.id });
        }
      }
      expect(staff()).toBeLessThanOrEqual(building.capacity);
      const plans = new Map<number, ActorPlan>();
      for (const r of fixture.state.residents.values()) plans.set(r.id, plan(r.id, { kind: 'work' }));
      const out = runProduction(c, plans);
      return out.reports.find((r) => r.businessId === farm.id)?.produced.grain ?? 0;
    } finally {
      fixture.db.close();
    }
  }

  it('produces more grain only when the expanded capacity is actually staffed', async () => {
    const control = await farmOutput(false, true);
    const emptyExpansion = await farmOutput(true, false);
    const staffedExpansion = await farmOutput(true, true);
    expect(control).toBeGreaterThan(0);
    expect(emptyExpansion).toBeLessThanOrEqual(control);
    expect(staffedExpansion).toBeGreaterThan(control);
  });
});

describe('cancellation returns exactly what the sponsor put in', () => {
  it('gives bought materials to the sponsor who paid, not back to the seller', () => {
    const fixture = town();
    try {
      fundActor(fixture.state, fixture.actorId);
      // No personal timber: the project must buy both units from the public store.
      fixture.state.inventories.set('treasury:0:timber', 2);
      const rules = developmentRules(growth());
      const cashBefore = balanceOf(fixture.state, 'resident', fixture.actorId);
      const sellerCashBefore = balanceOf(fixture.state, 'treasury', 0);
      const start = startDevelopment(ctx(fixture.state, fixture.scenario), fixture.state.development, rules,
        { actorId: fixture.actorId, kind: 'workplace', businessKind: 'farm' });
      expect(start.ok).toBe(true);
      cancelDevelopment(ctx(fixture.state, fixture.scenario, 2), fixture.state.development, start.projectId!, 'test');
      // The sponsor keeps what they paid for; the seller keeps only the sale proceeds.
      expect(quantityOf(fixture.state, 'resident', fixture.actorId, 'timber')).toBe(2);
      expect(quantityOf(fixture.state, 'treasury', 0, 'timber')).toBe(0);
      // Only the non-refundable construction cost (paid to the treasury) is lost overall.
      const spent = cashBefore - balanceOf(fixture.state, 'resident', fixture.actorId);
      const sellerGain = balanceOf(fixture.state, 'treasury', 0) - sellerCashBefore;
      expect(spent).toBe(sellerGain);
    } finally {
      fixture.db.close();
    }
  });
});

describe('a sponsor who dies mid-project', () => {
  it('sends the refund to the public purse instead of stranding it on a closed estate', () => {
    const fixture = town();
    try {
      fundActor(fixture.state, fixture.actorId);
      fixture.state.inventories.set(`resident:${fixture.actorId}:timber`, 2);
      const rules = developmentRules(growth());
      const start = startDevelopment(ctx(fixture.state, fixture.scenario), fixture.state.development, rules,
        { actorId: fixture.actorId, kind: 'workplace', businessKind: 'farm' });
      expect(start.ok).toBe(true);
      const sponsor = fixture.state.residents.get(fixture.actorId)!;
      sponsor.status = 'dead';
      sponsor.deathDay = 2;
      const treasuryBefore = balanceOf(fixture.state, 'treasury', 0);
      const deadBefore = balanceOf(fixture.state, 'resident', fixture.actorId);
      developmentPhase(ctx(fixture.state, fixture.scenario, 3), new Map(), fixture.state.development, rules);
      expect(fixture.state.development.projects.get(start.projectId!)?.status).toBe('abandoned');
      expect(balanceOf(fixture.state, 'resident', fixture.actorId)).toBe(deadBefore);
      expect(quantityOf(fixture.state, 'resident', fixture.actorId, 'timber')).toBe(0);
      expect(balanceOf(fixture.state, 'treasury', 0)).toBe(treasuryBefore + 500);
      expect(quantityOf(fixture.state, 'treasury', 0, 'timber')).toBe(2);
    } finally {
      fixture.db.close();
    }
  });
});

describe('long-running development is not a lifetime dead end', () => {
  it('retires closed projects after a year so the project limit counts live work only', () => {
    const fixture = town();
    try {
      const rules = { ...developmentRules(growth()), maxTotalProjects: 1 };
      fundActor(fixture.state, fixture.actorId);
      fixture.state.inventories.set(`resident:${fixture.actorId}:timber`, 4);
      const first = startDevelopment(ctx(fixture.state, fixture.scenario, 1), fixture.state.development, rules,
        { actorId: fixture.actorId, kind: 'workplace', businessKind: 'farm' });
      expect(first.ok).toBe(true);
      cancelDevelopment(ctx(fixture.state, fixture.scenario, 2), fixture.state.development, first.projectId!, 'test');
      // A closed project still counts until it is retired.
      expect(startDevelopment(ctx(fixture.state, fixture.scenario, 3), fixture.state.development, rules,
        { actorId: fixture.actorId, kind: 'workplace', businessKind: 'farm' })).toMatchObject({ ok: false, reason: 'project_cap_reached' });
      developmentPhase(ctx(fixture.state, fixture.scenario, 2 + 365), new Map(), fixture.state.development, rules);
      expect(fixture.state.development.projects.has(first.projectId!)).toBe(false);
      expect(startDevelopment(ctx(fixture.state, fixture.scenario, 368), fixture.state.development, rules,
        { actorId: fixture.actorId, kind: 'workplace', businessKind: 'farm' }).ok).toBe(true);
    } finally {
      fixture.db.close();
    }
  });

  it('does not count closed businesses or abandoned sites against the safety limits', () => {
    const fixture = town();
    try {
      const open = [...fixture.state.businesses.values()].filter((b) => b.status === 'open').length;
      const rules = { ...developmentRules(growth()), maxBusinesses: open + 1 };
      for (const business of fixture.state.businesses.values()) {
        if (business.kind === 'shop') { business.status = 'closed'; business.closedDay = 1; }
      }
      fundActor(fixture.state, fixture.actorId);
      fixture.state.inventories.set(`resident:${fixture.actorId}:timber`, 4);
      expect(startDevelopment(ctx(fixture.state, fixture.scenario, 2), fixture.state.development, rules,
        { actorId: fixture.actorId, kind: 'workplace', businessKind: 'farm' }).ok).toBe(true);
    } finally {
      fixture.db.close();
    }
  });
});
