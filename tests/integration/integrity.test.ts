import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { stateHash, stateSnapshot } from '../../src/domain/hash.js';
import { readWorld, loadState, saveState, type SavePayload } from '../../src/storage/repositories.js';
import { checkInvariants } from '../../src/domain/invariants.js';
import { buildNewspaperDigest } from '../../src/application/newspaper.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import type { ActorPlan } from '../../src/contracts/actions.js';

/** Regression tests for the integrity claims in docs/IMPLEMENTATION_REVIEW.md (F1, F2, F3, F21). */

function payloadFor(town: Awaited<ReturnType<typeof seedTown>>, day: number): SavePayload {
  return {
    events: [],
    ledger: [],
    flows: [],
    observations: [],
    memories: [],
    taxRecords: [],
    shipping: [],
    articles: [],
    metrics: { day, metrics: {}, stateHash: stateHash(town.state) },
    phase: 'committed',
    stateHash: stateHash(town.state),
  };
}

describe('canonical state hash covers authoritative state (F1)', () => {
  it('changes when any rule-relevant collection or field is mutated', async () => {
    const town = await seedTown({ seed: 'hash-coverage' });
    const resident = [...town.state.residents.values()][0]!;
    const contract = [...town.state.contracts.values()][0]!;
    const mutations: [string, () => void][] = [
      ['contract status', () => { contract.status = contract.status === 'ended' ? 'active' : 'ended'; }],
      ['resident trait', () => { resident.traits.diligence = (resident.traits.diligence ?? 50) + 1; }],
      [
        'relationship trust',
        () => {
          const rel = [...town.state.relationships.values()][0];
          if (!rel) return;
          rel.trust += 1;
        },
      ],
      [
        'building condition',
        () => {
          const building = [...town.state.buildings.values()][0]!;
          building.conditionBps -= 1;
        },
      ],
      [
        'estate claim',
        () => {
          town.state.estateClaims.set(1, {
            id: 1,
            estateId: 1,
            claimantId: null,
            kind: 'treasury',
            amountCents: 1,
            status: 'pending',
            resolvedDay: null,
          });
        },
      ],
      [
        'proposal',
        () => {
          town.state.proposals.set(1, {
            id: 1,
            day: 1,
            fromId: resident.id,
            toId: resident.id,
            kind: 'courtship',
            status: 'pending',
            expiresDay: 3,
            detail: {},
          });
        },
      ],
      ['counter', () => town.state.counters.set('probeCounter', (town.state.counters.get('probeCounter') ?? 0) + 1)],
      ['reserved goods', () => town.state.reserved.set('household:1:bread', 1)],
      ['policy', () => town.state.policies.set('probePolicy', 1)],
    ];
    for (const [label, mutate] of mutations) {
      const before = stateHash(town.state);
      mutate();
      expect(stateHash(town.state), `${label} must change the canonical hash`).not.toBe(before);
    }
    town.db.close();
  }, 30_000);

  it('includes contracts, relationships, factions, unrest, proposals, and disasters', async () => {
    const town = await seedTown({ seed: 'hash-collections' });
    const snapshot = stateSnapshot(town.state) as Record<string, unknown>;
    for (const key of [
      'contracts',
      'relationships',
      'factions',
      'factionMembers',
      'unrest',
      'grievances',
      'proposals',
      'disasters',
      'buildings',
      'evidence',
      'estateClaims',
      'reserved',
      'policies',
      'counters',
      'wills',
      'nextIds',
    ]) {
      expect(snapshot, `snapshot must include ${key}`).toHaveProperty(key);
    }
    town.db.close();
  }, 30_000);
});

describe('persistence does not mutate authoritative state (F2)', () => {
  it('produces the same hash before save, after save, and after reload', async () => {
    const town = await seedTown({ seed: 'hash-save' });
    const day = town.state.day + 1;
    const plans = new Map<number, ActorPlan>();
    for (const resident of town.state.residents.values()) {
      if (resident.status !== 'living') continue;
      if (!isAdult(resident.bornDay, day, town.scenario.calendar)) continue;
      plans.set(resident.id, {
        actorId: resident.id,
        plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
        source: 'model',
        summary: '',
      });
    }
    const result = runDay({ state: town.state, scenario: town.scenario, day, plans });
    const article = buildNewspaperDigest(result.ctx, result.ctx.events);
    const beforeSave = stateHash(town.state);
    const payload: SavePayload = {
      events: result.ctx.events,
      ledger: result.ctx.ledger,
      flows: result.ctx.flows,
      observations: result.ctx.observations,
      memories: result.ctx.memories,
      taxRecords: result.ctx.taxRecords,
      shipping: result.ctx.shipping,
      articles: [article],
      metrics: { day, metrics: result.metrics, stateHash: beforeSave },
      phase: 'committed',
      stateHash: beforeSave,
    };
    expect(stateHash(town.state)).toBe(beforeSave);
    saveState(town.db, town.state, payload);
    expect(stateHash(town.state)).toBe(beforeSave);
    const reloaded = loadState(town.db, readWorld(town.db, town.worldId)!);
    expect(stateHash(reloaded)).toBe(beforeSave);
    town.db.close();
  }, 30_000);
});

describe('goods reconciliation gates the commit (F3)', () => {
  it('reports an unrecorded stock change as an invariant violation', async () => {
    const town = await seedTown({ seed: 'goods-gate' });
    const clean = checkInvariants(town.state);
    expect(clean.violations.filter((v) => v.code === 'goods_unreconciled')).toHaveLength(0);

    const key = [...town.state.inventories.keys()].find((candidate) => candidate.endsWith(':grain'))!;
    town.state.inventories.set(key, (town.state.inventories.get(key) ?? 0) + 1);
    const dirty = checkInvariants(town.state);
    expect(dirty.ok).toBe(false);
    expect(dirty.violations.some((v) => v.code === 'goods_unreconciled')).toBe(true);
    town.db.close();
  }, 30_000);
});

describe('effect rows are idempotent (F21)', () => {
  it('does not duplicate ledger, flow, observation, or memory rows when the same payload is saved twice', async () => {
    const town = await seedTown({ seed: 'idempotent' });
    const day = town.state.day + 1;
    const plans = new Map<number, ActorPlan>();
    for (const resident of town.state.residents.values()) {
      if (resident.status !== 'living') continue;
      if (!isAdult(resident.bornDay, day, town.scenario.calendar)) continue;
      plans.set(resident.id, {
        actorId: resident.id,
        plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' },
        source: 'model',
        summary: '',
      });
    }
    const result = runDay({ state: town.state, scenario: town.scenario, day, plans });
    const payload: SavePayload = {
      events: result.ctx.events,
      ledger: result.ctx.ledger,
      flows: result.ctx.flows,
      observations: result.ctx.observations,
      memories: result.ctx.memories,
      taxRecords: result.ctx.taxRecords,
      shipping: result.ctx.shipping,
      articles: [buildNewspaperDigest(result.ctx, result.ctx.events)],
      metrics: { day, metrics: result.metrics, stateHash: stateHash(town.state) },
      phase: 'committed',
      stateHash: stateHash(town.state),
    };
    saveState(town.db, town.state, payload);
    const counts = (): Record<string, number> => ({
      ledger: town.db.get<{ n: number }>('select count(*) as n from ledger_entries')!.n,
      flows: town.db.get<{ n: number }>('select count(*) as n from goods_flows')!.n,
      observations: town.db.get<{ n: number }>('select count(*) as n from observations')!.n,
      memories: town.db.get<{ n: number }>('select count(*) as n from memories')!.n,
    });
    const first = counts();
    expect(first.ledger).toBeGreaterThan(0);
    saveState(town.db, town.state, payload);
    expect(counts()).toEqual(first);
    void payloadFor;
    town.db.close();
  }, 30_000);
});
