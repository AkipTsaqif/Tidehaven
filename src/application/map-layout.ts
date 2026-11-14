/**
 * Deterministic town-map layout for the dashboard Map tab. Presentation only: nothing here is
 * stored, and nothing feeds back into the simulation.
 *
 * Grid. One tile is 32x16 screen pixels (classic 2:1). A building occupies a 3x3-tile lot; lots
 * sit on a 4-tile pitch, so the fourth row/column between lots is road or open ground and two lots can
 * never overlap. Tile (tx, ty) maps to screen ((tx - ty) * 16, (tx + ty) * 8) at its top vertex.
 *
 * Stability. The island is a fixed function of the world seed, and candidate lots form one fixed
 * order (nearest the centre first, with seeded jitter). Buildings are placed in id order, and each one
 * takes the first free lot it can use. So a building's lot depends only on buildings with smaller ids.
 * Buildings are never deleted and ids only grow, so earlier buildings never move as the town grows.
 * Workplace sites are placed by the kind they will become (a fishery site goes to the shore).
 * Camps are temporary households without a building: they fill the next free lots after all
 * buildings, so a new building can push a camp outward.
 *
 * Determinism. Only integer hashing, + - * / floor and sqrt (all exactly specified by IEEE 754);
 * no trigonometry, wall clock or Math.random.
 */

export const TILE_WIDTH = 32;
export const TILE_HEIGHT = 16;
export const LOT_TILES = 3;
export const LOT_PITCH = 4;
/** Main island radius in tiles: room for a few hundred lots before islets take the overflow. */
export const ISLAND_RADIUS = 40;
/**
 * The town starts near the island's east coast (a harbour town), so the island centre sits west of
 * the origin. The offset keeps lot (0, 0) on land for every seed (coast noise is at most +-0.325 of
 * the radius) while the shore stays a few lots away, which keeps fisheries close to the town.
 */
export const ISLAND_CENTRE_X = -(ISLAND_RADIUS - 16);
/** Hard search bound in lots from the centre; beyond it a building is reported as unplaced. */
export const MAX_RING = 160;
/** Terrain box side limit in tiles. */
export const MAX_TERRAIN_SIDE = 768;

export const BIOMES = ['tropical', 'temperate', 'arid', 'northern'] as const;
export type Biome = (typeof BIOMES)[number];

export const CATALOG_KINDS = new Set([
  'home', 'farm', 'fishery', 'bakery', 'timber_camp', 'workshop', 'shop', 'clinic', 'guard_house', 'court',
  'council', 'public_works',
]);
export const SPECIAL_KINDS = new Set(['camp', 'home_site', 'development_site', 'development_abandoned', 'destroyed']);

function isEden(text: string | null | undefined): boolean {
  return (text ?? '').toLowerCase().startsWith('eden');
}

/**
 * Exact port of `B.choose` in art/biomes.lua (Lua 5.4 integer arithmetic over UTF-8 bytes), so the
 * dashboard and the sprite builder always agree. Any Eden scenario or town is tropical.
 */
export function chooseBiome(scenarioVersion: string, seed: string, worldName?: string): Biome {
  if (isEden(scenarioVersion) || isEden(worldName)) return 'tropical';
  let h = 216613626n;
  for (const byte of new TextEncoder().encode(`${scenarioVersion}|${seed}`)) {
    h = (h * 16777619n + BigInt(byte)) % 2147483647n;
  }
  return BIOMES[Number(h % 4n)]!;
}

/** Same presentation thresholds as `K.tier` in art/catalog.lua. Never a gameplay rule. */
export function capacityTier(kind: string, capacity: number): 1 | 2 | 3 {
  const [small, medium] = kind === 'home' ? [6, 12] : [6, 20];
  if (capacity <= small) return 1;
  return capacity <= medium ? 2 : 3;
}

// ---------------------------------------------------------------- seeded field

function seedSalt(seed: string, label: string): number {
  let hash = 0x811c9dc5;
  const text = `${seed}#map#${label}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hash2(salt: number, x: number, y: number): number {
  let h = (salt ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function unit(salt: number, x: number, y: number): number {
  return hash2(salt, x, y) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1) with smoothstep interpolation on a `scale`-tile lattice. */
function valueNoise(salt: number, x: number, y: number, scale: number): number {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = smooth(gx - x0);
  const fy = smooth(gy - y0);
  const a = unit(salt, x0, y0);
  const b = unit(salt, x0 + 1, y0);
  const c = unit(salt, x0, y0 + 1);
  const d = unit(salt, x0 + 1, y0 + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

const ISLET_CELL = 18;

export class IslandField {
  private readonly coast1: number;
  private readonly coast2: number;
  private readonly islet: number;
  private readonly jitter: number;
  private readonly lotLand = new Map<number, boolean>();

  constructor(seed: string) {
    this.coast1 = seedSalt(seed, 'coast-1');
    this.coast2 = seedSalt(seed, 'coast-2');
    this.islet = seedSalt(seed, 'islet');
    this.jitter = seedSalt(seed, 'lot-order');
  }

  /** True when tile (tx, ty) is land. A fixed function of the seed: it never changes with town size. */
  land(tx: number, ty: number): boolean {
    const cx = tx + 0.5;
    const cy = ty + 0.5;
    const ox = cx - ISLAND_CENTRE_X;
    const distance = Math.sqrt(ox * ox + cy * cy);
    const main =
      1 - distance / ISLAND_RADIUS +
      0.45 * (valueNoise(this.coast1, cx, cy, 9) - 0.5) +
      0.2 * (valueNoise(this.coast2, cx, cy, 4) - 0.5);
    if (main > 0) return true;
    // Islets beyond the main island: at most one per cell, kept inside its cell.
    const kx = Math.floor(tx / ISLET_CELL);
    const ky = Math.floor(ty / ISLET_CELL);
    if (unit(this.islet, kx * 3, ky * 3) >= 0.55) return false;
    const ix = kx * ISLET_CELL + 6 + unit(this.islet, kx * 3 + 1, ky * 3) * 6;
    const iy = ky * ISLET_CELL + 6 + unit(this.islet, kx * 3, ky * 3 + 1) * 6;
    const ixo = ix - ISLAND_CENTRE_X;
    if (Math.sqrt(ixo * ixo + iy * iy) < ISLAND_RADIUS + 12) return false;
    const radius = 2.5 + unit(this.islet, kx * 3 + 2, ky * 3 + 2) * 3.5;
    const dx = cx - ix;
    const dy = cy - iy;
    return Math.sqrt(dx * dx + dy * dy) < radius + 1.2 * (valueNoise(this.coast2, cx, cy, 3) - 0.5);
  }

  /** A lot is buildable when all nine of its tiles are land. */
  lotIsLand(lx: number, ly: number): boolean {
    const key = lotKey(lx, ly);
    const cached = this.lotLand.get(key);
    if (cached !== undefined) return cached;
    let ok = true;
    for (let dy = 0; dy < LOT_TILES && ok; dy += 1) {
      for (let dx = 0; dx < LOT_TILES && ok; dx += 1) {
        if (!this.land(lx * LOT_PITCH + dx, ly * LOT_PITCH + dy)) ok = false;
      }
    }
    this.lotLand.set(key, ok);
    return ok;
  }

  /**
   * A shore lot is land with sea along its high-i edge (screen lower-right), where the fishery
   * sprite draws its own water strip and pier: the tile column just past the lot must be at least
   * two-thirds water, and the lot's own centre tile on that side must touch it.
   */
  lotIsShore(lx: number, ly: number): boolean {
    if (!this.lotIsLand(lx, ly)) return false;
    const tx = lx * LOT_PITCH + LOT_TILES;
    let water = 0;
    for (let dy = 0; dy < LOT_TILES; dy += 1) {
      if (!this.land(tx, ly * LOT_PITCH + dy)) water += 1;
    }
    return water >= 2 && !this.land(tx, ly * LOT_PITCH + 1);
  }

  orderScore(lx: number, ly: number): number {
    const cx = lx + 0.375;
    const cy = ly + 0.375;
    return Math.sqrt(cx * cx + cy * cy) + unit(this.jitter, lx, ly) * 0.9;
  }
}

function lotKey(lx: number, ly: number): number {
  return (lx + 32768) * 65536 + (ly + 32768);
}

interface Candidate {
  lx: number;
  ly: number;
  score: number;
}

/**
 * The single global lot order, extended ring by ring. A lot in ring r = max(|lx|, |ly|) has a score
 * of at least r - 0.375, so once rings 0..R exist, every candidate scoring below R + 0.625 is final.
 */
class CandidateOrder {
  private readonly order: Candidate[] = [];
  private pool: Candidate[] = [];
  private ring = -1;
  private readonly field: IslandField;

  constructor(field: IslandField) {
    this.field = field;
  }

  at(index: number): Candidate | undefined {
    while (index >= this.order.length) {
      if (this.ring >= MAX_RING) return undefined;
      this.extend();
    }
    return this.order[index];
  }

  private extend(): void {
    const from = this.ring + 1;
    this.ring = Math.min(MAX_RING, this.ring + 4);
    for (let r = from; r <= this.ring; r += 1) {
      for (let lx = -r; lx <= r; lx += 1) {
        for (let ly = -r; ly <= r; ly += 1) {
          if (Math.max(Math.abs(lx), Math.abs(ly)) !== r) continue;
          this.pool.push({ lx, ly, score: this.field.orderScore(lx, ly) });
        }
      }
    }
    this.pool.sort((a, b) => a.score - b.score || a.lx - b.lx || a.ly - b.ly);
    const limit = this.ring >= MAX_RING ? Number.POSITIVE_INFINITY : this.ring + 0.625;
    let cut = 0;
    while (cut < this.pool.length && this.pool[cut]!.score < limit) cut += 1;
    for (let i = 0; i < cut; i += 1) this.order.push(this.pool[i]!);
    this.pool = this.pool.slice(cut);
  }
}

// ---------------------------------------------------------------- placement

export type PlacementClass = 'land' | 'shore';

export interface LayoutBuilding {
  id: number;
  placement: PlacementClass;
}

export interface PlacedLot {
  lx: number;
  ly: number;
  /** Building id, or null for a camp. */
  buildingId: number | null;
  /** Household id for a camp, otherwise null. */
  householdId: number | null;
}

export interface MapLayout {
  lots: PlacedLot[];
  unplacedBuildingIds: number[];
  unplacedHouseholdIds: number[];
  field: IslandField;
}

/**
 * Places buildings (sorted by id) and then camps. Shore buildings fall back to ordinary land when
 * no shore lot is left within the search bound, so a building is only unplaced if no land remains.
 */
export function layoutTown(seed: string, buildings: LayoutBuilding[], campHouseholdIds: number[]): MapLayout {
  const field = new IslandField(seed);
  const order = new CandidateOrder(field);
  const taken = new Set<number>();
  const lots: PlacedLot[] = [];
  const unplacedBuildingIds: number[] = [];
  const unplacedHouseholdIds: number[] = [];
  let landIndex = 0;
  let shoreIndex = 0;

  const nextLand = (): Candidate | undefined => {
    for (;;) {
      const candidate = order.at(landIndex);
      if (!candidate) return undefined;
      landIndex += 1;
      if (!taken.has(lotKey(candidate.lx, candidate.ly)) && field.lotIsLand(candidate.lx, candidate.ly)) return candidate;
    }
  };
  const nextShore = (): Candidate | undefined => {
    for (;;) {
      const candidate = order.at(shoreIndex);
      if (!candidate) return undefined;
      shoreIndex += 1;
      if (!taken.has(lotKey(candidate.lx, candidate.ly)) && field.lotIsShore(candidate.lx, candidate.ly)) return candidate;
    }
  };

  const sorted = [...buildings].sort((a, b) => a.id - b.id);
  for (const building of sorted) {
    const lot = (building.placement === 'shore' ? nextShore() : undefined) ?? nextLand();
    if (!lot) {
      unplacedBuildingIds.push(building.id);
      continue;
    }
    taken.add(lotKey(lot.lx, lot.ly));
    lots.push({ lx: lot.lx, ly: lot.ly, buildingId: building.id, householdId: null });
  }
  for (const householdId of [...campHouseholdIds].sort((a, b) => a - b)) {
    const lot = nextLand();
    if (!lot) {
      unplacedHouseholdIds.push(householdId);
      continue;
    }
    taken.add(lotKey(lot.lx, lot.ly));
    lots.push({ lx: lot.lx, ly: lot.ly, buildingId: null, householdId });
  }
  return { lots, unplacedBuildingIds, unplacedHouseholdIds, field };
}

// ---------------------------------------------------------------- terrain

/** Terrain codes: `~` deep sea, `-` shallow water, `.` beach, `g` ground, `#` road. */
export interface TerrainBox {
  x0: number;
  y0: number;
  width: number;
  height: number;
  /** One run-length encoded row per tile row: `<code><count>` pairs, e.g. `~12-2.1g9`. */
  rows: string[];
}

function encodeRow(codes: string[]): string {
  let out = '';
  let run = 1;
  for (let i = 1; i <= codes.length; i += 1) {
    if (i < codes.length && codes[i] === codes[i - 1]) {
      run += 1;
    } else {
      out += `${codes[i - 1]}${run}`;
      run = 1;
    }
  }
  return out;
}

function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Terrain around the main island and every occupied lot, with a margin. Roads run along the gaps
 * next to building lots; beaches are land beside the sea; shallows are sea beside land.
 */
export function buildTerrain(layout: MapLayout, margin = 8): TerrainBox {
  const { field } = layout;
  const reach = ISLAND_RADIUS + margin;
  let minX = ISLAND_CENTRE_X - reach;
  let minY = -reach;
  let maxX = Math.max(ISLAND_CENTRE_X + reach, margin);
  let maxY = reach;
  const buildingLots = new Set<number>();
  for (const lot of layout.lots) {
    if (lot.buildingId !== null) buildingLots.add(lotKey(lot.lx, lot.ly));
    minX = Math.min(minX, lot.lx * LOT_PITCH - margin);
    minY = Math.min(minY, lot.ly * LOT_PITCH - margin);
    maxX = Math.max(maxX, lot.lx * LOT_PITCH + LOT_PITCH + margin);
    maxY = Math.max(maxY, lot.ly * LOT_PITCH + LOT_PITCH + margin);
  }
  maxX = Math.min(maxX, minX + MAX_TERRAIN_SIDE - 1);
  maxY = Math.min(maxY, minY + MAX_TERRAIN_SIDE - 1);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  // Land mask with a one-tile apron so edge tiles can look at their neighbours.
  const stride = width + 2;
  const mask = new Uint8Array(stride * (height + 2));
  for (let y = -1; y <= height; y += 1) {
    for (let x = -1; x <= width; x += 1) {
      mask[(y + 1) * stride + (x + 1)] = field.land(minX + x, minY + y) ? 1 : 0;
    }
  }
  const at = (x: number, y: number): number => mask[(y + 1) * stride + (x + 1)]!;
  const hasBuilding = (lx: number, ly: number): boolean => buildingLots.has(lotKey(lx, ly));

  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    const codes: string[] = [];
    for (let x = 0; x < width; x += 1) {
      const tx = minX + x;
      const ty = minY + y;
      if (at(x, y)) {
        const gapX = floorMod(tx, LOT_PITCH) === LOT_TILES;
        const gapY = floorMod(ty, LOT_PITCH) === LOT_TILES;
        const lx = Math.floor(tx / LOT_PITCH);
        const ly = Math.floor(ty / LOT_PITCH);
        let road = false;
        if (gapX && gapY) road = hasBuilding(lx, ly) || hasBuilding(lx + 1, ly) || hasBuilding(lx, ly + 1) || hasBuilding(lx + 1, ly + 1);
        else if (gapX) road = hasBuilding(lx, ly) || hasBuilding(lx + 1, ly);
        else if (gapY) road = hasBuilding(lx, ly) || hasBuilding(lx, ly + 1);
        if (road) codes.push('#');
        else codes.push(at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1) ? 'g' : '.');
      } else {
        let nearLand = false;
        for (let dy = -1; dy <= 1 && !nearLand; dy += 1) {
          for (let dx = -1; dx <= 1 && !nearLand; dx += 1) if (at(x + dx, y + dy)) nearLand = true;
        }
        codes.push(nearLand ? '-' : '~');
      }
    }
    rows.push(encodeRow(codes));
  }
  return { x0: minX, y0: minY, width, height, rows };
}
