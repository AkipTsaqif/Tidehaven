import { describe, expect, it } from 'vitest';
import { IslandField, layoutTown, resolveMapOptions, savedMapOptions, buildTerrain } from '../../src/application/map-layout.js';
import { buildMapScene } from '../../src/application/map-scenery.js';
import { MAP_TERRAINS } from '../../src/contracts/map.js';

const seed = 'landscape-shapes';
describe('founding landscape choices', () => {
  it('resolves explicit choices and auto reproducibly; Eden always tropical', () => {
    expect(resolveMapOptions('custom', seed, { biome: 'arid', terrain: 'river_plain' })).toEqual({ biome: 'arid', terrain: 'river_plain' });
    expect(resolveMapOptions('eden-growth-1', seed, { biome: 'northern', terrain: 'coast' })).toEqual({ biome: 'tropical', terrain: 'coast' });
    expect(resolveMapOptions('custom', seed, { biome: 'auto', terrain: 'auto' })).toEqual(resolveMapOptions('custom', seed, { biome: 'auto', terrain: 'auto' }));
    const choices = new Set(Array.from({ length: 40 }, (_, n) => resolveMapOptions('custom', `shape-${n}`, { terrain: 'auto' }).terrain));
    expect(choices.size).toBe(MAP_TERRAINS.length);
  });

  it('preserves explicit stored choices even if town name changes, with legacy defaults', () => {
    expect(savedMapOptions({ map: { biome: 'northern', terrain: 'river_plain' } }, 'custom', seed, 'Eden')).toEqual({ biome: 'northern', terrain: 'river_plain' });
    expect(savedMapOptions({}, 'eden-growth-1', seed, 'Eden')).toEqual({ biome: 'tropical', terrain: 'island' });
    expect(savedMapOptions({ map: { biome: 'bad', terrain: 'bad' } }, 'custom', seed, 'Town').terrain).toBe('island');
  });
});

describe('terrain shapes', () => {
  it('distinguishes an enclosed island, mainland coast and plain crossed by rivers', () => {
    const island = new IslandField(seed, 'island');
    expect(island.land(-150, 0)).toBe(false);
    expect(island.land(0, -150)).toBe(false);
    const coast = new IslandField(seed, 'coast');
    expect(coast.land(-150, 0)).toBe(true);
    expect(coast.land(-150, -150)).toBe(true);
    expect(coast.land(150, 0)).toBe(false);
    const plain = new IslandField(seed, 'river_plain');
    expect(plain.land(-150, 0)).toBe(true);
    expect(plain.land(150, 0)).toBe(true);
    for (let y = -40; y <= 40; y += 1) {
      expect(Array.from({ length: 20 }, (_, x) => plain.land(x, y)).some((land) => !land)).toBe(true);
      expect(Array.from({ length: 20 }, (_, x) => plain.land(x - 32, y)).some((land) => !land)).toBe(true);
    }
  });

  for (const terrain of MAP_TERRAINS) {
    it(`${terrain}: seed-stable, land-only, shore fisheries and no unmarked water crossings`, () => {
      const input = Array.from({ length: 50 }, (_, n) => ({ id: n + 1, placement: n % 9 === 0 ? 'shore' as const : 'land' as const }));
      const layout = layoutTown(seed, input, [], terrain);
      expect(layout.lots).toEqual(layoutTown(seed, input, [], terrain).lots);
      expect(layout.unplacedBuildingIds).toEqual([]);
      for (const lot of layout.lots) expect(layout.field.lotIsLand(lot.tx, lot.ty)).toBe(true);
      const fish = layout.lots.find((l) => l.buildingId === 1)!;
      expect(layout.field.lotIsShore(fish.tx, fish.ty)).toBe(true);
      const scene = buildMapScene(seed, layout);
      for (const road of scene.roads) for (let n = 1; n < road.points.length; n += 1) {
        const a = road.points[n - 1]!, b = road.points[n]!;
        for (let t = 0; t <= 10; t += 1) expect(layout.field.land(Math.floor(a.x + (b.x - a.x) * t / 10), Math.floor(a.y + (b.y - a.y) * t / 10))).toBe(true);
      }
      expect(buildTerrain(layout).rows.length).toBeGreaterThan(0);
    });
  }
});

describe('terrain view box', () => {
  const edgeLand = (box: ReturnType<typeof buildTerrain>, field: IslandField): number => {
    const x1 = box.x0 + box.width - 1;
    const y1 = box.y0 + box.height - 1;
    let n = 0;
    for (let x = box.x0; x <= x1; x += 1) { if (field.land(x, box.y0)) n += 1; if (field.land(x, y1)) n += 1; }
    for (let y = box.y0; y <= y1; y += 1) { if (field.land(box.x0, y)) n += 1; if (field.land(x1, y)) n += 1; }
    return n;
  };
  const one = [{ id: 1, placement: 'land' as const }];

  it('never slices an islet at the edge of an island map', () => {
    for (const s of ['tidehaven-founding-39146379', 'golden-a', 'golden-b', 'seed-7', 'seed-19', 'seed-42', 'seed-99']) {
      const layout = layoutTown(s, one, [], 'island');
      expect(edgeLand(buildTerrain(layout), layout.field), s).toBe(0);
    }
  });

  it('grows to include reclaimed land, however far from the original island', () => {
    const far = [{ id: 1, projectId: 1, tx: 70, ty: 10, size: 12, fromBuildingId: 2, completedDay: 5 }];
    const without = buildTerrain(layoutTown(seed, one, [], 'island', []));
    const layout = layoutTown(seed, one, [], 'island', far);
    const box = buildTerrain(layout);
    expect(without.x0 + without.width - 1).toBeLessThan(82);
    expect(box.x0 + box.width - 1).toBeGreaterThanOrEqual(82 + 8);
    expect(box.y0 + box.height - 1).toBeGreaterThanOrEqual(22 + 8);
    // The patch is really drawn as land (a row inside the patch contains ground, not only sea).
    const row = box.rows[15 - box.y0]!;
    expect(row).toMatch(/g\d+/);
    expect(edgeLand(box, layout.field)).toBe(0);
  });

  it('stays within the size cap even for a huge reclaimed patch far away', () => {
    const huge = [{ id: 1, projectId: 1, tx: 3000, ty: 3000, size: 12, fromBuildingId: 2, completedDay: 5 }];
    const box = buildTerrain(layoutTown(seed, one, [], 'island', huge));
    expect(box.width).toBeLessThanOrEqual(768);
    expect(box.height).toBeLessThanOrEqual(768);
  });
});

describe('building spacing', () => {
  it('keeps one or two free tiles around every building, never zero and never three', () => {
    const input = Array.from({ length: 200 }, (_, n) => ({ id: n + 1, placement: 'land' as const }));
    const lots = layoutTown(seed, input, [], 'island').lots;
    const field = new IslandField(seed, 'island');
    const gaps = new Set<number>();
    for (const lot of lots) {
      const gap = field.setback(lot.tx, lot.ty);
      gaps.add(gap);
      expect(gap).toBeGreaterThanOrEqual(1);
      expect(gap).toBeLessThanOrEqual(2);
    }
    expect([...gaps].sort()).toEqual([1, 2]);
    // Real spacing between lots: at least one free tile between any two footprints.
    for (let i = 0; i < lots.length; i += 1) {
      for (let j = i + 1; j < lots.length; j += 1) {
        const a = lots[i]!, b = lots[j]!;
        const gx = Math.max(a.tx - (b.tx + 3), b.tx - (a.tx + 3));
        const gy = Math.max(a.ty - (b.ty + 3), b.ty - (a.ty + 3));
        expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('fits more buildings per area than the old 1-3 tile gaps would', () => {
    // The 200-building town must stay compact: well inside the main island, no far-islet spill.
    const input = Array.from({ length: 200 }, (_, n) => ({ id: n + 1, placement: 'land' as const }));
    const lots = layoutTown(seed, input, [], 'island').lots;
    const farthest = Math.max(...lots.map((l) => Math.hypot(l.tx + 1.5, l.ty + 1.5)));
    expect(farthest).toBeLessThan(75);
  });
});
