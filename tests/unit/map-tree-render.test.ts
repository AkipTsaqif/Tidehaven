import { describe, expect, it } from 'vitest';
import { sceneryPoint, segmentInView } from '../../client/src/map-scenery.js';

// Pure projection helper shared by paths and tree bases: it must agree with lotPivot in TownMap.
describe('map scenery projection', () => {
  it('culls off-screen trails but keeps crossings and brush-sized edge overlaps', () => {
    const view = { left: 0, right: 100, top: 0, bottom: 100 };
    expect(segmentInView({ x: -50, y: -50 }, { x: -20, y: -20 }, view)).toBe(false);
    expect(segmentInView({ x: -50, y: 50 }, { x: 150, y: 50 }, view)).toBe(true);
    expect(segmentInView({ x: -3, y: 10 }, { x: -3, y: 20 }, view)).toBe(true);
    expect(segmentInView({ x: 30, y: 105 }, { x: 50, y: 105 }, view)).toBe(false);
  });

  it('matches the building pivot for the same world tile location', () => {
    const terrain = { x0: -72, y0: -48, height: 97 };
    // Irregular lot origin (7,-5): its bottom vertex is tile (10,-2).
    const p = sceneryPoint({ x: 10, y: -2 }, terrain);
    const tx = 7 - terrain.x0;
    const ty = -5 - terrain.y0;
    expect(p).toEqual({ x: terrain.height * 16 + (tx - ty) * 16, y: (tx + ty + 6) * 8 + 56 });
  });

  it('projects fractional scenery locations without changing their tile offsets', () => {
    const t = { x0: 0, y0: 0, height: 10 };
    const a = sceneryPoint({ x: 0.5, y: 0.5 }, t);
    const b = sceneryPoint({ x: 1.5, y: 0.5 }, t);
    expect(b.x - a.x).toBe(16);
    expect(b.y - a.y).toBe(8);
  });
});
