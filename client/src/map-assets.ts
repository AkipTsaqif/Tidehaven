/** Asset geometry is independent from simulation capacity. A large picture never grants a large lot. */
export interface Footprint { w: number; d: number }
export interface AssetRect { x: number; y: number; w: number; h: number }
/** Where a cropped image sits inside the full sprite canvas, so the pivot keeps its meaning. */
export type AssetTrim = AssetRect;
export interface AssetFrame {
  /** Index into the biome's `pages`. */
  page: number;
  /** The rectangle on the page. For a trimmed frame this is the opaque region only. */
  rect: AssetRect;
  /** Present for a trimmed frame: its offset and the full canvas size. Absent when rect is the canvas. */
  trim?: AssetTrim;
  /** Pivot measured on the FULL canvas, never on the trimmed image. */
  pivot: { x: number; y: number };
  footprint: Footprint;
  assetClass: string;
}
export interface AtlasPage { image: string; width: number; height: number }
export interface Atlas {
  version: 3;
  tile: { w: number; h: number };
  biomes: Record<string, { pages: AtlasPage[]; frames: Record<string, AssetFrame> }>;
}

const MAX_PAGES = 16;
const MAX_PAGE = 4096;
const IMAGE_PATH = /^\/map\/[a-zA-Z0-9_.-]+\.png$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid atlas object');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid atlas geometry');
  return value;
}
function image(value: unknown): string {
  if (typeof value !== 'string' || !IMAGE_PATH.test(value) || value.includes('..')) throw new Error('Invalid atlas image');
  return value;
}

function readPages(entry: Record<string, unknown>, version: number): AtlasPage[] {
  if (version < 3) return [{ image: image(entry.image), width: MAX_PAGE, height: MAX_PAGE }];
  const raw = entry.pages;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PAGES) throw new Error('Invalid atlas pages');
  return raw.map((p) => {
    const page = object(p);
    return { image: image(page.image), width: integer(page.width, 1, MAX_PAGE), height: integer(page.height, 1, MAX_PAGE) };
  });
}

function readFrame(raw: unknown, root: Record<string, unknown>, version: number, pages: AtlasPage[]): AssetFrame {
  const legacy = version === 1;
  const f = object(raw);
  const cell = legacy ? object(root.cell) : object(f.rect);
  const rect = legacy ? { x: f.x, y: f.y, w: cell.w, h: cell.h } : cell;
  const w = integer(rect.w, 1, 1024), h = integer(rect.h, 1, 1024);
  const pivot = object(legacy ? root.pivot : f.pivot);
  const footprint = object(legacy ? root.footprint : f.footprint);
  const page = version >= 3 ? integer(f.page, 0, pages.length - 1) : 0;
  const frame: AssetFrame = {
    page,
    rect: { x: integer(rect.x, 0, MAX_PAGE), y: integer(rect.y, 0, MAX_PAGE), w, h },
    pivot: { x: 0, y: 0 },
    footprint: { w: integer(legacy ? footprint.i : footprint.w, 1, 16), d: integer(legacy ? footprint.j : footprint.d, 1, 16) },
    assetClass: typeof f.assetClass === 'string' ? f.assetClass : 'building',
  };
  const trim = version >= 3 && f.trim !== undefined ? object(f.trim) : null;
  const canvasW = trim ? integer(trim.w, 1, 1024) : w;
  const canvasH = trim ? integer(trim.h, 1, 1024) : h;
  if (trim) {
    const x = integer(trim.x, 0, canvasW), y = integer(trim.y, 0, canvasH);
    if (x + w > canvasW || y + h > canvasH) throw new Error('Atlas trim does not fit its canvas');
    frame.trim = { x, y, w: canvasW, h: canvasH };
  }
  frame.pivot = { x: integer(pivot.x, 0, canvasW), y: integer(pivot.y, 0, canvasH) };
  return frame;
}

/** Keep v1 and v2 atlases usable (one page) while accepting multi-page v3 with trimmed frames. */
export function normalizeAtlas(value: unknown): Atlas {
  const root = object(value);
  if (root.version !== 1 && root.version !== 2 && root.version !== 3) throw new Error('Unsupported atlas version');
  const version = root.version;
  const tile = version === 1 ? { w: root.tileWidth, h: root.tileHeight } : object(root.tile);
  if (tile.w !== 32 || tile.h !== 16) throw new Error('Atlas must use 32x16 tiles');
  const biomes: Atlas['biomes'] = {};
  for (const [biome, raw] of Object.entries(object(root.biomes))) {
    const entry = object(raw);
    const pages = readPages(entry, version);
    const frames: Record<string, AssetFrame> = {};
    for (const [key, rawFrame] of Object.entries(object(entry.frames))) frames[key] = readFrame(rawFrame, root, version, pages);
    biomes[biome] = { pages, frames };
  }
  return { version: 3, tile: { w: 32, h: 16 }, biomes };
}

/** Footprint top vertex -> sprite origin. Works for rectangles as well as square tower lots. */
export function spriteBounds(tx: number, ty: number, frame: AssetFrame): AssetRect {
  const { w, d } = frame.footprint;
  const bottomX = (tx + w - ty - d) * 16;
  const bottomY = (tx + w + ty + d) * 8;
  const originX = bottomX - frame.pivot.x;
  const originY = bottomY - frame.pivot.y;
  const offset = frame.trim ?? { x: 0, y: 0 };
  return { x: originX + offset.x, y: originY + offset.y, w: frame.rect.w, h: frame.rect.h };
}

export function pointInFootprint(x: number, y: number, tx: number, ty: number, f: Footprint): boolean {
  // Inverse 2:1 projection into world tile coordinates.
  const i = x / 32 + y / 16;
  const j = y / 16 - x / 32;
  return i >= tx && i <= tx + f.w && j >= ty && j <= ty + f.d;
}
