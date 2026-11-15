/**
 * Pure, deterministic land geometry shared by the simulation and the dashboard map.
 *
 * The domain layer may import this module; it imports nothing from the application, storage, model
 * or HTTP layers. Only integer hashing, + - * / floor and sqrt (exactly specified by IEEE 754) are used:
 * no trigonometry, wall clock or Math.random. Changing any number here changes every town's coastline.
 */
import { MAP_TERRAINS, type MapTerrain } from '../../contracts/map.js';

/**
 * Land added by a completed reclamation project. `fromBuildingId` is the next building id at completion:
 * the patch counts as land only for buildings with that id or higher, so an existing building can never
 * be pulled to a new spot because the coast grew. Patches are append-only and ordered by fromBuildingId.
 */
export interface ReclaimedPatch {
  id: number;
  projectId: number;
  tx: number;
  ty: number;
  size: number;
  fromBuildingId: number;
  completedDay: number;
}

export const LOT_TILES = 3;
/** Main island radius in tiles: room for a few hundred lots before islets take the overflow. */
export const ISLAND_RADIUS = 40;
/**
 * The town starts near the island's east coast (a harbour town), so the island centre sits west of
 * the origin. The offset keeps lot (0, 0) on land for every seed (coast noise is at most +-0.325 of
 * the radius) while the shore stays a few lots away, which keeps fisheries close to the town.
 */
export const ISLAND_CENTRE_X = -(ISLAND_RADIUS - 16);

// ---------------------------------------------------------------- seeded field

export function seedSalt(seed: string, label: string): number {
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
  private readonly lotLand = new Map<number, Map<number, boolean>>();
  readonly terrain: MapTerrain;
  readonly patches: readonly ReclaimedPatch[];

  constructor(seed: string, terrain: MapTerrain = 'island', patches: readonly ReclaimedPatch[] = []) {
    this.terrain = terrain;
    this.patches = patches;
    this.coast1 = seedSalt(seed, 'coast-1');
    this.coast2 = seedSalt(seed, 'coast-2');
    this.islet = seedSalt(seed, 'islet');
    this.jitter = seedSalt(seed, 'lot-order');
  }

  /** Number of patches that count as land for a building with this id (patches are ordered). */
  limitForBuilding(buildingId: number): number {
    let count = 0;
    while (count < this.patches.length && this.patches[count]!.fromBuildingId <= buildingId) count += 1;
    return count;
  }

  /**
   * True when tile (tx, ty) is land: the seed coastline plus the first `limit` reclaimed patches
   * (default all). Without patches it is a fixed function of the seed and never depends on town size.
   */
  land(tx: number, ty: number, limit: number = this.patches.length): boolean {
    if (this.seedLand(tx, ty)) return true;
    for (let i = 0; i < limit; i += 1) {
      const patch = this.patches[i]!;
      if (tx >= patch.tx && tx < patch.tx + patch.size && ty >= patch.ty && ty < patch.ty + patch.size) return true;
    }
    return false;
  }

  /** The original coastline, before any reclamation. */
  seedLand(tx: number, ty: number): boolean {
    const cx = tx + 0.5;
    const cy = ty + 0.5;
    if (this.terrain === 'coast') {
      // Unbounded mainland to the west, open sea to the east; no enclosing island edge.
      const coast = 15 + 10 * (valueNoise(this.coast1, 0, cy, 18) - 0.5)
        + 5 * (valueNoise(this.coast2, 0, cy, 7) - 0.5);
      return cx < coast;
    }
    if (this.terrain === 'river_plain') {
      // Two separated winding channels traversing the plain north/south. Both riverbanks are
      // valid fishing shore; the dry origin stays between the rivers for every seed.
      const bend = 6 * (valueNoise(this.coast1, 0, cy, 18) - 0.5)
        + 2 * (valueNoise(this.coast2, 0, cy, 7) - 0.5);
      const mainRiver = 10 + bend;
      const westRiver = -22 + bend * 1.3;
      return Math.abs(cx - mainRiver) > 1.5 && Math.abs(cx - westRiver) > 1;
    }
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
  lotIsLand(tx: number, ty: number, limit: number = this.patches.length): boolean {
    let cache = this.lotLand.get(limit);
    if (!cache) { cache = new Map(); this.lotLand.set(limit, cache); }
    const key = lotKey(tx, ty);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let ok = true;
    for (let dy = 0; dy < LOT_TILES && ok; dy += 1) {
      for (let dx = 0; dx < LOT_TILES && ok; dx += 1) {
        if (!this.land(tx + dx, ty + dy, limit)) ok = false;
      }
    }
    cache.set(key, ok);
    return ok;
  }

  /**
   * A shore lot is land with sea along its high-i edge (screen lower-right), where the fishery
   * sprite draws its own water strip and pier: the tile column just past the lot must be at least
   * two-thirds water, and the lot's own centre tile on that side must touch it.
   */
  lotIsShore(tx0: number, ty0: number, limit: number = this.patches.length): boolean {
    if (!this.lotIsLand(tx0, ty0, limit)) return false;
    const tx = tx0 + LOT_TILES;
    let water = 0;
    for (let dy = 0; dy < LOT_TILES; dy += 1) {
      if (!this.land(tx, ty0 + dy, limit)) water += 1;
    }
    return water >= 2 && !this.land(tx, ty0 + 1, limit);
  }

  orderScore(tx: number, ty: number): number {
    const cx = tx + 1.5;
    const cy = ty + 1.5;
    return Math.sqrt(cx * cx + cy * cy) + unit(this.jitter, tx, ty) * 5;
  }

  /**
   * Free tiles kept around a building's 3x3 footprint: 1 or 2, seeded. One tile is the narrowest a path
   * can pass; the occasional second tile keeps streets irregular instead of lining buildings up in rows.
   */
  setback(tx: number, ty: number): number {
    return 1 + Math.floor(unit(this.jitter ^ 0x928371, tx, ty) * 2);
  }

}

export function lotKey(tx: number, ty: number): number {
  return (tx + 32768) * 65536 + (ty + 32768);
}


/** Terrain stored in a world's config; saves that predate the setting are islands, as they always were. */
export function storedTerrain(config: unknown): MapTerrain {
  const map = config && typeof config === 'object' && 'map' in config ? (config as { map: unknown }).map : null;
  const terrain = map && typeof map === 'object' ? (map as { terrain?: unknown }).terrain : null;
  return MAP_TERRAINS.includes(terrain as MapTerrain) ? (terrain as MapTerrain) : 'island';
}
