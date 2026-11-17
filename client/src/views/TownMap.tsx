import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SCALES, TOP, computeFit, drawTown, useTownMap, type MapLot, type View,
} from '../map-render.js';
import { pointInFootprint } from '../map-assets.js';

/**
 * Bird's-eye town map. Read-only: it shows the committed town through /api/map and never sends
 * commands. Terrain is drawn as 32x16 isometric tiles; buildings are 96x104 sprites from the
 * pre-built atlas, anchored by their bottom pivot on a 3x3-tile lot.
 */

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
  const { data, atlas, sheet, ground, objects, error } = useTownMap(revision);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const viewport = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const terrain = data?.terrain ?? null;

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
    setView(computeFit(data, terrain, { w: box.clientWidth, h: box.clientHeight }, 1, atlas));
  }, [data, terrain, atlas]);

  useEffect(() => {
    if (view === null && data && terrain && size.w > 0) fit();
  }, [view, data, terrain, fit, size]);

  // Redraw whenever the view, data or selection changes.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !terrain || !data || !view || !ground || size.w === 0) return;
    drawTown(el, { data, terrain, ground, atlas, sheet, objects, view, size, selected });
  }, [data, terrain, ground, atlas, sheet, selected, view, size, objects]);

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
    const ordered = [...data.lots].sort((a, b) => b.tx + b.ty - (a.tx + a.ty) || b.tx - a.tx);
    for (const lot of ordered) {
      const fp = lot.footprint ?? { w: lotTiles, d: lotTiles };
      const origin = terrain.height * 16;
      if (pointInFootprint(mx - origin, my, lot.tx - terrain.x0, lot.ty - terrain.y0, fp)) return lot;
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
          {data.world.name} · {data.biome} · {label(data.terrainShape)} · {counts.buildings} buildings · {counts.camps} camps
          {data.unplaced.buildings + data.unplaced.camps > 0
            ? ` · ${data.unplaced.buildings + data.unplaced.camps} not shown (no room)`
            : ''}
          {(data.roadTargetsOmitted ?? 0) > 0 ? ` · ${data.roadTargetsOmitted} path connections not drawn` : ''}
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
          onPointerCancel={() => { drag.current = null; }}
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
