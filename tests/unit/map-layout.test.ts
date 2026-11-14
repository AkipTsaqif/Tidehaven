import { describe, expect, it } from 'vitest';
import {
  IslandField,
  LOT_PITCH,
  LOT_TILES,
  MAX_TERRAIN_SIDE,
  buildTerrain,
  capacityTier,
  chooseBiome,
  layoutTown,
  type LayoutBuilding,
} from '../../src/application/map-layout.js';

const SEED = 'tidehaven-founding-39146379';

function buildings(count: number, shoreEvery = 0): LayoutBuilding[] {
  return Array.from({ length: count }, (_, n) => ({
    id: n + 1,
    placement: shoreEvery > 0 && (n + 1) % shoreEvery === 0 ? 'shore' : 'land',
  }));
}

function positions(layout: ReturnType<typeof layoutTown>): Map<number, string> {
  const out = new Map<number, string>();
  for (const lot of layout.lots) if (lot.buildingId !== null) out.set(lot.buildingId, `${lot.lx},${lot.ly}`);
  return out;
}

describe('map biome and tiers', () => {
  it('matches the Lua sprite builder (B.choose) exactly, and Eden is always tropical', () => {
    // Vectors produced by running art/biomes.lua inside Aseprite.
    expect(chooseBiome('tidehaven-1', 'tidehaven-founding')).toBe('northern');
    expect(chooseBiome('tidehaven-1', 'world-1')).toBe('temperate');
    expect(chooseBiome('tidehaven-1', 'world-2')).toBe('arid');
    expect(chooseBiome('tidehaven-1', 'world-3')).toBe('northern');
    expect(chooseBiome('tidehaven-1', 'world-4')).toBe('tropical');
    expect(chooseBiome('tidehaven-1', 'world-5')).toBe('temperate');
    expect(chooseBiome('tidehaven-1', 'seed-ÿ-é')).toBe('northern');
    expect(chooseBiome('x', '')).toBe('tropical');
    expect(chooseBiome('Eden-growth-1', 'abc')).toBe('tropical');
    expect(chooseBiome('eden-growth-1', SEED)).toBe('tropical');
    expect(chooseBiome('tidehaven-1', 'world-1', 'Eden')).toBe('tropical');
  });

  it('uses the art catalog capacity thresholds', () => {
    expect([6, 7, 12, 13, 20].map((c) => capacityTier('home', c))).toEqual([1, 2, 2, 3, 3]);
    expect([3, 6, 7, 20, 21, 100].map((c) => capacityTier('farm', c))).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('map layout', () => {
  it('is deterministic for the same seed and different for another seed', () => {
    const a = positions(layoutTown(SEED, buildings(40, 7), []));
    const b = positions(layoutTown(SEED, buildings(40, 7), []));
    const c = positions(layoutTown('another-world', buildings(40, 7), []));
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  it('never moves an existing building as the town grows (prefix stability)', () => {
    const all = buildings(160, 9);
    const full = positions(layoutTown(SEED, all, []));
    for (const size of [1, 5, 17, 60, 120]) {
      const partial = positions(layoutTown(SEED, all.slice(0, size), []));
      for (const [id, where] of partial) expect(full.get(id), `building ${id} at size ${size}`).toBe(where);
    }
  });

  it('places buildings in id order regardless of input order, and camps never displace buildings', () => {
    const ordered = positions(layoutTown(SEED, buildings(30), []));
    const withCamps = layoutTown(SEED, [...buildings(30)].reverse(), [3, 1, 2]);
    expect([...positions(withCamps)].sort()).toEqual([...ordered].sort());
    // The camps exist, take free lots after the buildings, and sit in household id order.
    const camps = withCamps.lots.filter((lot) => lot.householdId !== null);
    expect(camps.map((lot) => lot.householdId)).toEqual([1, 2, 3]);
    const taken = new Set([...ordered.values()]);
    for (const camp of camps) expect(taken.has(`${camp.lx},${camp.ly}`)).toBe(false);
  });

  it('keeps every lot fully on land and never overlaps two lots', () => {
    const layout = layoutTown(SEED, buildings(250, 6), [9001, 9002, 9003]);
    const field = new IslandField(SEED);
    const seen = new Set<string>();
    for (const lot of layout.lots) {
      const key = `${lot.lx},${lot.ly}`;
      expect(seen.has(key), `duplicate lot ${key}`).toBe(false);
      seen.add(key);
      for (let dy = 0; dy < LOT_TILES; dy += 1) {
        for (let dx = 0; dx < LOT_TILES; dx += 1) {
          expect(field.land(lot.lx * LOT_PITCH + dx, lot.ly * LOT_PITCH + dy), `lot ${key} tile ${dx},${dy}`).toBe(true);
        }
      }
    }
    expect(layout.unplacedBuildingIds).toEqual([]);
  });

  it('puts shore buildings (fisheries) on lots with sea along their high-i edge', () => {
    const input = buildings(60, 5);
    const layout = layoutTown(SEED, input, []);
    const field = new IslandField(SEED);
    const shoreIds = new Set(input.filter((b) => b.placement === 'shore').map((b) => b.id));
    let onShore = 0;
    for (const lot of layout.lots) {
      if (lot.buildingId === null || !shoreIds.has(lot.buildingId)) continue;
      if (field.lotIsShore(lot.lx, lot.ly)) onShore += 1;
    }
    expect(onShore).toBe(shoreIds.size);
  });

  it('grows outward from the centre: early buildings are closer than late ones', () => {
    const layout = layoutTown(SEED, buildings(120), []);
    const distance = (id: number) => {
      const lot = layout.lots.find((l) => l.buildingId === id)!;
      return Math.hypot(lot.lx, lot.ly);
    };
    const early = [1, 2, 3, 4, 5].map(distance);
    const late = [116, 117, 118, 119, 120].map(distance);
    expect(Math.max(...early)).toBeLessThan(Math.min(...late));
  });

  it('spills onto islets instead of failing when the main island is full, within bounded work', () => {
    const layout = layoutTown(SEED, buildings(1500), []);
    expect(layout.unplacedBuildingIds).toEqual([]);
    const terrain = buildTerrain(layout);
    expect(terrain.width).toBeLessThanOrEqual(MAX_TERRAIN_SIDE);
    expect(terrain.height).toBeLessThanOrEqual(MAX_TERRAIN_SIDE);
  });

  it('draws roads only beside building lots and keeps the run-length rows the right width', () => {
    const layout = layoutTown(SEED, buildings(12), [77]);
    const terrain = buildTerrain(layout);
    expect(terrain.rows).toHaveLength(terrain.height);
    for (const row of terrain.rows) {
      const total = [...row.matchAll(/(\D)(\d+)/g)].reduce((sum, m) => sum + Number(m[2]), 0);
      expect(total).toBe(terrain.width);
      expect(row).toMatch(/^([~\-.g#]\d+)+$/);
    }
    expect(terrain.rows.join('')).toContain('#');
    // A town with no buildings has no roads at all.
    expect(buildTerrain(layoutTown(SEED, [], [5])).rows.join('')).not.toContain('#');
  });
});
