import {
  LOT_TILES,
  buildTerrain,
  type MapLayout,
  type TerrainBox,
} from './map-layout.js';

export const MAX_ROAD_TARGETS = 96;
export const MAX_PATH_EXPANSIONS = 3000;
export const MAX_TOTAL_PATH_EXPANSIONS = 200_000;
export const MAX_TREES = 1200;
export const MAX_ROAD_POINTS = 20_000;
const TREE_SPATIAL_SIZE = 3;
const PATH_MIN_STEP_COST = 0.35;
const ROAD_STEP_COST = 0.35;

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapRoad {
  points: MapPoint[];
}

export interface MapTree extends MapPoint {
  size: 1 | 2 | 3;
  variant: 0 | 1 | 2 | 3;
}

export interface MapScene {
  terrain: TerrainBox;
  roads: MapRoad[];
  trees: MapTree[];
  roadTargetsOmitted: number;
}

interface Cell {
  x: number;
  y: number;
}

interface RoadBuild {
  roads: MapRoad[];
  roadCells: Set<number>;
  omitted: number;
}

interface HeapNode {
  index: number;
  x: number;
  y: number;
  g: number;
  f: number;
}

/**
 * Build all presentation scenery from the same immutable layout as the lots. Roads and trees are
 * tile-space data: projection belongs to the client. Every loop has a fixed terrain, target, or
 * expansion bound so a very large town cannot turn scenery into an unbounded request.
 */
export function buildMapScene(seed: string, layout: MapLayout, biome?: string): MapScene {
  const terrain = buildTerrain(layout);
  const roadBuild = buildRoads(seed, layout, terrain);
  return {
    terrain,
    roads: roadBuild.roads,
    trees: buildTrees(seed, layout, terrain, roadBuild.roadCells, biome),
    roadTargetsOmitted: roadBuild.omitted,
  };
}

function buildRoads(seed: string, layout: MapLayout, terrain: TerrainBox): RoadBuild {
  const blocked = new Set<number>();
  for (const lot of layout.lots) {
    const startX = lot.tx;
    const startY = lot.ty;
    for (let dy = 0; dy < LOT_TILES; dy += 1) {
      for (let dx = 0; dx < LOT_TILES; dx += 1) {
        blocked.add(globalCellKey(startX + dx, startY + dy));
      }
    }
  }

  const targets = layout.lots
    .filter((lot) => lot.buildingId !== null)
    .map((lot) => ({
      // The front is the high-j edge: one tile beyond the 3x3 footprint, at its middle.
      cell: { x: lot.tx + 1, y: lot.ty + LOT_TILES },
      endpoint: { x: lot.tx + 1.5, y: lot.ty + LOT_TILES },
      order: lot.buildingId!,
    }))
    .sort((a, b) => a.order - b.order || a.cell.x - b.cell.x || a.cell.y - b.cell.y);

  let omitted = Math.max(0, targets.length - MAX_ROAD_TARGETS);
  const roads: MapRoad[] = [];
  const roadCells = new Set<number>();
  const networks = new Map<number, Cell[]>();
  const componentAt = landComponents(terrain, layout, blocked);
  let totalExpansions = 0;
  let totalPoints = 0;
  const salts = pathSalts(seed);

  for (let targetIndex = 0; targetIndex < Math.min(targets.length, MAX_ROAD_TARGETS); targetIndex += 1) {
    const target = targets[targetIndex]!.cell;
    if (!isUsableCell(target, terrain, layout.field, blocked)) {
      omitted += 1;
      continue;
    }
    const component = componentAt(target);
    const existing = networks.get(component) ?? [];
    networks.set(component, existing);
    if (existing.length === 0) {
      existing.push(target);
      roadCells.add(globalCellKey(target.x, target.y));
      roads.push({ points: [targets[targetIndex]!.endpoint, jitteredPoint(seed, target, salts.jitter)] });
      totalPoints += 2;
      continue;
    }

    const nearest = nearestEntry(target, existing);
    const remaining = MAX_TOTAL_PATH_EXPANSIONS - totalExpansions;
    if (remaining <= 0) {
      omitted += 1;
      continue;
    }
    const result = findPath(
      target,
      nearest,
      terrain,
      layout,
      blocked,
      roadCells,
      Math.min(MAX_PATH_EXPANSIONS, remaining),
      salts,
    );
    totalExpansions += result.expansions;
    if (!result.cells) {
      omitted += 1;
      continue;
    }

    const points = [
      targets[targetIndex]!.endpoint,
      ...result.cells.map((cell) => jitteredPoint(seed, cell, salts.jitter)),
    ];
    if (totalPoints + points.length > MAX_ROAD_POINTS) {
      omitted += 1;
      continue;
    }
    totalPoints += points.length;
    roads.push({ points });
    for (const cell of result.cells) roadCells.add(globalCellKey(cell.x, cell.y));
    existing.push(target);
  }

  return { roads, roadCells, omitted };
}

// Label traversable land once. Separate islands (or lot-enclosed courtyards) need separate path
// networks: using a shore outpost as the only root must not strand the entire inland town.
function landComponents(terrain: TerrainBox, layout: MapLayout, blocked: Set<number>): (cell: Cell) => number {
  const count = terrain.width * terrain.height;
  const labels = new Int32Array(count);
  labels.fill(-1);
  let next = 0;
  const queue = new Int32Array(count);
  return (cell) => {
    const start = cellKey(cell.x, cell.y, terrain);
    if (labels[start]! >= 0) return labels[start]!;
    const label = next++;
    let head = 0, tail = 1;
    queue[0] = start;
    labels[start] = label;
    while (head < tail) {
      const p = indexCell(queue[head++]!, terrain);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const neighbour = { x: p.x + dx, y: p.y + dy };
        if (!isUsableCell(neighbour, terrain, layout.field, blocked)) continue;
        const key = cellKey(neighbour.x, neighbour.y, terrain);
        if (labels[key]! >= 0) continue;
        labels[key] = label;
        queue[tail++] = key;
      }
    }
    return label;
  };
}

function findPath(
  start: Cell,
  goal: Cell,
  terrain: TerrainBox,
  layout: MapLayout,
  blocked: Set<number>,
  roadCells: Set<number>,
  maxExpansions: number,
  salts: ReturnType<typeof pathSalts>,
): { cells: Cell[] | null; expansions: number } {
  const startIndex = cellKey(start.x, start.y, terrain);
  const goalIndex = cellKey(goal.x, goal.y, terrain);
  const gScore = new Map<number, number>([[startIndex, 0]]);
  const cameFrom = new Map<number, number>();
  const heap = new MinHeap();
  heap.push({ index: startIndex, x: start.x, y: start.y, g: 0, f: octile(start, goal) * PATH_MIN_STEP_COST });
  let expansions = 0;

  while (heap.size > 0 && expansions < maxExpansions) {
    const current = heap.pop()!;
    if (current.g !== gScore.get(current.index)) continue;
    expansions += 1;
    if (current.index === goalIndex) return { cells: reconstructPath(current.index, cameFrom, terrain), expansions };

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const x = current.x + dx;
      const y = current.y + dy;
      if (!isUsableCell({ x, y }, terrain, layout.field, blocked)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal && (
        !isUsableCell({ x: current.x + dx, y: current.y }, terrain, layout.field, blocked) ||
        !isUsableCell({ x: current.x, y: current.y + dy }, terrain, layout.field, blocked)
      )) continue;
      const index = cellKey(x, y, terrain);
      const onExistingRoad = roadCells.has(globalCellKey(x, y));
      const distance = diagonal ? Math.SQRT2 : 1;
      const stepCost = distance * (onExistingRoad
        ? ROAD_STEP_COST + unit(salts.cost, x, y, salts.cost ^ 0x9e3779b9) * 0.02
        : 1 + unit(salts.cost, x, y, salts.cost ^ 0x9e3779b9) * 0.08);
      const nextG = current.g + stepCost;
      if (nextG >= (gScore.get(index) ?? Number.POSITIVE_INFINITY)) continue;
      gScore.set(index, nextG);
      cameFrom.set(index, current.index);
      heap.push({ index, x, y, g: nextG, f: nextG + octile({ x, y }, goal) * PATH_MIN_STEP_COST });
    }
  }
  return { cells: null, expansions };
}

function reconstructPath(goalIndex: number, cameFrom: Map<number, number>, terrain: TerrainBox): Cell[] {
  const path: Cell[] = [];
  let index = goalIndex;
  do {
    path.push(indexCell(index, terrain));
    const previous = cameFrom.get(index);
    if (previous === undefined) break;
    index = previous;
  } while (path.length <= MAX_PATH_EXPANSIONS + 1);
  path.reverse();
  return path;
}

function buildTrees(seed: string, layout: MapLayout, terrain: TerrainBox, roadCells: Set<number>, biome?: string): MapTree[] {
  const lotCells = new Set<number>();
  for (const lot of layout.lots) {
    const startX = lot.tx;
    const startY = lot.ty;
    for (let dy = 0; dy < LOT_TILES; dy += 1) {
      for (let dx = 0; dx < LOT_TILES; dx += 1) lotCells.add(globalCellKey(startX + dx, startY + dy));
    }
  }

  const clusterSalt = salt(seed, 'tree-cluster');
  const detailSalt = salt(seed, 'tree-detail');
  const prioritySalt = salt(seed, 'tree-priority');
  const groveThreshold = biome === 'arid' ? 0.72 : biome === 'northern' ? 0.58 : biome === 'temperate' ? 0.5 : 0.42;
  const candidates: { priority: number; tree: MapTree }[] = [];
  const maxX = terrain.x0 + terrain.width;
  const maxY = terrain.y0 + terrain.height;

  // One candidate per 3x3 spatial cell prevents the old row-major per-tile scan from filling
  // the cap in the first dense grove. Accepted candidates are ranked before the global cap.
  for (let cellY = Math.floor(terrain.y0 / TREE_SPATIAL_SIZE) * TREE_SPATIAL_SIZE; cellY < maxY; cellY += TREE_SPATIAL_SIZE) {
    for (let cellX = Math.floor(terrain.x0 / TREE_SPATIAL_SIZE) * TREE_SPATIAL_SIZE; cellX < maxX; cellX += TREE_SPATIAL_SIZE) {
      // World-anchored spatial cells keep candidates fixed when terrain bounds expand.
      const x = cellX + Math.floor(unit(detailSalt, cellX, cellY, 11) * TREE_SPATIAL_SIZE);
      const y = cellY + Math.floor(unit(detailSalt, cellX, cellY, 17) * TREE_SPATIAL_SIZE);
      if (x < terrain.x0 || y < terrain.y0 || x >= maxX || y >= maxY) continue;
      const cluster = unit(clusterSalt, Math.floor(x / 6), Math.floor(y / 6), 0x3c6ef372);
      const detail = unit(detailSalt, x, y, 0xdaa66d2b);
      if (cluster < groveThreshold || detail < 0.4) continue;
      if (!hasClearance(x, y, layout, lotCells, roadCells)) continue;
      candidates.push({
        priority: unit(prioritySalt, x, y, 0x6a09e667),
        tree: {
          x: x + 0.5 + jitter(seed, x, y, 0, 'tree-x'),
          y: y + 0.5 + jitter(seed, x, y, 1, 'tree-y'),
          size: (1 + Math.floor(unit(detailSalt ^ 0x51ed270b, x, y, 0x1234567) * 3)) as 1 | 2 | 3,
          variant: Math.floor(unit(detailSalt ^ 0xa5a5a5a5, x, y, 0x7654321) * 4) as 0 | 1 | 2 | 3,
        },
      });
    }
  }
  candidates.sort((a, b) => a.priority - b.priority || a.tree.x - b.tree.x || a.tree.y - b.tree.y);
  return candidates.slice(0, MAX_TREES).map((candidate) => candidate.tree);
}

function hasClearance(
  x: number,
  y: number,
  layout: MapLayout,
  lotCells: Set<number>,
  roadCells: Set<number>,
): boolean {
  if (!layout.field.land(x, y)) return false;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!layout.field.land(nx, ny)) return false;
      const key = globalCellKey(nx, ny);
      if (lotCells.has(key) || roadCells.has(key)) return false;
    }
  }
  return true;
}

function isUsableCell(cell: Cell, terrain: TerrainBox, field: MapLayout['field'], blocked: Set<number>): boolean {
  if (cell.x < terrain.x0 || cell.x >= terrain.x0 + terrain.width || cell.y < terrain.y0 || cell.y >= terrain.y0 + terrain.height) return false;
  return field.land(cell.x, cell.y) && !blocked.has(globalCellKey(cell.x, cell.y));
}

function nearestEntry(target: Cell, entries: Cell[]): Cell {
  let best = entries[0]!;
  let bestDistance = manhattan(target, best);
  for (let index = 1; index < entries.length; index += 1) {
    const candidate = entries[index]!;
    const distance = manhattan(target, candidate);
    if (distance < bestDistance || (distance === bestDistance && (candidate.x < best.x || (candidate.x === best.x && candidate.y < best.y)))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function jitteredPoint(seed: string, cell: Cell, jitterSalt: number): MapPoint {
  return {
    x: cell.x + 0.5 + jitter(seed, cell.x, cell.y, 0, 'road-x', jitterSalt),
    y: cell.y + 0.5 + jitter(seed, cell.x, cell.y, 1, 'road-y', jitterSalt),
  };
}

function jitter(seed: string, x: number, y: number, axis: number, label: string, extra = 0): number {
  const saltValue = salt(seed, label) ^ extra;
  return unit(saltValue, x, y, axis) * 0.2 - 0.1;
}

function pathSalts(seed: string): { cost: number; jitter: number } {
  return { cost: salt(seed, 'path-cost'), jitter: salt(seed, 'path-jitter') };
}

function salt(seed: string, label: string): number {
  let hash = 0x811c9dc5;
  const text = `${seed}#map-scenery#${label}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function unit(saltValue: number, x: number, y: number, extra: number): number {
  let hash = (saltValue ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ extra) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function cellKey(x: number, y: number, terrain: TerrainBox): number {
  return (y - terrain.y0) * terrain.width + (x - terrain.x0);
}

function indexCell(index: number, terrain: TerrainBox): Cell {
  const row = Math.floor(index / terrain.width);
  return { x: terrain.x0 + index - row * terrain.width, y: terrain.y0 + row };
}

// Injective throughout the bounded map, including clearance neighbours outside the terrain box.
function globalCellKey(x: number, y: number): number {
  return (y + 32768) * 65536 + x + 32768;
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function octile(a: Cell, b: Cell): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

class MinHeap {
  private readonly values: HeapNode[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: HeapNode): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareHeap(this.values[parent]!, value) <= 0) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): HeapNode | undefined {
    const first = this.values[0];
    if (!first) return undefined;
    const last = this.values.pop()!;
    if (this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      let child = left;
      if (right < this.values.length && compareHeap(this.values[right]!, this.values[left]!) < 0) child = right;
      if (compareHeap(this.values[child]!, last) >= 0) break;
      this.values[index] = this.values[child]!;
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function compareHeap(a: HeapNode, b: HeapNode): number {
  return a.f - b.f || a.g - b.g || a.index - b.index;
}
