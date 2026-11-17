import type { Db } from '../storage/database.js';
import {
  CATALOG_KINDS,
  LOT_TILES,
  SPECIAL_KINDS,
  TILE_HEIGHT,
  TILE_WIDTH,
  capacityTier,
  savedMapOptions,
  layoutTown,
  type Biome,
  type LayoutBuilding,
  type TerrainBox,
} from './map-layout.js';
import { buildMapScene, type MapRoad, type MapTree } from './map-scenery.js';
import type { MapTerrain } from '../contracts/map.js';
import type { ReclaimedPatch } from '../domain/geography/land-field.js';

/** Response bounds: the map stays readable and the payload small even for a huge town. */
export const MAX_MAP_BUILDINGS = 5000;
export const MAX_MAP_CAMPS = 2000;

export interface MapLot {
  /** `b<id>` for a building, `c<householdId>` for a camp. */
  key: string;
  tx: number;
  ty: number;
  /** Atlas frame `<kind>_<tier>`, or null when the kind has no sprite yet. */
  frame: string | null;
  /** Authoritative reservation; new artwork alone cannot enlarge it. */
  footprint: { w: number; d: number };
  kind: string;
  tier: 1 | 2 | 3;
  name: string;
  buildingId: number | null;
  capacity: number;
  conditionPct: number | null;
  destroyed: boolean;
  /** What a site or abandoned site was meant to become. */
  plannedKind: string | null;
  business: { name: string; kind: string; status: string; staff: number } | null;
  /** Living members of households in this building (or the camp). */
  residents: number;
  households: number;
}

export interface MapView {
  world: { name: string; seed: string; scenarioVersion: string; day: number } | null;
  biome: Biome;
  terrainShape: MapTerrain;
  tile: { width: number; height: number; lotTiles: number };
  terrain: TerrainBox | null;
  lots: MapLot[];
  roads: MapRoad[];
  trees: MapTree[];
  roadTargetsOmitted: number;
  unplaced: { buildings: number; camps: number };
  truncated: { buildings: number; camps: number };
}

interface BuildingRow {
  id: number;
  name: string;
  kind: string;
  capacity: number;
  condition_bps: number;
  destroyed_day: number | null;
}

/**
 * Observer projection for the dashboard Map tab. Read-only: it never writes, and positions are
 * derived from the world seed and building ids (see map-layout.ts), not stored.
 */
export function mapView(db: Db, worldId: number): MapView {
  const world = db.get<{ name: string; seed: string; current_day: number; config_json: string }>(
    'select name, seed, current_day, config_json from worlds where id = ?',
    [worldId],
  );
  if (!world) {
    return {
      world: null, biome: 'tropical', terrainShape: 'island', tile: tileInfo(), terrain: null, lots: [], roads: [], trees: [], roadTargetsOmitted: 0,
      unplaced: { buildings: 0, camps: 0 }, truncated: { buildings: 0, camps: 0 },
    };
  }
  let storedConfig: unknown = {};
  try { storedConfig = JSON.parse(world.config_json); } catch { /* Legacy invalid metadata uses defaults. */ }
  const scenarioVersion = storedConfig && typeof storedConfig === 'object' && 'scenarioVersion' in storedConfig
    ? String(storedConfig.scenarioVersion ?? '') : '';
  const { biome, terrain: terrainShape } = savedMapOptions(storedConfig, scenarioVersion, world.seed, world.name);

  const allBuildings = db.all<BuildingRow>(
    'select id, name, kind, capacity, condition_bps, destroyed_day from buildings where world_id = ? order by id limit ?',
    [worldId, MAX_MAP_BUILDINGS + 1],
  );
  const buildings = allBuildings.slice(0, MAX_MAP_BUILDINGS);
  const totalBuildings = db.get<{ n: number }>('select count(*) as n from buildings where world_id = ?', [worldId])?.n ?? 0;

  // What each workplace site will become, so a fishery site is placed on the shore from day one.
  // Only the project that created the site counts (the first workplace project for that building),
  // so a later project can never change an existing building's placement class and move it.
  const planned = new Map<number, string>();
  for (const row of db.all<{ building_id: number | null; business_kind: string | null }>(
    `select json_extract(project_json, '$.targetBuildingId') as building_id,
            json_extract(project_json, '$.businessKind') as business_kind
       from construction_projects
      where world_id = ? and json_extract(project_json, '$.kind') = 'workplace'
      order by id`,
    [worldId],
  )) {
    if (typeof row.building_id !== 'number' || typeof row.business_kind !== 'string') continue;
    if (!planned.has(row.building_id)) planned.set(row.building_id, row.business_kind);
  }

  const businesses = new Map<number, { name: string; kind: string; status: string; staff: number }>();
  for (const row of db.all<{ building_id: number; name: string; kind: string; status: string; staff: number }>(
    `select b.building_id, b.name, b.kind, b.status,
            (select count(*) from contracts c where c.world_id = b.world_id and c.business_id = b.id
              and c.kind = 'employment' and c.status = 'active') as staff
       from businesses b where b.world_id = ? and b.building_id is not null order by b.id`,
    [worldId],
  )) {
    const current = businesses.get(row.building_id);
    // Prefer an open business when a building has housed several over time.
    if (!current || (current.status !== 'open' && row.status === 'open')) businesses.set(row.building_id, row);
  }

  const occupancy = new Map<number, { households: number; residents: number }>();
  const camps: { id: number; name: string; members: number; capacity: number }[] = [];
  for (const row of db.all<{ id: number; name: string; building_id: number | null; capacity: number; members: number }>(
    `select h.id, h.name, h.building_id, h.capacity,
            (select count(*) from residents r where r.world_id = h.world_id and r.household_id = h.id and r.status = 'living') as members
       from households h where h.world_id = ? and h.dissolved_day is null order by h.id`,
    [worldId],
  )) {
    if (row.building_id === null) {
      if (row.members > 0) camps.push(row);
      continue;
    }
    const entry = occupancy.get(row.building_id) ?? { households: 0, residents: 0 };
    entry.households += 1;
    entry.residents += row.members;
    occupancy.set(row.building_id, entry);
  }
  const shownCamps = camps.slice(0, MAX_MAP_CAMPS);

  const layoutInput: LayoutBuilding[] = buildings.map((building) => {
    const target = planned.get(building.id) ?? building.kind;
    return { id: building.id, placement: target === 'fishery' || building.kind === 'fishery' ? 'shore' : 'land' };
  });
  // Reclaimed land is authoritative world state; the map only reads it.
  const patches: ReclaimedPatch[] = db.all<{ id: number; project_id: number; tx: number; ty: number; size: number; from_building_id: number; completed_day: number }>(
    'select id, project_id, tx, ty, size, from_building_id, completed_day from reclaimed_land where world_id = ? order by id', [worldId],
  ).map((row) => ({ id: row.id, projectId: row.project_id, tx: row.tx, ty: row.ty, size: row.size, fromBuildingId: row.from_building_id, completedDay: row.completed_day }));
  const layout = layoutTown(world.seed, layoutInput, shownCamps.map((camp) => camp.id), terrainShape, patches);

  const byId = new Map(buildings.map((building) => [building.id, building]));
  const campById = new Map(shownCamps.map((camp) => [camp.id, camp]));
  const lots: MapLot[] = [];
  for (const lot of layout.lots) {
    if (lot.buildingId !== null) {
      const building = byId.get(lot.buildingId)!;
      const destroyed = building.destroyed_day !== null;
      const special = destroyed ? 'destroyed' : SPECIAL_KINDS.has(building.kind) ? building.kind : null;
      const tier = special ? 1 : capacityTier(building.kind, building.capacity);
      const spriteKind = special ?? (CATALOG_KINDS.has(building.kind) ? building.kind : null);
      const occupants = occupancy.get(building.id) ?? { households: 0, residents: 0 };
      lots.push({
        key: `b${building.id}`, tx: lot.tx, ty: lot.ty,
        frame: spriteKind ? `${spriteKind}_${tier}` : null,
        footprint: { w: LOT_TILES, d: LOT_TILES },
        kind: building.kind, tier, name: building.name, buildingId: building.id,
        capacity: building.capacity, conditionPct: Math.round(building.condition_bps / 100), destroyed,
        plannedKind: planned.get(building.id) ?? null,
        business: businesses.get(building.id) ?? null,
        residents: occupants.residents, households: occupants.households,
      });
    } else if (lot.householdId !== null) {
      const camp = campById.get(lot.householdId)!;
      lots.push({
        key: `c${camp.id}`, tx: lot.tx, ty: lot.ty, frame: 'camp_1', footprint: { w: LOT_TILES, d: LOT_TILES }, kind: 'camp', tier: 1, name: camp.name,
        buildingId: null, capacity: camp.capacity, conditionPct: null, destroyed: false, plannedKind: null,
        business: null, residents: camp.members, households: 1,
      });
    }
  }
  return {
    world: { name: world.name, seed: world.seed, scenarioVersion, day: world.current_day },
    biome,
    terrainShape,
    tile: tileInfo(),
    ...buildMapScene(world.seed, layout, biome),
    lots,
    unplaced: { buildings: layout.unplacedBuildingIds.length, camps: layout.unplacedHouseholdIds.length },
    truncated: { buildings: Math.max(0, totalBuildings - buildings.length), camps: camps.length - shownCamps.length },
  };
}

function tileInfo() {
  return { width: TILE_WIDTH, height: TILE_HEIGHT, lotTiles: LOT_TILES };
}
