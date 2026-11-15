/**
 * Deterministic town-map layout for the dashboard Map tab. Presentation only: nothing here is
 * stored, and nothing feeds back into the simulation.
 *
 * Coordinates. One tile is 32x16 screen pixels. Each building reserves 3x3 tiles at an
 * explicit seed-selected tile origin, with variable setbacks. No pitch-aligned building slots.
 * Tile (tx,ty) projects to ((tx-ty)*16,(tx+ty)*8).
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

import { MAP_TERRAINS, type FoundingMapOptions, type StoredMapOptions, type MapTerrain } from '../contracts/map.js';
import { IslandField, ISLAND_CENTRE_X, ISLAND_RADIUS, LOT_TILES, seedSalt, type ReclaimedPatch } from '../domain/geography/land-field.js';
import { layoutTown, nextFreeLot, MAX_RING, type MapLayout, type LayoutBuilding, type PlacedLot, type PlacementClass } from '../domain/geography/layout.js';

export { IslandField, ISLAND_CENTRE_X, ISLAND_RADIUS, LOT_TILES, layoutTown, nextFreeLot, MAX_RING };
export type { ReclaimedPatch, MapLayout, LayoutBuilding, PlacedLot, PlacementClass };

export const TILE_WIDTH = 32;
export const TILE_HEIGHT = 16;
/** Most tiles an edge may widen to finish an islet (islets are a few tiles across). */
const ISLET_EDGE_STEPS = 24;
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

/** Resolve 'auto' once at founding; storing actual choices decouples restarts from environment. */
export function resolveMapOptions(scenarioVersion: string, seed: string, options?: Partial<FoundingMapOptions>): StoredMapOptions {
  const biome = isEden(scenarioVersion) ? 'tropical'
    : options?.biome && options.biome !== 'auto' ? options.biome : chooseBiome(scenarioVersion, seed);
  const terrain = options?.terrain === 'auto' ? MAP_TERRAINS[seedSalt(seed, 'terrain-choice') % MAP_TERRAINS.length]!
    : options?.terrain ?? 'island';
  return { biome, terrain };
}

/** Read stored visual choices; pre-setting saves stay on their legacy seed biome + island. */
export function savedMapOptions(config: unknown, scenarioVersion: string, seed: string, worldName: string): StoredMapOptions {
  const map = config && typeof config === 'object' && 'map' in config ? config.map : null;
  const value = map && typeof map === 'object' ? map as Partial<StoredMapOptions> : {};
  const terrain = MAP_TERRAINS.includes(value.terrain as MapTerrain) ? value.terrain! : 'island';
  const biome = BIOMES.includes(value.biome as Biome) ? value.biome! : chooseBiome(scenarioVersion, seed, worldName);
  return { biome: isEden(scenarioVersion) ? 'tropical' : biome, terrain };
}

/** Same presentation thresholds as `K.tier` in art/catalog.lua. Never a gameplay rule. */
export function capacityTier(kind: string, capacity: number): 1 | 2 | 3 {
  const [small, medium] = kind === 'home' ? [6, 12] : [6, 20];
  if (capacity <= small) return 1;
  return capacity <= medium ? 2 : 3;
}

// ---------------------------------------------------------------- terrain

/** Terrain codes: `~` deep sea, `-` shallow water, `.` beach, `g` ground. */
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

/**
 * Terrain around the main island and every occupied lot, with a margin. Beaches are land beside
 * the sea; shallows are sea beside land. Walkable paths are returned separately by map-scenery.ts.
 */
export function buildTerrain(layout: MapLayout, margin = 8): TerrainBox {
  const { field } = layout;
  const reach = ISLAND_RADIUS + margin;
  let minX = ISLAND_CENTRE_X - reach;
  let minY = -reach;
  let maxX = Math.max(ISLAND_CENTRE_X + reach, margin);
  let maxY = reach;
  for (const lot of layout.lots) {
    minX = Math.min(minX, lot.tx - margin);
    minY = Math.min(minY, lot.ty - margin);
    maxX = Math.max(maxX, lot.tx + LOT_TILES + margin);
    maxY = Math.max(maxY, lot.ty + LOT_TILES + margin);
  }
  // Reclaimed land is part of the island: the view must grow with it, or new land would be cut off.
  for (const patch of field.patches) {
    minX = Math.min(minX, patch.tx - margin);
    minY = Math.min(minY, patch.ty - margin);
    maxX = Math.max(maxX, patch.tx + patch.size + margin);
    maxY = Math.max(maxY, patch.ty + patch.size + margin);
  }
  // An island is surrounded by sea, so no islet may be sliced by the edge of the view: keep widening
  // a side while land touches it. Bounded (islets are small), and never for a mainland, which has no
  // far shore to reach. The cap below still applies.
  if (field.terrain === 'island') {
    const touches = (fixed: 'x' | 'y', at: number, from: number, to: number): boolean => {
      for (let v = from; v <= to; v += 1) {
        if (fixed === 'x' ? field.land(at, v) : field.land(v, at)) return true;
      }
      return false;
    };
    for (let step = 0; step < ISLET_EDGE_STEPS; step += 1) {
      let grew = false;
      if (touches('x', minX, minY, maxY)) { minX -= 1; grew = true; }
      if (touches('x', maxX, minY, maxY)) { maxX += 1; grew = true; }
      if (touches('y', minY, minX, maxX)) { minY -= 1; grew = true; }
      if (touches('y', maxY, minX, maxX)) { maxY += 1; grew = true; }
      if (!grew) break;
    }
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

  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) {
    const codes: string[] = [];
    for (let x = 0; x < width; x += 1) {
      if (at(x, y)) {
        codes.push(at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1) ? 'g' : '.');
      } else {
        let nearLand = false;
        for (let dy = -1; dy <= 1 && !nearLand; dy += 1) {
          for (let dx = -1; dx <= 1 && !nearLand; dx += 1) if (at(x + dx, y + dy)) nearLand = true;
        }
        codes.push(field.terrain === 'river_plain' || nearLand ? '-' : '~');
      }
    }
    rows.push(encodeRow(codes));
  }
  return { x0: minX, y0: minY, width, height, rows };
}
