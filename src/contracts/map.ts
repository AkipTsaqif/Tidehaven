/** Founding-only visual choices, not simulation rules or mutable runtime settings. */
export const MAP_BIOMES = ['tropical', 'temperate', 'arid', 'northern'] as const;
export const MAP_TERRAINS = ['island', 'coast', 'river_plain'] as const;
export type MapBiome = (typeof MAP_BIOMES)[number];
export type MapTerrain = (typeof MAP_TERRAINS)[number];
export interface FoundingMapOptions {
  biome: MapBiome | 'auto';
  terrain: MapTerrain | 'auto';
}
export interface StoredMapOptions {
  biome: MapBiome;
  terrain: MapTerrain;
}
