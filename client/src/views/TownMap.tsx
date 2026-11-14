import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getJson } from '../api.js';

/**
 * Bird's-eye town map. Read-only: it shows the committed town through /api/map and never sends
 * commands. Terrain is drawn as 32x16 isometric tiles; buildings are 96x104 sprites from the
 * pre-built atlas, anchored by their bottom pivot on a 3x3-tile lot.
 */

interface Terrain {
  x0: number;
  y0: number;
  width: number;
  height: number;
  rows: string[];
}

interface MapLot {
  key: string;
  lx: number;
  ly: number;
  frame: string | null;
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

interface MapResponse {
  world: { name: string; seed: string; scenarioVersion: string; day: number } | null;
  biome: string;
  tile: { width: number; height: number; lotTiles: number; lotPitch: number };
  terrain: Terrain | null;
  lots: MapLot[];
  unplaced: { buildings: number; camps: number };
  truncated: { buildings: number; camps: number };
}

interface Atlas {
  cell: { w: number; h: number };
  pivot: { x: number; y: number };
  biomes: Record<string, { image: string; frames: Record<string, { x: number; y: number }> }>;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

const HALF_W = 16;
const HALF_H = 8;
const SCALES = [0.5, 1, 2, 3, 4];
/** Headroom above the terrain's top row so the tallest sprites on it are not cut off. */
const TOP = 56;

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
function terrainImage(terrain: Terrain, biome: string): HTMLCanvasElement {
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
function lotPivot(lot: MapLot, terrain: Terrain, pitch: number, lotTiles: number): { x: number; y: number } {
  const originX = (terrain.height - 1) * HALF_W + HALF_W;
  const tx = lot.lx * pitch - terrain.x0;
  const ty = lot.ly * pitch - terrain.y0;
  return { x: originX + (tx - ty) * HALF_W, y: (tx + ty + 2 * lotTiles) * HALF_H };
}

function describe(lot: MapLot): string {
  if (lot.kind === 'camp') return 'Camp · household without a home';
  if (lot.destroyed) return 'Ruin';
  if (lot.kind === 'home_site') return 'Home under construction';
  if (lot.kind === 'development_site') return `${label(lot.plannedKind ?? 'workplace')} under construction`;
  if (lot.kind === 'development_abandoned') return `Abandoned ${label(lot.plannedKind ?? 'workplace')} site`;
  const size = ['small', 'medium', 'large'][lot.tier - 1];
  return `${label(lot.kind)} · ${size}`;
}

function label(kind: string): string {
  const text = kind.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function TownMap({ revision = 0 }: { revision?: number }) {
  const [data, setData] = useState<MapResponse | null>(null);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    let current = true;
    getJson<MapResponse>('/api/map')
      .then((next) => current && setData(next))
      .catch((err: Error) => current && setError(err.message));
    return () => {
      current = false;
    };
  }, [revision]);

  useEffect(() => {
    let current = true;
    getJson<Atlas>('/map/atlas.json')
      .then((next) => current && setAtlas(next))
      .catch((err: Error) => current && setError(`sprite atlas: ${err.message}`));
    return () => {
      current = false;
    };
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
  const pixelWidth = terrain ? (terrain.width + terrain.height) * HALF_W : 0;
  const pixelHeight = terrain ? (terrain.width + terrain.height) * HALF_H + 112 : 0;
  const ground = useMemo(() => (terrain ? terrainImage(terrain, biome) : null), [terrain, biome]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setSize({ w: box.clientWidth, h: box.clientHeight }));
    observer.observe(box);
    return () => observer.disconnect();
  }, [data]);

  // Fit the town's buildings into the view.
  const fit = useCallback(() => {
    const box = viewport.current;
    if (!box || !terrain || !data) return;
    const placed = data.lots.map((lot) => lotPivot(lot, terrain, data.tile.lotPitch, data.tile.lotTiles));
    const xs = placed.map((p) => p.x);
    const ys = placed.map((p) => p.y);
    const minX = xs.length ? Math.min(...xs) - 96 : 0;
    const maxX = xs.length ? Math.max(...xs) + 96 : pixelWidth;
    const minY = ys.length ? Math.min(...ys) - 130 : 0;
    const maxY = ys.length ? Math.max(...ys) + 30 : pixelHeight;
    const fits = SCALES.filter((s) => (maxX - minX) * s <= box.clientWidth && (maxY - minY) * s <= box.clientHeight);
    // Never fit below 1x: an outlying shore fishery should not shrink the whole town to specks.
    // When everything fits, centre the bounds; otherwise centre on the town's median building.
    const allFit = fits.length > 0 && fits[fits.length - 1]! >= 1;
    const scale = allFit ? fits[fits.length - 1]! : 1;
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    const cx = allFit || xs.length === 0 ? (minX + maxX) / 2 : median(xs);
    const cy = allFit || ys.length === 0 ? (minY + maxY) / 2 : median(ys) - 50;
    setView({
      scale,
      x: Math.round(box.clientWidth / 2 - cx * scale),
      y: Math.round(box.clientHeight / 2 - (cy + TOP) * scale),
    });
  }, [data, terrain, pixelWidth, pixelHeight]);

  useEffect(() => {
    if (view === null && data && terrain && size.w > 0) fit();
  }, [view, data, terrain, fit, size]);

  // Redraw the visible part of the town whenever the view, data or selection changes.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !terrain || !data || !view || !ground || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(size.w * dpr);
    el.height = Math.round(size.h * dpr);
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
    const frames = atlas?.biomes[data.biome]?.frames;
    if (!sheet || !frames || !atlas) return;
    const left = -view.x / view.scale - atlas.cell.w;
    const right = (size.w - view.x) / view.scale + atlas.cell.w;
    const top = -view.y / view.scale - TOP;
    const bottom = (size.h - view.y) / view.scale + atlas.cell.h;
    const ordered = [...data.lots].sort((a, b) => a.lx + a.ly - (b.lx + b.ly) || a.lx - b.lx);
    for (const lot of ordered) {
      const frame = lot.frame ? frames[lot.frame] : undefined;
      if (!frame) continue;
      const pivot = lotPivot(lot, terrain, data.tile.lotPitch, data.tile.lotTiles);
      if (pivot.x < left || pivot.x > right || pivot.y < top || pivot.y > bottom) continue;
      const dx = pivot.x - atlas.pivot.x;
      const dy = pivot.y + TOP - atlas.pivot.y;
      ctx.drawImage(sheet, frame.x, frame.y, atlas.cell.w, atlas.cell.h, dx, dy, atlas.cell.w, atlas.cell.h);
      if (lot.key === selected) {
        const w = data.tile.lotTiles * HALF_W;
        const h = data.tile.lotTiles * HALF_H;
        const py = pivot.y + TOP;
        ctx.strokeStyle = '#f2d064';
        ctx.lineWidth = 1 / view.scale;
        ctx.beginPath();
        ctx.moveTo(pivot.x, py - 2 * h);
        ctx.lineTo(pivot.x + w, py - h);
        ctx.lineTo(pivot.x, py);
        ctx.lineTo(pivot.x - w, py - h);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }, [data, terrain, ground, atlas, sheet, selected, view, size]);

  const zoom = (direction: 1 | -1, cx?: number, cy?: number) => {
    setView((current) => {
      if (!current || !viewport.current) return current;
      const index = SCALES.indexOf(current.scale);
      const next = SCALES[Math.max(0, Math.min(SCALES.length - 1, index + direction))]!;
      if (next === current.scale) return current;
      const px = cx ?? viewport.current.clientWidth / 2;
      const py = cy ?? viewport.current.clientHeight / 2;
      return {
        scale: next,
        x: Math.round(px - ((px - current.x) * next) / current.scale),
        y: Math.round(py - ((py - current.y) * next) / current.scale),
      };
    });
  };

  // Hit test: the topmost lot whose diamond contains the point.
  const pick = (clientX: number, clientY: number): MapLot | null => {
    const box = viewport.current;
    if (!box || !view || !terrain || !data) return null;
    const rect = box.getBoundingClientRect();
    const mx = (clientX - rect.left - view.x) / view.scale;
    const my = (clientY - rect.top - view.y) / view.scale - TOP;
    const lotTiles = data.tile.lotTiles;
    const ordered = [...data.lots].sort((a, b) => b.lx + b.ly - (a.lx + a.ly) || b.lx - a.lx);
    for (const lot of ordered) {
      const pivot = lotPivot(lot, terrain, data.tile.lotPitch, lotTiles);
      const dx = Math.abs(mx - pivot.x) / (lotTiles * HALF_W);
      const dy = Math.abs(my - (pivot.y - lotTiles * HALF_H)) / (lotTiles * HALF_H);
      if (dx + dy <= 1) return lot;
    }
    return null;
  };

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="muted">Loading map…</div>;
  if (!terrain || !data.world) return <div className="muted">No town yet.</div>;

  const current = data.lots.find((lot) => lot.key === selected) ?? null;
  const counts = {
    buildings: data.lots.filter((lot) => lot.buildingId !== null).length,
    camps: data.lots.filter((lot) => lot.kind === 'camp').length,
  };

  return (
    <section className="stack">
      <div className="map-toolbar">
        <span className="muted small">
          {data.world.name} · {data.biome} · {counts.buildings} buildings · {counts.camps} camps
          {data.unplaced.buildings + data.unplaced.camps > 0
            ? ` · ${data.unplaced.buildings + data.unplaced.camps} not shown (no room)`
            : ''}
          {data.truncated.buildings + data.truncated.camps > 0
            ? ` · ${data.truncated.buildings + data.truncated.camps} beyond the map limit`
            : ''}
        </span>
        <div className="buttons">
          <button onClick={() => zoom(-1)} aria-label="Zoom out">−</button>
          <span className="mono small">{view ? `${view.scale}×` : ''}</span>
          <button onClick={() => zoom(1)} aria-label="Zoom in">+</button>
          <button onClick={fit}>Fit</button>
        </div>
      </div>
      <div className="map-layout">
        <div
          ref={viewport}
          className="map-viewport"
          role="img"
          aria-label={`Map of ${data.world.name}`}
          onPointerDown={(event) => {
            if (!view) return;
            (event.target as Element).setPointerCapture?.(event.pointerId);
            drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
            if (start.moved) setView((v) => (v ? { ...v, x: start.vx + dx, y: start.vy + dy } : v));
          }}
          onPointerUp={(event) => {
            const start = drag.current;
            drag.current = null;
            if (start && !start.moved) setSelected(pick(event.clientX, event.clientY)?.key ?? null);
          }}
          onWheel={(event) => {
            const rect = viewport.current?.getBoundingClientRect();
            if (!rect) return;
            zoom(event.deltaY < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
          }}
        >
          <canvas ref={canvas} className="map-canvas" />
        </div>
        <aside className="panel map-details">
          {current ? (
            <>
              <h2>{current.name}</h2>
              <div className="muted small">{describe(current)}</div>
              <dl className="map-facts">
                {current.business ? (
                  <>
                    <dt>Business</dt>
                    <dd>{current.business.name} ({current.business.status})</dd>
                    <dt>Staff</dt>
                    <dd>{current.business.staff} / {current.capacity}</dd>
                  </>
                ) : null}
                {current.kind === 'home' || current.kind === 'camp' ? (
                  <>
                    <dt>Residents</dt>
                    <dd>{current.residents} / {current.capacity}</dd>
                  </>
                ) : null}
                {current.households > 1 ? (
                  <>
                    <dt>Households</dt>
                    <dd>{current.households}</dd>
                  </>
                ) : null}
                {current.conditionPct !== null && !current.destroyed ? (
                  <>
                    <dt>Condition</dt>
                    <dd>{current.conditionPct}%</dd>
                  </>
                ) : null}
              </dl>
            </>
          ) : (
            <>
              <h2>Map</h2>
              <p className="muted small">
                Click a building for details. Drag to pan, scroll or use + / − to zoom. Building size shows capacity:
                small, medium or large.
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
