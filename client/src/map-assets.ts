/** Asset geometry is independent from simulation capacity. A large picture never grants a large lot. */
export interface Footprint { w: number; d: number }
export interface AssetRect { x: number; y: number; w: number; h: number }
export interface AssetFrame {
  rect: AssetRect;
  pivot: { x: number; y: number };
  footprint: Footprint;
  assetClass: string;
}
export interface Atlas {
  version: 2;
  tile: { w: number; h: number };
  biomes: Record<string, { image: string; frames: Record<string, AssetFrame> }>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid atlas object');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid atlas geometry');
  return value;
}

/** Keep installed v1 atlases usable while accepting variable-size frames in v2. */
export function normalizeAtlas(value: unknown): Atlas {
  const root = object(value);
  if (root.version !== 1 && root.version !== 2) throw new Error('Unsupported atlas version');
  const legacy = root.version === 1;
  const tile = legacy ? { w: root.tileWidth, h: root.tileHeight } : object(root.tile);
  if (tile.w !== 32 || tile.h !== 16) throw new Error('Atlas must use 32x16 tiles');
  const biomes: Atlas['biomes'] = {};
  for (const [biome, raw] of Object.entries(object(root.biomes))) {
    const entry = object(raw);
    if (typeof entry.image !== 'string' || !/^\/map\/[a-zA-Z0-9_.-]+\.png$/.test(entry.image)) throw new Error('Invalid atlas image');
    const frames: Record<string, AssetFrame> = {};
    for (const [key, rawFrame] of Object.entries(object(entry.frames))) {
      const f = object(rawFrame);
      const cell = legacy ? object(root.cell) : object(f.rect);
      const rect = legacy ? { x: f.x, y: f.y, w: cell.w, h: cell.h } : cell;
      const w = integer(rect.w, 1, 1024), h = integer(rect.h, 1, 1024);
      const pivot = object(legacy ? root.pivot : f.pivot);
      const footprint = object(legacy ? root.footprint : f.footprint);
      frames[key] = {
        rect: { x: integer(rect.x, 0, 4096), y: integer(rect.y, 0, 4096), w, h },
        pivot: { x: integer(pivot.x, 0, w), y: integer(pivot.y, 0, h) },
        footprint: { w: integer(legacy ? footprint.i : footprint.w, 1, 16), d: integer(legacy ? footprint.j : footprint.d, 1, 16) },
        assetClass: typeof f.assetClass === 'string' ? f.assetClass : 'building',
      };
    }
    biomes[biome] = { image: entry.image, frames };
  }
  return { version: 2, tile: { w: 32, h: 16 }, biomes };
}

/** Footprint top vertex -> sprite origin. Works for rectangles as well as square tower lots. */
export function spriteBounds(tx: number, ty: number, frame: AssetFrame): AssetRect {
  const { w, d } = frame.footprint;
  const bottomX = (tx + w - ty - d) * 16;
  const bottomY = (tx + w + ty + d) * 8;
  return { x: bottomX - frame.pivot.x, y: bottomY - frame.pivot.y, w: frame.rect.w, h: frame.rect.h };
}

export function pointInFootprint(x: number, y: number, tx: number, ty: number, f: Footprint): boolean {
  // Inverse 2:1 projection into world tile coordinates.
  const i = x / 32 + y / 16;
  const j = y / 16 - x / 32;
  return i >= tx && i <= tx + f.w && j >= ty && j <= ty + f.d;
}
