import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeAtlas, pointInFootprint, spriteBounds } from '../../client/src/map-assets.js';
import { computeFit, lotPivot, type MapResponse } from '../../client/src/map-render.js';

describe('variable asset geometry', () => {
  it('normalizes the committed atlas without losing frame dimensions', () => {
    const a = normalizeAtlas(JSON.parse(readFileSync('client/public/map/atlas.json', 'utf8')));
    expect(a.biomes.tropical!.frames.home_1!.rect).toMatchObject({ w: 96, h: 104 });
    expect(a.biomes.tropical!.frames.home_1!.pivot).toEqual({ x: 48, y: 104 });
  });
  it('reads variable v2 frames and rejects wrong scale or pivots', () => {
    const raw = { version: 2, tile: { w: 32, h: 16 }, biomes: { tropical: { image: '/map/atlas-tropical.png', frames: {
      tower: { rect: { x: 2, y: 2, w: 256, h: 768 }, pivot: { x: 128, y: 768 }, footprint: { w: 8, d: 8 }, assetClass: 'building' },
    } } } };
    const tower = normalizeAtlas(raw).biomes.tropical!.frames.tower!;
    expect(spriteBounds(0, 0, tower)).toEqual({ x: -128, y: -640, w: 256, h: 768 });
    expect(() => normalizeAtlas({ ...raw, tile: { w: 64, h: 32 } })).toThrow();
    expect(() => normalizeAtlas({ ...raw, version: 9 })).toThrow();
    raw.biomes.tropical.frames.tower.pivot.y = 769;
    expect(() => normalizeAtlas(raw)).toThrow();
  });
  it('fits and anchors a megatall without cutting its crown', () => {
    const terrain = { x0: 0, y0: 0, width: 20, height: 20, rows: [] };
    const data = { biome: 'tropical', tile: { width: 32, height: 16, lotTiles: 3 }, lots: [
      { tx: 0, ty: 0, frame: 'tower', footprint: { w: 8, d: 8 } },
    ] } as MapResponse;
    const atlas = normalizeAtlas({ version: 2, tile: { w: 32, h: 16 }, biomes: { tropical: {
      image: '/map/atlas-tropical.png', frames: { tower: { rect: { x: 2, y: 2, w: 256, h: 768 },
        pivot: { x: 128, y: 768 }, footprint: { w: 8, d: 8 } } },
    } } });
    const view = computeFit(data, terrain, { w: 800, h: 500 }, 1, atlas);
    expect(view.scale).toBe(0.5);
    const p = lotPivot(data.lots[0]!, terrain, 3);
    expect(p).toEqual({ x: 320, y: 128 });
    expect(view.y + (p.y + 56 - 768) * view.scale).toBeGreaterThanOrEqual(0);
    expect(view.y + (p.y + 56) * view.scale).toBeLessThanOrEqual(500);
  });

  it('anchors rectangular footprints correctly and hit-tests the full reserved lot', () => {
    const bridge = { rect: { x: 0, y: 0, w: 168, h: 96 }, pivot: { x: 132, y: 92 }, footprint: { w: 8, d: 2 }, assetClass: 'bridge' };
    expect(spriteBounds(0, 0, bridge)).toEqual({ x: -36, y: -12, w: 168, h: 96 });
    // Tile point (7,1) is within the8x2bridge; (7,3) is outside.
    expect(pointInFootprint((7 - 1) * 16, (7 + 1) * 8, 0, 0, bridge.footprint)).toBe(true);
    expect(pointInFootprint((7 - 3) * 16, (7 + 3) * 8, 0, 0, bridge.footprint)).toBe(false);
  });
});
