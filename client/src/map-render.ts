import { useEffect, useMemo, useState } from 'react';
import { getJson } from './api.js';
import { normalizeAtlas, type Atlas, type Footprint } from './map-assets.js';
export type { Atlas } from './map-assets.js';
import {
  drawRoads, drawTreeShadow, sceneryPoint, treeSprite, TREE_PIVOT, type MapRoad, type MapTree,
} from './map-scenery.js';

/**
 * Shared town-map data and drawing, used by the interactive Map tab and the read-only Overview
 * thumbnail. Both draw through `drawTown`, so they can never disagree about what the town looks like.
 */

export interface Terrain {
  x0: number;
  y0: number;
  width: number;
  height: number;
  rows: string[];
}

export interface MapLot {
  key: string;
  tx: number;
  ty: number;
  frame: string | null;
  footprint?: Footprint;
  kind: string;
  tier: 1 | 2 | 3;
  name: string;
  buildingId: number | null;
  capacity: number;
  conditionPct: number | null;
  destroyed: boolean;
  plannedKind: string | null;
  business: { name: string; kind: string; status: string; staff: number } | null;
  residents: number;
  households: number;
}

export interface MapResponse {
  world: { name: string; seed: string; scenarioVersion: string; day: number } | null;
  biome: string;
  terrainShape: 'island' | 'coast' | 'river_plain';
  tile: { width: number; height: number; lotTiles: number };
  terrain: Terrain | null;
  lots: MapLot[];
  roads: MapRoad[];
  trees: MapTree[];
  roadTargetsOmitted: number;
  unplaced: { buildings: number; camps: number };
  truncated: { buildings: number; camps: number };
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

export type TownObject =
  | { depth: number; lot: MapLot; tree?: never }
  | { depth: number; tree: MapTree; lot?: never };

export const HALF_W = 16;
export const HALF_H = 8;
export const SCALES = [0.5, 1, 2, 3, 4];
/** Headroom above the terrain's top row so the tallest sprites on it are not cut off. */
export const TOP = 56;

const PALETTES: Record<string, Record<string, [string, string]>> = {
  tropical: { '~': ['#155766', '#175e6d'], '-': ['#2a9a98', '#36b2a1'], '.': ['#e2c58a', '#d6b16b'], g: ['#5ea84a', '#6db34e'], '#': ['#c9a46c', '#b58a52'] },
  temperate: { '~': ['#1c4a7c', '#1f5083'], '-': ['#3a7ab0', '#4a90c0'], '.': ['#d9c294', '#c9b07a'], g: ['#6a9a48', '#73a04d'], '#': ['#a47a4e', '#93693f'] },
  arid: { '~': ['#1b5871', '#1e5f78'], '-': ['#3f98a6', '#53aeb2'], '.': ['#ecd29a', '#e0c084'], g: ['#d6b16b', '#c9a35e'], '#': ['#b58a52', '#a47a46'] },
  northern: { '~': ['#294967', '#2c4f6e'], '-': ['#56839c', '#6d9bb1'], '.': ['#c8c3ad', '#b5b09a'], g: ['#7a8f64', '#82966a'], '#': ['#8e7d64', '#7d6d56'] },
};

function decodeRow(row: string): string[] {
  const out: string[] = [];
  const pattern = /(\D)(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(row)) !== null) {
    const count = Number(match[2]);
    for (let i = 0; i < count; i += 1) out.push(match[1]!);
  }
  return out;
}

/** Light per-tile variation so grass and sand are not flat colour. */
function tileNoise(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) % 7;
}

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Terrain as an image with ONE PIXEL PER TILE. The renderer draws it through the isometric affine
 * transform (16, 8, -16, 8), so each pixel becomes an exact 32x16 diamond: cheap at any town size and
 * free of seams between tiles.
 */
export function terrainImage(terrain: Terrain, biome: string): HTMLCanvasElement {
  const palette = PALETTES[biome] ?? PALETTES.tropical!;
  const image = document.createElement('canvas');
  image.width = terrain.width;
  image.height = terrain.height;
  const ctx = image.getContext('2d')!;
  const pixels = ctx.createImageData(terrain.width, terrain.height);
  terrain.rows.forEach((row, y) => {
    decodeRow(row).forEach((code, x) => {
      const colours = palette[code] ?? palette.g!;
      const alternate = colours[1] && tileNoise(terrain.x0 + x, terrain.y0 + y) === 0;
      const [r, g, b] = parseHex(alternate ? colours[1] : colours[0]);
      const offset = (y * terrain.width + x) * 4;
      pixels.data[offset] = r;
      pixels.data[offset + 1] = g;
      pixels.data[offset + 2] = b;
      pixels.data[offset + 3] = 255;
    });
  });
  ctx.putImageData(pixels, 0, 0);
  return image;
}

/** Screen position (in terrain-canvas pixels) of a lot's bottom vertex: the sprite pivot. */
export function lotPivot(lot: MapLot, terrain: Terrain, lotTiles: number): { x: number; y: number } {
  const originX = (terrain.height - 1) * HALF_W + HALF_W;
  const tx = lot.tx - terrain.x0;
  const ty = lot.ty - terrain.y0;
  const f = lot.footprint ?? { w: lotTiles, d: lotTiles };
  return { x: originX + (tx + f.w - ty - f.d) * HALF_W, y: (tx + ty + f.w + f.d) * HALF_H };
}

export interface TownDrawParams {
  data: MapResponse;
  terrain: Terrain;
  ground: HTMLCanvasElement;
  atlas: Atlas | null;
  sheet: HTMLImageElement | null;
  objects: TownObject[];
  view: View;
  size: { w: number; h: number };
  /** Lot key to outline. Leave undefined for a view-only map, where nothing can be selected. */
  selected?: string | null;
}

/** Terrain, trails, trees and buildings in one depth-ordered painter's pass. */
export function drawTown(el: HTMLCanvasElement, p: TownDrawParams): void {
  const { data, terrain, ground, atlas, sheet, objects, view, size, selected } = p;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(size.w * dpr);
  const height = Math.round(size.h * dpr);
  if (el.width !== width) el.width = width;
  if (el.height !== height) el.height = height;
  const ctx = el.getContext('2d');
  if (!ctx) return;
  const palette = PALETTES[data.biome] ?? PALETTES.tropical!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = palette['~']![0];
  ctx.fillRect(0, 0, el.width, el.height);
  ctx.imageSmoothingEnabled = false;
  const s = view.scale * dpr;
  const originX = (terrain.height - 1) * HALF_W + HALF_W;
  // Tile (x, y) of the 1-px-per-tile image -> its diamond's top vertex.
  ctx.setTransform(HALF_W * s, HALF_H * s, -HALF_W * s, HALF_H * s, view.x * dpr + originX * s, view.y * dpr + TOP * s);
  ctx.drawImage(ground, 0, 0);
  ctx.setTransform(s, 0, 0, s, view.x * dpr, view.y * dpr);
  drawRoads(ctx, data.roads, terrain, data.biome, {
    left: -view.x / view.scale, right: (size.w - view.x) / view.scale,
    top: -view.y / view.scale, bottom: (size.h - view.y) / view.scale,
  });
  const frames = atlas?.biomes[data.biome]?.frames;
  if (!sheet || !frames || !atlas) return;
  const left = -view.x / view.scale;
  const right = (size.w - view.x) / view.scale;
  const top = -view.y / view.scale;
  const bottom = (size.h - view.y) / view.scale;
  // Shadows are ground-level; every object then shares one painter's order so trees behind a
  // building disappear correctly while trees in front can overlap it naturally.
  for (const tree of data.trees) {
    const point = sceneryPoint(tree, terrain);
    if (point.x + 24 < left || point.x - 24 > right || point.y < top || point.y - 48 > bottom) continue;
    drawTreeShadow(ctx, point);
  }
  for (const object of objects) {
    if (object.tree) {
      const point = sceneryPoint(object.tree, terrain);
      if (point.x + 24 < left || point.x - 24 > right || point.y < top || point.y - 48 > bottom) continue;
      ctx.drawImage(treeSprite(data.biome, object.tree), Math.round(point.x) - TREE_PIVOT.x, Math.round(point.y) - TREE_PIVOT.y);
      continue;
    }
    const lot = object.lot;
    const frame = lot.frame ? frames[lot.frame] : undefined;
    if (!frame) continue;
    const pivot = lotPivot(lot, terrain, data.tile.lotTiles);
    const dx = pivot.x - frame.pivot.x, dy = pivot.y + TOP - frame.pivot.y;
    if (dx + frame.rect.w < left || dx > right || dy + frame.rect.h < top || dy > bottom) continue;
    ctx.drawImage(sheet, frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h,
      dx, dy, frame.rect.w, frame.rect.h);
    if (selected !== undefined && lot.key === selected) {
      const fp = lot.footprint ?? frame.footprint;
      const topX = terrain.height * HALF_W + (lot.tx - terrain.x0 - lot.ty + terrain.y0) * HALF_W;
      const topY = (lot.tx - terrain.x0 + lot.ty - terrain.y0) * HALF_H + TOP;
      ctx.strokeStyle = '#f2d064';
      ctx.lineWidth = 1 / view.scale;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(topX + fp.w * HALF_W, topY + fp.w * HALF_H);
      ctx.lineTo(pivot.x, pivot.y + TOP);
      ctx.lineTo(topX - fp.d * HALF_W, topY + fp.d * HALF_H);
      ctx.closePath();
      ctx.stroke();
    }
  }
}

/** Depth-sorted buildings and trees; recompute only when the scene changes, never per frame. */
export function sortTownObjects(data: MapResponse): TownObject[] {
  const entries: TownObject[] = [
    ...data.lots.map((lot) => ({ depth: lot.tx + lot.ty + (lot.footprint?.w ?? data.tile.lotTiles) + (lot.footprint?.d ?? data.tile.lotTiles), lot })),
    ...data.trees.map((tree) => ({ depth: tree.x + tree.y, tree })),
  ];
  return entries.sort((a, b) => a.depth - b.depth || (a.tree ? 0 : 1) - (b.tree ? 0 : 1));
}

/**
 * Choose a zoom and offset that frames the town's buildings in a box. The full map never fits
 * below 1x (so a lone outlying fishery cannot shrink the town to specks); a small thumbnail passes
 * a lower `minScale` so it can show the whole town.
 */
export function computeFit(data: MapResponse, terrain: Terrain, box: { w: number; h: number }, minScale = 1, atlas?: Atlas | null): View {
  const pixelWidth = (terrain.width + terrain.height) * HALF_W;
  const pixelHeight = (terrain.width + terrain.height) * HALF_H + 112;
  const placed = data.lots.map((lot) => lotPivot(lot, terrain, data.tile.lotTiles));
  const xs = placed.map((p) => p.x);
  const ys = placed.map((p) => p.y);
  const bounds = placed.map((pivot, n) => {
    const lot = data.lots[n]!;
    const frame = lot.frame ? atlas?.biomes[data.biome]?.frames[lot.frame] : undefined;
    return frame
      ? { left: pivot.x - frame.pivot.x, right: pivot.x - frame.pivot.x + frame.rect.w,
        top: pivot.y - frame.pivot.y, bottom: pivot.y - frame.pivot.y + frame.rect.h }
      : { left: pivot.x - 96, right: pivot.x + 96, top: pivot.y - 130, bottom: pivot.y + 30 };
  });
  const minX = xs.length ? Math.min(...bounds.map((b) => b.left)) - 16 : 0;
  const maxX = xs.length ? Math.max(...bounds.map((b) => b.right)) + 16 : pixelWidth;
  const minY = ys.length ? Math.min(...bounds.map((b) => b.top)) - 16 : 0;
  const maxY = ys.length ? Math.max(...bounds.map((b) => b.bottom)) + 16 : pixelHeight;
  // A single tall frame must be allowed to fit below1x; otherwise Fit would cut off its crown.
  const tallest = bounds.reduce((height, b) => Math.max(height, b.bottom - b.top + 32), 0);
  const minimum = tallest > box.h ? Math.min(minScale, 0.5) : minScale;
  const fits = SCALES.filter((s) => s >= minimum && (maxX - minX) * s <= box.w && (maxY - minY) * s <= box.h);
  const allFit = fits.length > 0;
  const scale = allFit ? fits[fits.length - 1]! : minimum;
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const cx = allFit || xs.length === 0 ? (minX + maxX) / 2 : median(xs);
  const cy = allFit || ys.length === 0 ? (minY + maxY) / 2 : median(ys) - 50;
  return { scale, x: Math.round(box.w / 2 - cx * scale), y: Math.round(box.h / 2 - (cy + TOP) * scale) };
}

/** Loads /api/map, the sprite atlas and the biome's sprite sheet. Read-only: it never sends commands. */
export function useTownMap(revision: number): {
  data: MapResponse | null;
  atlas: Atlas | null;
  sheet: HTMLImageElement | null;
  ground: HTMLCanvasElement | null;
  objects: TownObject[];
  error: string | null;
} {
  const [data, setData] = useState<MapResponse | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getJson<MapResponse>('/api/map')
      .then((next) => current && setData(next))
      .catch((err: Error) => current && setError(err.message));
    return () => { current = false; };
  }, [revision]);

  useEffect(() => {
    let current = true;
    getJson<unknown>('/map/atlas.json')
      .then(normalizeAtlas)
      .then((next) => current && setAtlas(next))
      .catch((err: Error) => current && setError(`sprite atlas: ${err.message}`));
    return () => { current = false; };
  }, []);

  const biome = data?.biome ?? 'tropical';
  useEffect(() => {
    const entry = atlas?.biomes[biome];
    if (!entry) return;
    const image = new Image();
    image.onload = () => setSheet(image);
    image.onerror = () => setError(`could not load ${entry.image}`);
    image.src = entry.image;
  }, [atlas, biome]);

  const terrain = data?.terrain ?? null;
  const ground = useMemo(() => (terrain ? terrainImage(terrain, biome) : null), [terrain, biome]);
  const objects = useMemo(() => (data ? sortTownObjects(data) : []), [data]);
  return { data, atlas, sheet, ground, objects, error };
}
