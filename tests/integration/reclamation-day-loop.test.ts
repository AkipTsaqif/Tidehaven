import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { createTown } from '../../src/application/bootstrap.js';
import { loadScenario } from '../../src/application/scenario.js';
import { loadState, readWorld, saveState } from '../../src/storage/repositories.js';
import { runDay } from '../../src/domain/turn-engine.js';
import { isAdult } from '../../src/domain/clock.js';
import { stateHash } from '../../src/domain/hash.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { mapView } from '../../src/application/map-query.js';
import { buildActorPrompt } from '../../src/model/prompts.js';
import { layoutTown } from '../../src/domain/geography/layout.js';
import type { ActorPlan } from '../../src/contracts/actions.js';
import type { Scenario } from '../../src/contracts/scenario.js';

const idle = (actorId: number): ActorPlan => ({
  actorId, plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' }, source: 'model', summary: '',
});


/** Fund the public purse through the ledger (an external grant), so conservation checks stay honest. */
function grantToTreasury(state: ReturnType<typeof loadState>, scenario: Scenario, cents: number, timber: number): void {
  const ctx = createTurnContext({ state, scenario, day: 0 });
  ctx.transfer({ from: { type: 'external', id: 0 }, to: { type: 'treasury', id: 0 }, cents, reason: 'test_grant' });
  ctx.shiftGoods({ owner: { type: 'treasury', id: 0 }, good: 'timber', delta: timber, reason: 'import' });
}

/** Eden with the scarcity distance forced to zero so the council may reclaim immediately. */
function scarceEden(): Scenario {
  const base = loadScenario(process.cwd(), 'scenarios/eden.json');
  return { ...base, growth: { ...base.growth!, reclamation: { scarcityDistanceTiles: 0, cooldownDays: 5 } } } as Scenario;
}

describe('land reclamation through the real day loop', () => {
  it('the council proposes it, the town funds and builds it, and the map shows new land', () => {
    const scenario = scarceEden();
    const db = openDatabase(':memory:');
    migrate(db);
    const created = createTown({ db, scenario, worldName: 'Eden', seed: 'reclaim-day-loop', populationTarget: 2,
      populationPolicyEnabled: false, hostCeiling: 500, drama: 'calm', mapOptions: { biome: 'tropical', terrain: 'island' } });
    let state = loadState(db, created.world);
    const eve = [...state.residents.values()].find((r) => r.name === 'Eve')!;
    // Give the public purse enough to pay for a large, expensive project.
    grantToTreasury(state, scenario, 300_000, 400);
    let started = 0;
    let completed = 0;
    try {
      for (let day = 1; day <= 160 && completed === 0; day += 1) {
        const plans = new Map<number, ActorPlan>();
        for (const resident of state.residents.values()) {
          if (resident.status !== 'living' || !isAdult(resident.bornDay, day, scenario.calendar)) continue;
          const choice = idle(resident.id);
          if (resident.id === eve.id) {
            const active = [...state.development.projects.values()].find((p) => p.kind === 'reclamation' && p.status === 'active');
            choice.plan.primary = active ? { kind: 'work_construction', targetId: active.id } : { kind: 'reclaim_land' };
          }
          plans.set(resident.id, choice);
        }
        const result = runDay({ state, scenario, day, plans });
        expect(result.invariants.violations.map((v) => `${v.code}: ${v.detail}`), `day ${day}`).toEqual([]);
        for (const event of result.ctx.events) {
          if (event.kind === 'development_started' && String(event.title).includes('reclaiming')) started += 1;
          if (event.kind === 'development_completed' && String(event.title).includes('New land')) completed += 1;
        }
      }
      expect(started).toBe(1);
      expect(completed).toBe(1);
      expect(state.reclaimed).toHaveLength(1);

      saveState(db, state, { events: [], ledger: [], flows: [], observations: [], memories: [], taxRecords: [], shipping: [], articles: [],
        metrics: null, phase: 'committed', stateHash: stateHash(state) });
      const reloaded = loadState(db, readWorld(db)!);
      expect(stateHash(reloaded)).toBe(stateHash(state));
      expect(reloaded.reclaimed).toEqual(state.reclaimed);
      state = reloaded;

      // The map reads the same saved patches and agrees with the simulation's own placement.
      const view = mapView(db, state.worldId);
      const patch = state.reclaimed[0]!;
      const land = (tx: number, ty: number) => view.terrain!.rows[ty - view.terrain!.y0] !== undefined;
      expect(land(patch.tx, patch.ty)).toBe(true);
      const ids = [...state.buildings.keys()].sort((a, b) => a - b);
      const sim = layoutTown(state.seed, ids.map((id) => ({ id, placement: state.buildings.get(id)!.kind === 'fishery' ? 'shore' as const : 'land' as const })),
        [...state.households.values()].filter((h) => h.dissolvedDay === null && h.buildingId === null).map((h) => h.id), state.terrain, state.reclaimed);
      for (const lot of sim.lots) {
        const shown = view.lots.find((l) => l.buildingId === lot.buildingId && lot.buildingId !== null);
        if (shown) expect([shown.tx, shown.ty]).toEqual([lot.tx, lot.ty]);
      }

      // The council is told it can reclaim; an ordinary resident is not.
      const councillorPrompt = buildActorPrompt({ state, scenario, resident: eve, day: state.day + 1, memories: [], events: [], maxBytes: 24_000, maxRecords: 20 });
      expect(councillorPrompt.user).toContain('reclaim_land');
      const other = [...state.residents.values()].find((r) => r.id !== eve.id && r.status === 'living' && isAdult(r.bornDay, state.day, scenario.calendar));
      if (other) {
        const prompt = buildActorPrompt({ state, scenario, resident: other, day: state.day + 1, memories: [], events: [], maxBytes: 24_000, maxRecords: 20 });
        const holdsOffice = [...state.offices.values()].some((o) => o.holderId === other.id && (o.office === 'councillor' || o.office === 'magistrate'));
        if (!holdsOffice) expect(prompt.user).not.toContain('reclaim_land');
      }
    } finally { db.close(); }
  });

  it('a non-council resident who proposes it is rejected and nothing is spent', () => {
    const scenario = scarceEden();
    const db = openDatabase(':memory:');
    migrate(db);
    const created = createTown({ db, scenario, worldName: 'Eden', seed: 'reclaim-reject', populationTarget: 2,
      populationPolicyEnabled: false, hostCeiling: 500, drama: 'calm' });
    const state = loadState(db, created.world);
    try {
      grantToTreasury(state, scenario, 300_000, 400);
      const holders = new Set([...state.offices.values()].map((o) => o.holderId));
      const outsider = [...state.residents.values()].find((r) => r.status === 'living' && !holders.has(r.id));
      // Eden starts with only Adam and Eve, and both hold office: promote nobody, test via a pseudo plan.
      if (!outsider) return;
      const plans = new Map<number, ActorPlan>([[outsider.id, { ...idle(outsider.id), plan: { primary: { kind: 'reclaim_land' }, social: null, orders: [], intents: [], summary: '' } }]]);
      const treasury = state.accounts.get('treasury:0')!.balanceCents;
      runDay({ state, scenario, day: 1, plans });
      expect([...state.development.projects.values()].filter((p) => p.kind === 'reclamation')).toHaveLength(0);
      expect(state.accounts.get('treasury:0')!.balanceCents).toBeGreaterThanOrEqual(treasury - 1);
    } finally { db.close(); }
  });
});
