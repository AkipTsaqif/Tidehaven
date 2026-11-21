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

describe('multi-page atlas v3', () => {
  const page = (image: string) => ({ image, width: 1024, height: 512 });
  const v3 = () => ({
    version: 3,
    tile: { w: 32, h: 16 },
    biomes: {
      tropical: {
        pages: [page('/map/atlas-tropical-0.png'), page('/map/atlas-tropical-1.png')],
        frames: {
          home_1: { page: 0, rect: { x: 2, y: 2, w: 96, h: 104 }, pivot: { x: 48, y: 104 }, footprint: { w: 3, d: 3 }, assetClass: 'building' },
          overlay: { page: 1, rect: { x: 2, y: 2, w: 20, h: 12 }, pivot: { x: 52, y: 100 }, footprint: { w: 3, d: 3 }, assetClass: 'overlay',
            trim: { x: 30, y: 70, w: 104, h: 104 } },
        },
      },
    },
  });

  it('reads pages and gives every frame the image of the page it lives on', () => {
    const atlas = normalizeAtlas(v3());
    const biome = atlas.biomes.tropical!;
    expect(biome.pages.map((p) => p.image)).toEqual(['/map/atlas-tropical-0.png', '/map/atlas-tropical-1.png']);
    expect(biome.frames.home_1!.page).toBe(0);
    expect(biome.frames.overlay!.page).toBe(1);
  });

  it('keeps the canvas size and offset of a trimmed frame so its pivot still means the same thing', () => {
    const f = normalizeAtlas(v3()).biomes.tropical!.frames.overlay!;
    expect(f.rect).toMatchObject({ w: 20, h: 12 });
    expect(f.trim).toEqual({ x: 30, y: 70, w: 104, h: 104 });
    // Drawn at sprite origin + trim offset: the pivot is still measured on the full canvas.
    // 3x3 lot at tile (0,0): bottom vertex is (0, 48). Origin = bottom - pivot = (-52, -52).
    // The crop then sits at origin + trim offset (30, 70), with the CROPPED size.
    expect(spriteBounds(0, 0, f)).toEqual({ x: -52 + 30, y: 48 - 100 + 70, w: 20, h: 12 });
  });

  it('upgrades v1 and v2 atlases to a single page so old files keep working', () => {
    const v2 = normalizeAtlas(JSON.parse(readFileSync('client/public/map/atlas.json', 'utf8')));
    expect(v2.biomes.tropical!.pages).toHaveLength(1);
    expect(v2.biomes.tropical!.frames.home_1!.page).toBe(0);
    expect(v2.biomes.tropical!.frames.home_1!.trim).toBeUndefined();
  });

  it('rejects a frame pointing at a missing page, a bad page image, or a trim that does not fit', () => {
    const missing = v3();
    missing.biomes.tropical.frames.home_1.page = 2;
    expect(() => normalizeAtlas(missing)).toThrow();
    const badImage = v3();
    badImage.biomes.tropical.pages[1]!.image = '/evil/../x.png';
    expect(() => normalizeAtlas(badImage)).toThrow();
    const noPages = v3();
    noPages.biomes.tropical.pages = [];
    expect(() => normalizeAtlas(noPages)).toThrow();
    const badTrim = v3();
    badTrim.biomes.tropical.frames.overlay.trim = { x: 100, y: 0, w: 20, h: 12 };
    expect(() => normalizeAtlas(badTrim)).toThrow();
  });
});
