import { describe, expect, it } from 'vitest';
import {
  IslandField,
  LOT_TILES,
  layoutTown,
  type LayoutBuilding,
} from '../../src/application/map-layout.js';
import {
  MAX_ROAD_TARGETS,
  MAX_ROAD_POINTS,
  MAX_TREES,
  buildMapScene,
} from '../../src/application/map-scenery.js';

const SEED = 'tidehaven-scenery-39146379';

function buildings(count: number): LayoutBuilding[] {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, placement: 'land' as const }));
}

function lotContains(tx: number, ty: number, x: number, y: number): boolean {
  const x0 = tx;
  const y0 = ty;
  return x >= x0 && x < x0 + LOT_TILES && y >= y0 && y < y0 + LOT_TILES;
}

describe('map scenery', () => {
  it('is deterministic for one seed and changes with another seed', () => {
    const layout = layoutTown(SEED, buildings(48), [7001, 7002]);
    const same = buildMapScene(SEED, layout);
    expect(buildMapScene(SEED, layout)).toEqual(same);

    const otherSeed = 'another-scenery-world';
    // Isolate scenery randomness from placement: even on identical lots/coast, another seed
    // changes paths/vegetation, and scene generation never mutates the input lots.
    const before = structuredClone(layout.lots);
    const alternate = buildMapScene(otherSeed, layout);
    expect(alternate.roads).not.toEqual(same.roads);
    expect(alternate.trees).not.toEqual(same.trees);
    expect(layout.lots).toEqual(before);
    expect(buildMapScene(otherSeed, layoutTown(otherSeed, buildings(48), [7001, 7002]))).not.toEqual(same);
  });

  it('keeps every route point on land and outside every full lot footprint', () => {
    const layout = layoutTown(SEED, buildings(64), [7001, 7002]);
    const scene = buildMapScene(SEED, layout);
    const field = new IslandField(SEED);
    expect(scene.roads.length).toBeGreaterThan(0);

    for (const road of scene.roads) {
      expect(road.points.length).toBeGreaterThan(0);
      for (const [index, point] of road.points.entries()) {
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        expect(point.x - (x + 0.5)).toBeGreaterThanOrEqual(-0.1);
        expect(point.x - (x + 0.5)).toBeLessThanOrEqual(0.1);
        if (index === 0) {
          // First point touches the high-j boundary of the actual building lot.
          expect(point.y).toBe(y);
          expect(layout.lots.some((lot) => point.x === lot.tx + 1.5 && point.y === lot.ty + LOT_TILES)).toBe(true);
        } else {
          expect(point.y - (y + 0.5)).toBeGreaterThanOrEqual(-0.1);
          expect(point.y - (y + 0.5)).toBeLessThanOrEqual(0.1);
        }
        expect(field.land(x, y)).toBe(true);
        expect(layout.lots.some((lot) => lotContains(lot.tx, lot.ty, x, y))).toBe(false);
      }
      // Points alone cannot catch a diagonal shortcut through a building or the sea.
      for (let n = 1; n < road.points.length; n += 1) {
        const a = road.points[n - 1]!;
        const b = road.points[n]!;
        for (let step = 1; step < 20; step += 1) {
          const x = a.x + (b.x - a.x) * step / 20;
          const y = a.y + (b.y - a.y) * step / 20;
          expect(field.land(Math.floor(x), Math.floor(y))).toBe(true);
          expect(layout.lots.some((lot) => lotContains(lot.tx, lot.ty, x, y))).toBe(false);
        }
      }
    }
  });

  it('keeps trees on unused land with one tile of sea, path, and lot clearance', () => {
    const layout = layoutTown(SEED, buildings(64), [7001, 7002]);
    const scene = buildMapScene(SEED, layout);
    const field = new IslandField(SEED);
    const roadCells = new Set(scene.roads.flatMap((road) => road.points.map((point) => `${Math.floor(point.x)},${Math.floor(point.y)}`)));
    expect(scene.trees.length).toBeGreaterThan(0);

    for (const tree of scene.trees) {
      expect(tree.size).toBeGreaterThanOrEqual(1);
      expect(tree.size).toBeLessThanOrEqual(3);
      expect(tree.variant).toBeGreaterThanOrEqual(0);
      expect(tree.variant).toBeLessThanOrEqual(3);
      const x = Math.floor(tree.x);
      const y = Math.floor(tree.y);
      expect(tree.x - (x + 0.5)).toBeGreaterThanOrEqual(-0.1);
      expect(tree.x - (x + 0.5)).toBeLessThanOrEqual(0.1);
      expect(tree.y - (y + 0.5)).toBeGreaterThanOrEqual(-0.1);
      expect(tree.y - (y + 0.5)).toBeLessThanOrEqual(0.1);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          expect(field.land(x + dx, y + dy)).toBe(true);
          expect(roadCells.has(`${x + dx},${y + dy}`)).toBe(false);
          expect(layout.lots.some((lot) => lotContains(lot.tx, lot.ty, x + dx, y + dy))).toBe(false);
        }
      }
    }
  });

  it('uses diagonal routes across open ground instead of painting a rectangular road carpet', () => {
    const layout = layoutTown('tidehaven-founding-39146379', buildings(25), []);
    const scene = buildMapScene('tidehaven-founding-39146379', layout);
    expect(scene.roadTargetsOmitted).toBe(0);
    const cells = scene.roads.flatMap((road) => road.points.slice(1));
    expect(cells.some((p, n) => {
      const a = cells[n - 1];
      return a && Math.abs(Math.floor(p.x) - Math.floor(a.x)) === 1 && Math.abs(Math.floor(p.y) - Math.floor(a.y)) === 1;
    })).toBe(true);
    expect(scene.terrain.rows.join('')).not.toContain('#');
  });

  it('keeps tree candidates stable when terrain bounds expand and uses sparser arid vegetation', () => {
    const layout = layoutTown(SEED, buildings(4), []);
    const small = buildMapScene(SEED, layout, 'tropical');
    const expanded = buildMapScene(SEED, { ...layout, lots: [...layout.lots, { tx: -80, ty: 0, buildingId: 500, householdId: null }] }, 'tropical');
    const keys = new Set(expanded.trees.map((t) => `${t.x},${t.y}`));
    for (const tree of small.trees) expect(keys.has(`${tree.x},${tree.y}`)).toBe(true);
    expect(buildMapScene(SEED, layout, 'arid').trees.length).toBeLessThan(small.trees.length);
  });

  it('does not let an isolated shore-first building strand the inland town', () => {
    const seed = 'scenery-sweep-0';
    const input: LayoutBuilding[] = buildings(80).map((b, i) => ({ ...b, placement: i % 8 === 0 ? 'shore' : 'land' }));
    const scene = buildMapScene(seed, layoutTown(seed, input, []));
    expect(scene.roads.length).toBeGreaterThan(60);
    expect(scene.roadTargetsOmitted).toBeLessThan(20);
  });

  it('handles empty towns and reports caps without inventing paths', () => {
    const scene = buildMapScene(SEED, layoutTown(SEED, [], []));
    expect(scene.roads).toEqual([]);
    expect(scene.roadTargetsOmitted).toBe(0);
    expect(scene.trees.length).toBeGreaterThan(0);
  });

  it('reports omitted targets and stays within scenery caps', () => {
    const layout = layoutTown(SEED, buildings(5000), []);
    const scene = buildMapScene(SEED, layout);
    const buildingCount = layout.lots.filter((lot) => lot.buildingId !== null).length;
    expect(scene.roads.length).toBeLessThanOrEqual(MAX_ROAD_TARGETS);
    expect(scene.trees.length).toBeLessThanOrEqual(MAX_TREES);
    expect(scene.roads.reduce((n, road) => n + road.points.length, 0)).toBeLessThanOrEqual(MAX_ROAD_POINTS);
    expect(scene.roadTargetsOmitted).toBe(buildingCount - scene.roads.length);
  });
});
