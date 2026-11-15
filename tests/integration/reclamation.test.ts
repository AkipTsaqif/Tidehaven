import { describe, expect, it } from 'vitest';
import { createTown } from '../../src/application/bootstrap.js';
import { loadScenario } from '../../src/application/scenario.js';
import { openDatabase } from '../../src/storage/database.js';
import { migrate } from '../../src/storage/migrate.js';
import { loadState, saveState } from '../../src/storage/repositories.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { cancelDevelopment, developmentPhase, startDevelopment, workOnDevelopment } from '../../src/domain/society/development.js';
import { developmentRulesFor } from '../../src/domain/development-rules.js';
import { DEFAULT_RECLAMATION } from '../../src/domain/reclamation-rules.js';
import { stateHash } from '../../src/domain/hash.js';
import { checkInvariants } from '../../src/domain/invariants.js';
import { getAccount, GOODS, type WorldState } from '../../src/domain/state.js';
import { layoutTown } from '../../src/domain/geography/layout.js';
import type { DevelopmentRules } from '../../src/domain/development-types.js';
import type { Scenario } from '../../src/contracts/scenario.js';

/** A tiny town on a crowded coast so land is scarce straight away. */
function town(options: { terrain?: 'island' | 'coast' | 'river_plain'; scarce?: boolean; noGrowth?: boolean } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  const base = loadScenario(process.cwd());
  const scenario = (options.noGrowth ? { ...base, growth: undefined } : base) as Scenario;
  const created = createTown({
    db, scenario, worldName: 'Reclaim', seed: 'reclaim-seed', populationTarget: 120, hostCeiling: 500, drama: 'calm',
    mapOptions: { biome: 'temperate', terrain: options.terrain ?? 'island' },
  });
  const state = loadState(db, created.world);
  const councillor = [...state.offices.values()].find((o) => o.office === 'councillor' && o.holderId !== null);
  const worker = [...state.residents.values()].find((r) => r.status === 'living' && r.id !== councillor?.holderId);
  // Rich treasury with plenty of timber so affordability is not the thing under test.
  getAccount(state, 'treasury', 0).balanceCents += 500_000;
  state.inventories.set('treasury:0:timber', 1_000);
  return { db, state, scenario, councillorId: councillor?.holderId ?? 1, workerId: worker?.id ?? 2 };
}

const ctx = (state: WorldState, scenario: Scenario, day = 1) => createTurnContext({ state, scenario, day });

/** Force scarcity: the threshold is 0, so any free lot more than 0 tiles from the centre counts. */
function rules(scenario: Scenario, extra: Record<string, unknown> = {}): DevelopmentRules {
  const base = developmentRulesFor(scenario.growth);
  return { ...base, reclamation: { scarcityDistanceTiles: 0, cooldownDays: 5, ...extra } };
}

function money(state: WorldState): number {
  let total = 0;
  for (const account of state.accounts.values()) total += account.balanceCents;
  return total;
}
function goods(state: WorldState): number {
  let total = 0;
  for (const [key, quantity] of state.inventories) if (GOODS.some((g) => key.endsWith(`:${g}`))) total += quantity;
  return total;
}

describe('land reclamation rules', () => {
  it('is on by default: a scenario with no growth block can still reclaim', () => {
    const t = town({ noGrowth: true });
    try {
      expect(t.scenario.growth).toBeUndefined();
      const r = developmentRulesFor(t.scenario.growth);
      expect(r.reclamation).toBeUndefined(); // no override stored: defaults come from engine code
      const result = startDevelopment(ctx(t.state, t.scenario), t.state.development,
        { ...r, reclamation: { scarcityDistanceTiles: 0 } }, { actorId: t.councillorId, kind: 'reclamation' });
      expect(result.ok, result.reason).toBe(true);
      expect(DEFAULT_RECLAMATION.enabled).toBe(true);
    } finally { t.db.close(); }
  });

  it('can be switched off by a scenario', () => {
    const t = town();
    try {
      const result = startDevelopment(ctx(t.state, t.scenario), t.state.development,
        rules(t.scenario, { enabled: false }), { actorId: t.councillorId, kind: 'reclamation' });
      expect(result).toEqual({ ok: false, reason: 'reclamation_disabled' });
    } finally { t.db.close(); }
  });

  it('only a councillor or magistrate may start it', () => {
    const t = town();
    try {
      const result = startDevelopment(ctx(t.state, t.scenario), t.state.development, rules(t.scenario), { actorId: t.workerId, kind: 'reclamation' });
      expect(result).toEqual({ ok: false, reason: 'civic_authorization_required' });
      expect(t.state.development.projects.size).toBe(0);
    } finally { t.db.close(); }
  });

  it('refuses while free land is nearby (scarcity is distance to the nearest free lot)', () => {
    const t = town();
    try {
      const result = startDevelopment(ctx(t.state, t.scenario), t.state.development,
        { ...developmentRulesFor(t.scenario.growth), reclamation: { scarcityDistanceTiles: 400 } },
        { actorId: t.councillorId, kind: 'reclamation' });
      expect(result).toEqual({ ok: false, reason: 'reclamation_land_not_scarce' });
      expect(t.state.development.projects.size).toBe(0);
    } finally { t.db.close(); }
  });

  it('refuses on a river plain, which has no sea edge to extend', () => {
    const t = town({ terrain: 'river_plain' });
    try {
      const result = startDevelopment(ctx(t.state, t.scenario), t.state.development, rules(t.scenario), { actorId: t.councillorId, kind: 'reclamation' });
      expect(result).toEqual({ ok: false, reason: 'reclamation_terrain_not_supported' });
    } finally { t.db.close(); }
  });

  it('refuses when the treasury cannot pay, changing nothing', () => {
    const t = town();
    try {
      getAccount(t.state, 'treasury', 0).balanceCents = 100;
      const before = stateHash(t.state);
      const result = startDevelopment(ctx(t.state, t.scenario), t.state.development, rules(t.scenario), { actorId: t.councillorId, kind: 'reclamation' });
      expect(result.ok).toBe(false);
      expect(stateHash(t.state)).toBe(before);
    } finally { t.db.close(); }
  });
});

describe('reclamation lifecycle and conservation', () => {
  it('moves real money and timber into escrow, then consumes them: nothing is created', () => {
    const t = town();
    try {
      const rs = rules(t.scenario);
      const m0 = money(t.state);
      const g0 = goods(t.state);
      const treasury0 = getAccount(t.state, 'treasury', 0).balanceCents;
      const start = startDevelopment(ctx(t.state, t.scenario), t.state.development, rs, { actorId: t.councillorId, kind: 'reclamation' });
      expect(start.ok, start.reason).toBe(true);
      expect(money(t.state)).toBe(m0); // transfers only: nothing created or destroyed
      // The fee really leaves the treasury (held in escrow), instead of being paid to itself.
      expect(getAccount(t.state, 'treasury', 0).balanceCents).toBe(treasury0 - DEFAULT_RECLAMATION.constructionCostCents);
      expect(getAccount(t.state, 'escrow', 3_000_000 + start.projectId!).balanceCents).toBe(DEFAULT_RECLAMATION.constructionCostCents);
      const external0 = getAccount(t.state, 'external', 0).balanceCents;
      expect(goods(t.state)).toBe(g0); // timber moved to escrow, not yet consumed
      const project = t.state.development.projects.get(start.projectId!)!;
      expect(project.kind).toBe('reclamation');
      expect(t.state.reclaimed).toHaveLength(0);

      // Work until done. The sponsor works; a project needs the councillor's own labour days.
      let day = 2;
      while (t.state.development.projects.get(start.projectId!)!.status === 'active' && day < 400) {
        workOnDevelopment(ctx(t.state, t.scenario, day), t.state.development, rs, start.projectId!, t.councillorId);
        developmentPhase(ctx(t.state, t.scenario, day), new Map(), t.state.development, rs);
        day += 1;
      }
      expect(project.status).toBe('completed');
      expect(t.state.reclaimed).toHaveLength(1);
      expect(t.state.reclaimed[0]).toMatchObject({ id: 1, projectId: project.id, size: 12 });
      expect(goods(t.state)).toBe(g0 - DEFAULT_RECLAMATION.materials.timber!); // consumed by the works
      expect(money(t.state)).toBe(m0); // fee moved to the outside account, total money conserved
      expect(getAccount(t.state, 'external', 0).balanceCents).toBe(external0 + DEFAULT_RECLAMATION.constructionCostCents);
      expect(getAccount(t.state, 'treasury', 0).balanceCents).toBe(treasury0 - DEFAULT_RECLAMATION.constructionCostCents);
      expect(checkInvariants(t.state, t.scenario).violations.filter((v) => v.code.startsWith('development'))).toEqual([]);
    } finally { t.db.close(); }
  });

  it('cancelling returns every cent and every unit of timber', () => {
    const t = town();
    try {
      const rs = rules(t.scenario);
      const treasury = getAccount(t.state, 'treasury', 0);
      const money0 = treasury.balanceCents;
      const timber0 = t.state.inventories.get('treasury:0:timber')!;
      const start = startDevelopment(ctx(t.state, t.scenario), t.state.development, rs, { actorId: t.councillorId, kind: 'reclamation' });
      expect(start.ok).toBe(true);
      cancelDevelopment(ctx(t.state, t.scenario, 2), t.state.development, start.projectId!, 'test');
      // The held fee is refunded in full.
      expect(treasury.balanceCents).toBe(money0);
      expect(t.state.inventories.get('treasury:0:timber')).toBe(timber0);
      expect(t.state.reclaimed).toHaveLength(0);
    } finally { t.db.close(); }
  });

  it('allows one active project at a time and enforces the cooldown', () => {
    const t = town();
    try {
      const rs = rules(t.scenario, { cooldownDays: 10 });
      const first = startDevelopment(ctx(t.state, t.scenario), t.state.development, rs, { actorId: t.councillorId, kind: 'reclamation' });
      expect(first.ok).toBe(true);
      const second = startDevelopment(ctx(t.state, t.scenario), t.state.development, rs, { actorId: t.councillorId, kind: 'reclamation' });
      expect(second).toEqual({ ok: false, reason: 'reclamation_in_progress' });
      cancelDevelopment(ctx(t.state, t.scenario, 5), t.state.development, first.projectId!, 'test');
      expect(startDevelopment(ctx(t.state, t.scenario, 8), t.state.development, rs, { actorId: t.councillorId, kind: 'reclamation' }))
        .toEqual({ ok: false, reason: 'reclamation_cooldown' });
      expect(startDevelopment(ctx(t.state, t.scenario, 16), t.state.development, rs, { actorId: t.councillorId, kind: 'reclamation' }).ok).toBe(true);
    } finally { t.db.close(); }
  });

  it('is deterministic: same world, same site', () => {
    const a = town();
    const b = town();
    try {
      const ra = startDevelopment(ctx(a.state, a.scenario), a.state.development, rules(a.scenario), { actorId: a.councillorId, kind: 'reclamation' });
      const rb = startDevelopment(ctx(b.state, b.scenario), b.state.development, rules(b.scenario), { actorId: b.councillorId, kind: 'reclamation' });
      const pa = a.state.development.projects.get(ra.projectId!)!;
      const pb = b.state.development.projects.get(rb.projectId!)!;
      expect([pa.reclaimTx, pa.reclaimTy, pa.reclaimSize]).toEqual([pb.reclaimTx, pb.reclaimTy, pb.reclaimSize]);
    } finally { a.db.close(); b.db.close(); }
  });
});

describe('safety of the chosen site', () => {
  it('never covers the sea in front of a fishery, and joins the coast', () => {
    const t = town();
    try {
      const start = startDevelopment(ctx(t.state, t.scenario), t.state.development, rules(t.scenario), { actorId: t.councillorId, kind: 'reclamation' });
      expect(start.ok).toBe(true);
      const p = t.state.development.projects.get(start.projectId!)!;
      const size = p.reclaimSize!;
      const placement = [...t.state.buildings.values()].sort((x, y) => x.id - y.id)
        .map((b) => ({ id: b.id, placement: b.kind === 'fishery' ? 'shore' as const : 'land' as const }));
      const layout = layoutTown(t.state.seed, placement, [], t.state.terrain, t.state.reclaimed);
      for (const lot of layout.lots) {
        if (!placement.find((b) => b.id === lot.buildingId && b.placement === 'shore')) continue;
        // The patch square must stay clear of the whole dock rectangle (lot + clearance both sides).
        const c = DEFAULT_RECLAMATION.dockClearanceTiles;
        const x0 = lot.tx - c, y0 = lot.ty - c, span = 3 + c * 2 + 3;
        const overlap = p.reclaimTx! < x0 + span && p.reclaimTx! + size > x0 && p.reclaimTy! < y0 + span && p.reclaimTy! + size > y0;
        expect(overlap, `patch overlaps the dock of building ${lot.buildingId}`).toBe(false);
      }
      const field = layout.field;
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) expect(field.seedLand(p.reclaimTx! + x, p.reclaimTy! + y)).toBe(false);
    } finally { t.db.close(); }
  });

  it('never moves an existing building: new land only serves buildings created afterwards', () => {
    const t = town();
    try {
      const ids = [...t.state.buildings.keys()].sort((a, b) => a - b);
      const layoutOf = (patches: typeof t.state.reclaimed) => {
        const input = ids.map((id) => ({ id, placement: t.state.buildings.get(id)!.kind === 'fishery' ? 'shore' as const : 'land' as const }));
        return layoutTown(t.state.seed, input, [], t.state.terrain, patches).lots.map((l) => `${l.buildingId}:${l.tx},${l.ty}`);
      };
      const before = layoutOf([]);
      const next = t.state.nextIds.building ?? 1;
      const patch = { id: 1, projectId: 1, tx: -400, ty: -400, size: 12, fromBuildingId: next, completedDay: 5 };
      expect(layoutOf([patch])).toEqual(before);
      // A building created after the patch may use it; the existing ones are unchanged.
      const withNew = layoutTown(t.state.seed, [...ids.map((id) => ({ id, placement: 'land' as const })), { id: next, placement: 'land' as const }], [], t.state.terrain, [patch]);
      expect(withNew.field.limitForBuilding(next)).toBe(1);
      expect(withNew.field.limitForBuilding(next - 1)).toBe(0);
    } finally { t.db.close(); }
  });
});

describe('persistence and hashing', () => {
  it('a state with no patches hashes exactly as before; patches change the hash', () => {
    const t = town();
    try {
      const h0 = stateHash(t.state);
      t.state.reclaimed = [];
      expect(stateHash(t.state)).toBe(h0);
      t.state.reclaimed = [{ id: 1, projectId: 1, tx: 5, ty: 5, size: 12, fromBuildingId: 30, completedDay: 9 }];
      expect(stateHash(t.state)).not.toBe(h0);
    } finally { t.db.close(); }
  });

  it('patches survive a save and reload, are append-only, and the terrain is restored', () => {
    const t = town({ terrain: 'coast' });
    try {
      t.state.reclaimed = [{ id: 1, projectId: 1, tx: 5, ty: 5, size: 12, fromBuildingId: 30, completedDay: 9 }];
      const world = t.db.get<{ id: number }>('select id from worlds')!;
      saveState(t.db, t.state, { events: [], ledger: [], flows: [], observations: [], memories: [], taxRecords: [], shipping: [], articles: [], metrics: null, phase: 'idle', stateHash: stateHash(t.state) });
      const row = t.db.get<{ id: number; name: string; seed: string; rulesVersion: string; drama: 'calm'; populationTarget: number; populationPolicyEnabled: number; hostCeiling: number; currentDay: number; phase: string; stateHash: string; configJson: string; createdAt: string }>(
        `select id, name, seed, rules_version as rulesVersion, drama, population_target as populationTarget, population_policy_enabled as populationPolicyEnabled,
                host_ceiling as hostCeiling, current_day as currentDay, phase, state_hash as stateHash, config_json as configJson, created_at as createdAt from worlds where id = ?`, [world.id])!;
      const reloaded = loadState(t.db, row as never);
      expect(reloaded.reclaimed).toEqual(t.state.reclaimed);
      expect(reloaded.terrain).toBe('coast');
      t.state.reclaimed = [];
      expect(() => saveState(t.db, t.state, { events: [], ledger: [], flows: [], observations: [], memories: [], taxRecords: [], shipping: [], articles: [], metrics: null, phase: 'idle', stateHash: 'x' })).toThrow(/cannot shrink/);
    } finally { t.db.close(); }
  });
});
