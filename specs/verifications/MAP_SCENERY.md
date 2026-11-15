# Map scenery verification

## Scope
Seeded branching paths, biome vegetation and user-requested placement v2 refresh. All visual positions
intentionally reshuffled once; no domain rules, schema, saves or sprite recipes changed.

## Automated evidence
- `npm run verify`: 253 tests pass; server/client type checks, lint and production build pass.
- `npm run test:e2e`: 9 browser tests pass, including Map drawing and building selection.
- Scenery unit tests: identical inputs, different seeds, segment-sampled land/lot exclusion, tree/road/sea clearance,
  diagonal open-ground routes, world-anchored tree candidates, empty towns, arid density, 5,000-building limits.
- Placement v2: explicit tile origins, all four modulo-4 offsets represented, variable gaps, full
  footprint disjointness and at least one tile between lots; future building-prefix stability tested.
- Integration: new scenery fields, missing world, deterministic/read-only query (SQLite total_changes and state hash).
- Native road raster check: no partial-alpha pixels at 1x; 48 tree size/biome/variant sprites have no clipped edges.

## Founding landscape settings
- TIDEHAVEN_BIOME: auto/tropical/temperate/arid/northern; TIDEHAVEN_TERRAIN: island/coast/river_plain/auto.
- Config accepts valid enums, rejects typos, uses biome auto + terrain island by default.
- createTown persists resolved choices in existing worlds.config_json.map; returned WorldRow matches storage.
- Save/load retains metadata; map reads do not write; changed environment cannot retheme an existing world.
- Legacy saves retain seed biome + island; Eden scenarios always tropical.
- All three shapes tested for morphology, reproducibility, land footprints, fishery shore and dry-only paths.
- No bridge artwork exists in catalog/atlas. No crossings are fabricated; river land components have separate paths.

## Visual checks
Browser on paused Eden SNAPSHOT at port 4527, never its real runner: 15 buildings, 4 camps, 15 path connections,
169 tropical palms, no omitted connections or browser errors. Reviewed 1x, 2x, whole-island 0.5x, mobile width,
and alternate biome rendering. Temporary preview server must be stopped after review.

## Boundaries and limits
- Removed pitch-4 slots: irregular seed-ordered tile origins and variable 1–3 tile setbacks.
  Sprites remain aligned to the isometric axes, not rotated arbitrarily. Roads route around actual footprints.
- Max96 building connection targets,3000 A* expansions/target,200000 total expansions,20000 returned road points,
  max1200 trees; omitted/failed connections are reported in API/UI. No routes over water to remote islets.
- Placement search limited to radius360 tile origins and terrain768x768. A 5000-building stress seed
  placed2073, reported2927 unplaced, with92 paths/171 trees and1981 omitted connections. Local measured
  680ms placement +86ms scenery. Twenty80-building seeds: prefix stability passes, max3 omitted paths,
  worst combined generation39ms. Illustrative measurements, not latency guarantees.
- Vegetation is decorative; it does not create harvestable timber. New development can clear nearby trees.

## Self-audit
- PASS security/supply chain: no dependencies, network calls, secrets, raw HTML or write endpoint added.
- PASS scope/types: read-only application + dashboard; typed scenery, no `any`/type suppressions.
- PASS correctness: separate traversable land components get separate root paths (shore-first outposts cannot
  strand the inland town); global exclusion-mask keys avoid row aliasing; diagonal paths require both corner neighbours;
  coordinate-keyed jitter joins shared paths; irregular placement has land/spacing/prefix regressions.
- PASS performance: bounded search/output, cached native tree bitmaps, viewport-sized renderer,
  memoized depth ordering, viewport-culled road segments and no canvas resizing during ordinary pans.
- Independent review found no security, persistence or placement-integrity issue. Render-cost concern
  addressed above; equal-depth objects now paint trees before buildings. Trail brush extends about
  3 screen pixels around its centreline; boundary access spurs intentionally touch lot edges.
  Centreline/segment land clearance is tested; raster-perfect shoreline clipping is not claimed.
- Style exception: scenery module exceeds300 lines because bounded A* and scene generation are kept together;
  private helpers separate heap, routing, clearance and seeded candidate generation.
