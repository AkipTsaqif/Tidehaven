import type { MapTerrain } from '../../contracts/map.js';
import { IslandField, LOT_TILES, type ReclaimedPatch } from './land-field.js';
import { layoutTown, nextFreeLot, type LayoutBuilding } from './layout.js';

export interface SiteInput {
  seed: string;
  terrain: MapTerrain;
  patches: readonly ReclaimedPatch[];
  /** Live buildings in id order; shore buildings are fisheries (and fishery sites). */
  buildings: LayoutBuilding[];
  campHouseholdIds: number[];
  nextBuildingId: number;
  patchTiles: number;
  scarcityDistanceTiles: number;
  dockClearanceTiles: number;
  /** Squares already reserved by active projects. */
  reserved: readonly { tx: number; ty: number; size: number }[];
}

export type SiteResult =
  | { ok: true; tx: number; ty: number }
  | { ok: false; reason: 'land_not_scarce' | 'no_coastal_site' | 'terrain_not_supported' };

/** River plains have no sea edge to extend; reclamation is for islands and coasts only. */
export function terrainSupportsReclamation(terrain: MapTerrain): boolean {
  return terrain === 'island' || terrain === 'coast';
}

/** Distance in tiles, rounded down, from the town centre (tile 0,0) to a lot's centre. Integer maths. */
export function centreDistance(tx: number, ty: number): number {
  const cx = tx * 2 + LOT_TILES;
  const cy = ty * 2 + LOT_TILES;
  return Math.floor(Math.sqrt(cx * cx + cy * cy) / 2);
}

/** Scarce = the next building would sit farther than the threshold, or would have nowhere to go. */
export function landIsScarce(input: SiteInput): boolean {
  const lot = nextFreeLot(input.seed, input.buildings, input.campHouseholdIds, input.terrain, input.patches, input.nextBuildingId);
  return lot === null || centreDistance(lot.tx, lot.ty) > input.scarcityDistanceTiles;
}

/**
 * Deterministically choose where the next patch goes. The engine, never a model, picks the site:
 * the nearest square of open sea whose whole inner edge touches existing land, kept clear of every
 * dock (the tiles in front of and around each shore building) and of other reserved squares.
 * Ties break by tile coordinate, so the same world always gives the same answer.
 */
export function chooseReclamationSite(input: SiteInput): SiteResult {
  if (!terrainSupportsReclamation(input.terrain)) return { ok: false, reason: 'terrain_not_supported' };
  if (!landIsScarce(input)) return { ok: false, reason: 'land_not_scarce' };

  const field = new IslandField(input.seed, input.terrain, input.patches);
  const size = input.patchTiles;
  const lots = shoreLots(input);
  const clearance = input.dockClearanceTiles;
  const blocked = (tx: number, ty: number): boolean => {
    for (const lot of lots) {
      // Keep the rectangle around each dock lot, plus a margin, free of new land.
      const x0 = lot.tx - clearance;
      const y0 = lot.ty - clearance;
      const span = LOT_TILES + clearance * 2 + LOT_TILES; // lot + water strip in front + margins
      if (overlaps(tx, ty, size, x0, y0, span, span)) return true;
    }
    for (const r of input.reserved) {
      if (overlaps(tx, ty, size, r.tx - 1, r.ty - 1, r.size + 2, r.size + 2)) return true;
    }
    return false;
  };

  // Candidate squares are scanned in rings around the centre; the first valid one wins.
  const reach = 220;
  let best: { tx: number; ty: number; d: number } | null = null;
  for (let ring = 0; ring <= reach; ring += 1) {
    if (best && ring > best.d + size) break;
    for (let a = -ring; a <= ring; a += 1) {
      for (const [dx, dy] of ring === 0 ? [[0, 0]] : [[a, -ring], [a, ring], [-ring, a], [ring, a]]) {
        const tx = dx!;
        const ty = dy!;
        if (ring !== 0 && Math.max(Math.abs(tx), Math.abs(ty)) !== ring) continue;
        if (!squareIsSea(field, tx, ty, size)) continue;
        if (!squareTouchesLand(field, tx, ty, size)) continue;
        if (blocked(tx, ty)) continue;
        const d = centreDistance(tx, ty);
        if (!best || d < best.d || (d === best.d && (tx < best.tx || (tx === best.tx && ty < best.ty)))) {
          best = { tx, ty, d };
        }
      }
    }
  }
  return best ? { ok: true, tx: best.tx, ty: best.ty } : { ok: false, reason: 'no_coastal_site' };
}

function overlaps(ax: number, ay: number, aSize: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aSize > bx && ay < by + bh && ay + aSize > by;
}

function squareIsSea(field: IslandField, tx: number, ty: number, size: number): boolean {
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (field.land(tx + x, ty + y)) return false;
  return true;
}

/** The whole edge must be adjacent to land on at least one side, so the patch never floats or leaves a gap. */
function squareTouchesLand(field: IslandField, tx: number, ty: number, size: number): boolean {
  let touching = 0;
  for (let i = 0; i < size; i += 1) {
    if (field.land(tx - 1, ty + i)) touching += 1;
    if (field.land(tx + size, ty + i)) touching += 1;
    if (field.land(tx + i, ty - 1)) touching += 1;
    if (field.land(tx + i, ty + size)) touching += 1;
  }
  // At least half of one full side must border existing land: a firm join, not a corner touch.
  return touching >= Math.ceil(size / 2);
}

/** Where the map places every shore building (fisheries and fishery sites): the same placement code. */
function shoreLots(input: SiteInput): { tx: number; ty: number }[] {
  const shoreIds = new Set(input.buildings.filter((b) => b.placement === 'shore').map((b) => b.id));
  if (shoreIds.size === 0) return [];
  const layout = layoutTown(input.seed, input.buildings, input.campHouseholdIds, input.terrain, input.patches);
  return layout.lots
    .filter((lot) => lot.buildingId !== null && shoreIds.has(lot.buildingId))
    .map((lot) => ({ tx: lot.tx, ty: lot.ty }));
}
