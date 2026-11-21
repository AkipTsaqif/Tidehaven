import { useEffect, useRef, useState } from 'react';
import { computeFit, drawTown, useTownMap, type View } from '../map-render.js';

/**
 * A small, view-only picture of the town for the Overview tab. It draws through the same code as the
 * full map, but it has no pan, zoom, click or hover behaviour at all: no handlers, no selection, and
 * the canvas ignores pointer events entirely, so the page scrolls normally when the mouse is over it.
 */
export function MiniMap({ revision = 0 }: { revision?: number }) {
  const { data, atlas, sheets, ground, objects, error } = useTownMap(revision);
  const frame = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const terrain = data?.terrain ?? null;

  useEffect(() => {
    const box = frame.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setSize({ w: box.clientWidth, h: box.clientHeight }));
    observer.observe(box);
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !data || !terrain || !ground || size.w === 0) return;
    // A thumbnail may zoom out to 0.5x so the whole town fits; the view is recomputed on resize.
    const view: View = computeFit(data, terrain, size, 0.5, atlas);
    drawTown(el, { data, terrain, ground, atlas, sheets, objects, view, size });
  }, [data, terrain, ground, atlas, sheets, objects, size]);

  if (error) return <div className="muted small">Map unavailable.</div>;
  if (!data) return <div className="muted small">Loading map…</div>;
  if (!data.world || !terrain) return <div className="muted small">No town yet.</div>;

  const buildings = data.lots.filter((lot) => lot.buildingId !== null).length;
  const camps = data.lots.filter((lot) => lot.kind === 'camp').length;
  return (
    <div className="minimap">
      <div ref={frame} className="minimap-frame" role="img" aria-label={`Map of ${data.world.name}`}>
        <canvas ref={canvas} className="minimap-canvas" />
      </div>
      <div className="muted small minimap-caption">
        {data.world.name} · {data.biome} · {buildings} buildings · {camps} camps
      </div>
    </div>
  );
}
