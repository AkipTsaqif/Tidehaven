# Impact — founding biome and terrain settings

## Target
Founding-only TIDEHAVEN_BIOME (auto/tropical/temperate/arid/northern), TIDEHAVEN_TERRAIN
(island/coast/river_plain/auto). Resolved choices stored under worlds.config_json.map using the existing
JSON metadata column; no migration or coordinate storage. Existing saves retain seed biome + island.

## Dependents
config.ts -> main.createTown -> bootstrap metadata -> map-query -> IslandField/layout/scenery -> TownMap label.
Tests: config validation, bootstrap persistence/read-back/save/resume, legacy map defaults, terrain morphology,
full land-footprint and fishery shoreline, road segments never cross water without bridges, browser variants.

## Risk: Medium
Founding code and observer metadata change, not domain outcomes or scenario/rules hashes.
No settings written on resume. Metadata persisted once and returned consistently.

## Bridge scope
No bridge sprites exist in building atlas/catalog. This change does not invent invisible crossings:
river land components keep separate path networks. Bridge art + constrained crossing generation is follow-up.

## Recommended action
Implement settings, preserve legacy saves, verify in-memory founding plus shape snapshots and full gates.
