// Presentation-only scenery. All positions/variants come from the seeded server scene, not randomness.
export interface MapPoint { x: number; y: number }
export interface MapRoad { points: MapPoint[] }
export interface MapTree extends MapPoint { size: number; variant: number }
export interface SceneryTerrain { x0: number; y0: number; height: number }

export function sceneryPoint(p: MapPoint, terrain: SceneryTerrain): MapPoint {
  const x = p.x - terrain.x0;
  const y = p.y - terrain.y0;
  return { x: terrain.height * 16 + (x - y) * 16, y: (x + y) * 8 + 56 };
}

/** Narrow packed-earth trails, not a carpet of road-coloured tiles around every lot. */
export interface SceneryViewport { left: number; right: number; top: number; bottom: number }

export function segmentInView(a: MapPoint, b: MapPoint, view: SceneryViewport): boolean {
  return Math.max(a.x, b.x) + 4 >= view.left && Math.min(a.x, b.x) - 4 <= view.right &&
    Math.max(a.y, b.y) + 2 >= view.top && Math.min(a.y, b.y) - 2 <= view.bottom;
}

export function drawRoads(ctx: CanvasRenderingContext2D, roads: MapRoad[], terrain: SceneryTerrain, biome: string, view?: SceneryViewport): void {
  const colours: Record<string, [string, string]> = {
    tropical: ['#9d814d', '#c9a46c'], temperate: ['#7d5d3e', '#b18a5d'],
    arid: ['#a37e49', '#d2af75'], northern: ['#706650', '#a59677'],
  };
  const ramp = colours[biome] ?? colours.tropical!;
  ctx.save();
  // Rasterize at native integer pixels, rather than smooth vector strokes at the current zoom.
  // The stepped brush approximates a 0.4-tile-wide trail under the 2:1 projection.
  for (const inner of [false, true]) {
    ctx.fillStyle = ramp[inner ? 1 : 0];
    ctx.beginPath();
    const stamp = (x: number, y: number) => {
      if (inner) ctx.rect(x - 2, y, 5, 1);
      else { ctx.rect(x - 2, y - 1, 5, 3); ctx.rect(x - 3, y, 7, 1); }
    };
    for (const road of roads) {
      for (let n = 1; n < road.points.length; n += 1) {
        const a = sceneryPoint(road.points[n - 1]!, terrain);
        const b = sceneryPoint(road.points[n]!, terrain);
        if (view && !segmentInView(a, b, view)) continue;
        let x = Math.round(a.x), y = Math.round(a.y);
        const bx = Math.round(b.x), by = Math.round(b.y);
        const dx = Math.abs(bx - x), sx = x < bx ? 1 : -1;
        const dy = -Math.abs(by - y), sy = y < by ? 1 : -1;
        let err = dx + dy;
        for (;;) {
          stamp(x, y);
          if (x === bx && y === by) break;
          const e = 2 * err;
          if (e >= dy) { err += dy; x += sx; }
          if (e <= dx) { err += dx; y += sy; }
        }
      }
    }
    ctx.fill();
  }
  ctx.restore();
}

const cache = new Map<string, HTMLCanvasElement>();
const W = 40;
const H = 48;
export const TREE_PIVOT = { x: 20, y: 44 };

/** Native pixel-art trees. Shapes are made from integer pixels only; never scaled vectors. */
export function treeSprite(biome: string, tree: MapTree): HTMLCanvasElement {
  const key = `${biome}:${tree.size}:${tree.variant}`;
  const prior = cache.get(key);
  if (prior) return prior;
  const image = document.createElement('canvas');
  image.width = W;
  image.height = H;
  const ctx = image.getContext('2d')!;
  const px = (x: number, y: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); };
  const line = (x0: number, y0: number, x1: number, y1: number, col: string) => {
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      px(x0, y0, col);
      if (x0 === x1 && y0 === y1) break;
      const e = 2 * err;
      if (e >= dy) { err += dy; x0 += sx; }
      if (e <= dx) { err += dx; y0 += sy; }
    }
  };
  const rect = (x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  const leaf = biome === 'northern'
    ? ['#142f32', '#235344', '#3f7654', '#719365']
    : ['#153d2c', '#266739', '#45964b', '#8cbe5b'];
  const trunk = ['#493222', '#8c5a35', '#ba8750'];
  const height = 18 + tree.size * 3;
  const top = 43 - height;
  if (biome === 'tropical') {
    const lean = [-3, 2, -1, 4][tree.variant % 4]!;
    for (let k = 0; k < height - 5; k += 1) {
      const x = 20 + Math.round(lean * k / (height - 5));
      px(x - 1, 43 - k, trunk[0]!); px(x, 43 - k, k % 4 === 0 ? trunk[2]! : trunk[1]!);
    }
    const cx = 20 + lean, cy = top + 5;
    // Six sweeping fronds, each with a dark lower edge and a light spine.
    const spread = tree.variant % 2;
    const tips = [[-14, 3 + spread], [-10, -5], [-3, -8 + spread], [7, -6], [14, 1], [9, 8 - spread], [-7, 9]];
    for (const [dx, dy] of tips) {
      const mx = cx + Math.round(dx! * 0.55), my = cy + Math.min(-2, dy! - 4);
      line(cx, cy + 1, mx, my + 1, leaf[0]!);
      line(mx, my + 1, cx + dx!, cy + dy! + 1, leaf[0]!);
      line(cx, cy, mx, my, leaf[2]!);
      line(mx, my, cx + dx!, cy + dy!, leaf[1]!);
      line(cx, cy - 1, mx, my - 1, leaf[3]!);
    }
    rect(cx - 1, cy, 3, 2, trunk[0]!);
  } else if (biome === 'arid') {
    const t = top + 6;
    rect(18, t, 5, 43 - t, leaf[0]!); rect(19, t, 2, 43 - t, leaf[2]!);
    const arm = tree.variant % 3;
    rect(14, t + 7 + arm, 5, 3, leaf[1]!); rect(13, t + 2 + arm, 3, 8, leaf[1]!);
    rect(22, t + 10 - arm, 6, 3, leaf[1]!); rect(26, t + 5 - arm, 3, 8, leaf[2]!);
    line(19, t + 2, 19, 40, leaf[3]!);
  } else if (biome === 'northern') {
    rect(19, top + 6, 3, 37 - top, trunk[0]!);
    for (let tier = 3; tier >= 0; tier -= 1) {
      const y = top + tier * 4;
      const span = 3 + tier * 2;
      for (let row = 0; row <= 8; row += 1) {
        const radius = Math.floor(span * row / 8);
        const notch = (row + tree.variant + tier) % 4 === 0 ? 1 : 0;
        rect(20 - radius, y + row, radius + 1, 1, leaf[2]!);
        rect(21, y + row, Math.max(0, radius - notch), 1, leaf[0]!);
      }
      line(20, y, 20 - span, y + 8, leaf[3]!);
    }
  } else {
    rect(19, top + 7, 3, 36 - top, trunk[0]!);
    line(20, top + 16, 14, top + 11, trunk[1]!);
    const radius = 8 + tree.size;
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        const hash = Math.imul(x + 51, 374761393) ^ Math.imul(y + 53, 668265263) ^ Math.imul(tree.variant + 1, 1274126177);
        const noise = ((hash ^ (hash >>> 13)) >>> 0) % 7;
        if (x * x + y * y > radius * radius - noise * 2) continue;
        const light = x + y + (noise - 3) * 0.8;
        const col = light < -radius / 2 ? leaf[3]! : light > radius / 2 ? leaf[0]! : noise < 2 ? leaf[1]! : leaf[2]!;
        px(20 + x, top + radius + y, col);
      }
    }
  }
  // A discrete one-pixel outline, leaving individual leaf glints untouched.
  const data = ctx.getImageData(0, 0, W, H);
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
    const alpha = (xx: number, yy: number) => data.data[(yy * W + xx) * 4 + 3]!;
    if (!alpha(x, y) && (alpha(x - 1, y) || alpha(x + 1, y) || alpha(x, y - 1) || alpha(x, y + 1))) px(x, y, '#182b24');
  }
  cache.set(key, image);
  return image;
}

export function drawTreeShadow(ctx: CanvasRenderingContext2D, p: MapPoint): void {
  ctx.fillStyle = '#14362244';
  // Pixel steps rather than antialiased ellipses.
  ctx.fillRect(p.x - 6, p.y - 2, 12, 3);
  ctx.fillRect(p.x - 9, p.y - 1, 18, 1);
}
