/**
 * Deterministic building placement on the land field. Pure: shared by the dashboard map and by the
 * simulation's reclamation rules (which must know where free lots are). Imports only geography.
 *
 * Stability. The island is a fixed function of the world seed, and candidate lots form one fixed
 * order (nearest the centre first, with seeded jitter). Buildings are placed in id order, and each one
 * takes the first free lot it can use, so a building's lot depends only on buildings with smaller ids
 * and on the reclaimed patches completed before it existed. Earlier buildings never move as the town
 * or the island grows. Camps fill the next free lots after all buildings.
 */
import type { MapTerrain } from '../../contracts/map.js';
import { IslandField, LOT_TILES, lotKey, type ReclaimedPatch } from './land-field.js';

/** Hard search bound in tile origins from the centre; beyond it a building is reported as unplaced. */
export const MAX_RING = 360;

interface Candidate {
  tx: number;
  ty: number;
  score: number;
}

/** Lazy centre-out candidate stream over every tile origin, not a coarser slot lattice.
 * Unseen ring R+1 scores at least R-0.5; finalize only scores below R-1.
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
    this.ring = Math.min(MAX_RING, this.ring + 8);
    const append = (tx: number, ty: number) => this.pool.push({ tx, ty, score: this.field.orderScore(tx, ty) });
    for (let r = from; r <= this.ring; r += 1) {
      if (r === 0) { append(0, 0); continue; }
      for (let t = -r; t <= r; t += 1) {
        append(t, -r);
        append(t, r);
        if (Math.abs(t) < r) { append(-r, t); append(r, t); }
      }
    }
    this.pool.sort((a, b) => a.score - b.score || a.tx - b.tx || a.ty - b.ty);
    const limit = this.ring >= MAX_RING ? Number.POSITIVE_INFINITY : this.ring - 1;
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
  /** Top/back corner of the reserved 3x3 footprint, in tiles (not slot indices). */
  tx: number;
  ty: number;
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
export function layoutTown(
  seed: string,
  buildings: LayoutBuilding[],
  campHouseholdIds: number[],
  terrain: MapTerrain = 'island',
  patches: readonly ReclaimedPatch[] = [],
): MapLayout {
  const field = new IslandField(seed, terrain, patches);
  const order = new CandidateOrder(field);
  const taken = new Set<number>();
  const free = (candidate: Candidate): boolean => {
    const gap = field.setback(candidate.tx, candidate.ty);
    for (let y = -gap; y < LOT_TILES + gap; y += 1) {
      for (let x = -gap; x < LOT_TILES + gap; x += 1) {
        if (taken.has(lotKey(candidate.tx + x, candidate.ty + y))) return false;
      }
    }
    return true;
  };
  const reserve = (candidate: Candidate) => {
    for (let y = 0; y < LOT_TILES; y += 1) for (let x = 0; x < LOT_TILES; x += 1) {
      taken.add(lotKey(candidate.tx + x, candidate.ty + y));
    }
  };
  const lots: PlacedLot[] = [];
  const unplacedBuildingIds: number[] = [];
  const unplacedHouseholdIds: number[] = [];
  // One monotonic pointer per reclamation level: a building only sees the patches completed before it
  // existed, so a tile that was sea for an older building may be land for a newer one.
  const pointers = new Map<number, { land: number; shore: number }>();
  const pointer = (limit: number) => {
    let p = pointers.get(limit);
    if (!p) { p = { land: 0, shore: 0 }; pointers.set(limit, p); }
    return p;
  };

  const nextLand = (limit: number): Candidate | undefined => {
    const p = pointer(limit);
    for (;;) {
      const candidate = order.at(p.land);
      if (!candidate) return undefined;
      p.land += 1;
      if (field.lotIsLand(candidate.tx, candidate.ty, limit) && free(candidate)) return candidate;
    }
  };
  const nextShore = (limit: number): Candidate | undefined => {
    const p = pointer(limit);
    for (;;) {
      const candidate = order.at(p.shore);
      if (!candidate) return undefined;
      p.shore += 1;
      if (field.lotIsShore(candidate.tx, candidate.ty, limit) && free(candidate)) return candidate;
    }
  };

  const sorted = [...buildings].sort((a, b) => a.id - b.id);
  for (const building of sorted) {
    const limit = field.limitForBuilding(building.id);
    const lot = (building.placement === 'shore' ? nextShore(limit) : undefined) ?? nextLand(limit);
    if (!lot) {
      unplacedBuildingIds.push(building.id);
      continue;
    }
    reserve(lot);
    lots.push({ tx: lot.tx, ty: lot.ty, buildingId: building.id, householdId: null });
  }
  for (const householdId of [...campHouseholdIds].sort((a, b) => a - b)) {
    const lot = nextLand(patches.length);
    if (!lot) {
      unplacedHouseholdIds.push(householdId);
      continue;
    }
    reserve(lot);
    lots.push({ tx: lot.tx, ty: lot.ty, buildingId: null, householdId });
  }
  return { lots, unplacedBuildingIds, unplacedHouseholdIds, field };
}

/**
 * The lot the next new building (id `nextBuildingId`) would take, without reserving it. Used by the
 * reclamation scarcity rule: how far from the town centre is the nearest free building footprint?
 */
export function nextFreeLot(
  seed: string,
  buildings: LayoutBuilding[],
  campHouseholdIds: number[],
  terrain: MapTerrain,
  patches: readonly ReclaimedPatch[],
  nextBuildingId: number,
): { tx: number; ty: number } | null {
  const probeId = Math.max(nextBuildingId, ...buildings.map((b) => b.id + 1));
  const layout = layoutTown(seed, [...buildings, { id: probeId, placement: 'land' }], campHouseholdIds, terrain, patches);
  const lot = layout.lots.find((l) => l.buildingId === probeId);
  return lot ? { tx: lot.tx, ty: lot.ty } : null;
}

