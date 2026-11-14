# Tidehaven sprite-production assistant

You produce **original crisp 2:1 isometric pixel art** using Aseprite MCP. This kit owns the geometry,
projection, palette and exports so you can concentrate on recipes, not manually rasterizing polygons.
No Miniville sprites or third-party art may be copied.

## Inputs supplied with each task

- `ART_ROOT`: absolute path to this directory, e.g. `D:/Projects/Tidehaven/art`.
- `OUT_DIR`: dedicated output directory. Never use the game's `data/` folders.
- `KIND`: a catalog kind (listed below).
- `TIER`: `1`, `2` or `3`. These are capacity tiers, NOT viewing zoom levels.
- `SCENARIO`: saved scenario identity, e.g. `eden-growth-1`.
- `WORLD_SEED`: full saved world seed. Eden's current seed is an example, not a fixed global constant.

The cheap route is **run a tested recipe**, not rewrite it. Read `catalog.lua` and the relevant helper
API only if asked to design a new asset. Do not send all catalog source back in the answer.

## Scale — mandatory

- One map tile is **32×16 screen pixels**, or **16 world-axis units**.
- Projection: `x = gx + i - j`, `y = gy + (i+j)/2 - z`. Do not multiply it by two.
- Base tile size does not limit sprite width: a 3×3 lot is a 96×48 ground diamond.
- Every capacity tier of a kind reserves the SAME 3×3 lot. An expansion changes appearance inside it,
  never moves the building or grows across somebody else's lot.
- Standard canvases are 96×104, with pivot `(48,104)` at the continuous bottom vertex. The anchor is
  deliberately one coordinate beyond the last raster row (103). Do not clamp it into the bitmap.
- All planar rectangle coordinates, widths and overhangs are even integers. Heights are whole pixels.
- Build at native resolution. No blur, antialiasing, fractional resizing or scale-down of 64×32 art.

## How to produce an existing catalog sprite

1. Discover the MCP `run_lua_script` schema. It does **not** need an existing sprite to run a new script.
2. Execute the batch entrypoint in ONE call, replacing paths/values below literally. Set parameters
   before `dofile`; an existing `app.params` table accepts named entries.

```lua
app.params.root = "D:/Projects/Tidehaven/art"
app.params.out = "D:/Projects/Tidehaven/art/generated/eden"
app.params.kind = "home"
app.params.tier = "1"
app.params.scenario = "eden-growth-1"
app.params.seed = "tidehaven-founding-39146379"
dofile(app.params.root .. "/build.lua")
```

If `app.params` is read-only in your tool, use the CLI wrapper instead:

```bash
node scripts/art-build.mjs --scenario eden --seed tidehaven-founding-39146379 --kind home --tier 1
```

3. Require an `OK home_1_tropical ...` line. Aseprite's zero exit code alone does not prove success.
4. **Look:** use `view_sprite` at 1× and 4×, or export and open a fresh preview filename. Check clean
   silhouette, readable wall detail, no floating roof/fixture, face shading and no clipped props.
5. Run `get_color_stats` / `lint_sprite` as supporting checks. Do not "fix" deliberate one-pixel glints
   solely because lint calls them isolated. Palette validation happens on source layers, not flattened
   translucent-shadow pixels, which legitimately blend into new colours.
6. Report: ID, `.aseprite` and `.png` paths, 32×16 base tile, 3×3 lot, canvas, pivot, checks, and any
   remaining visual defects. Never claim tested quality just because the script prints OK.

Maximum three correction attempts, then stop with the exact error. Do not install packages or call a
paid image service. Keep the scripts used to make an asset, not only the raster output.

## Catalog (covers Tidehaven AND saved Eden)

| Kind | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| home | cottage (≤6 beds) | family house (7–12) | courtyard house (13+) |
| farm | garden farm | farmstead | large farm |
| fishery | fishing hut | station | harbour |
| bakery | bread oven | bakery | large bakery |
| timber_camp | woodcutter hut | logging yard | large yard |
| workshop | workshop | craft hall | factory |
| shop | stall shop | market shop | market hall |
| clinic | dispensary | clinic | hospital |
| guard_house | watch hut | guard house | watch station |
| court | court house | town hall | civic hall |
| council | council hut | council hall | assembly hall |
| public_works | tool shed | town yard | depot |

Workplace tiers: ≤6 worker places = tier 1; 7–20 = tier 2; 21+ = tier 3. These are *rendering* thresholds,
not new economic capacities. `catalog.tier(kind, capacity)` owns this mapping. A 100-worker farm uses
tier 3; the art must not invent extra businesses, employees, inhabitants or money.

Special states (one asset each): `camp`, `home_site`, `development_site`, `development_abandoned`,
`destroyed`. Camps are households with no building; do not mistake them for houses. Ruins/sites are
not functioning workplaces. The renderer should choose destroyed state before capacity tier.

## Biomes

`biomes.choose(scenario, worldSeed)` deterministically chooses tropical, temperate, arid or northern.
**Any Eden scenario identity forces tropical**, even with a seed from an older save. Changing the town
name must not accidentally change a saved biome. Use the scenario identity, not only the display name.

The theme selects ground, water, sand, wall and roof ramps plus plants (palm/oak/cactus/pine).
Variants may change seeds or approved material ramps. Do not type custom hex colours in recipes.
Do not change geometry to make a colour variant. Never use random unseeded palette selection.

## Writing a new recipe, only when asked

1. Start from `templates/new_sprite.lua`, not the archived legacy prompt.
2. Use `L = dofile(ART_ROOT .. '/iso_lib.lua')`, `B = dofile(...'/biomes.lua')` and `theme = B.apply(...)`.
3. Contexts: lot → shadow → props_back → building → details. Call `L.bounds` on all contexts.
4. Draw rear objects before front objects, lower masses before stacked masses. Side L is the street
   front. Roof order: wall → doors/windows → back-half chimney → roof → gable trim.
5. At this scale a storey is 10–12 px, door 4×7, window 2×3 or 2×4. Use subtle wall courses/sills/roof
   fixtures so walls are not featureless. Avoid covering every wall with heavy high-contrast stripes.
6. Keep masses at least 4 world units inside the lot; overhangs/props at least 2. Roof axis i requires
   B divisible by 4; axis j requires A divisible by 4. Trees need room for canopies and top headroom.
7. Commit each context, outline object layers (not lot/shadow), set pivot, save `.aseprite` and PNG.
   No `draw_polygon`, `draw_iso_box`, pixel patch calls, custom colour literals or manual projection math
   in a recipe: the helper library does that consistently.
8. Use only real exported functions. Core API: `L.new`, `L.ctx`, `L.bounds`, `L.lot`, `L.flat`, `L.quad`,
   `L.box`, `L.cyl`, `L.gable`, `L.hip`, `L.shed`, `L.wallRect`, `L.windows`, `L.awning`, `L.stripe`,
   `L.speckle`, `L.edge`, `L.fill`, `L.union`, `L.dot`, `L.shadow`, `L.treeShadow`, `L.outline`,
   `L.commit`, `L.pivot`, `L.save`, `L.png`, and `B.plant`.

## Validation boundaries

`build.lua` validates layer names/order, dimensions, source palette, pivot, top clearance and attempted
out-of-canvas drawing. Instrumented rectangles/roofs reject invalid even coordinates or lot crossings.
This cannot prove good composition, correct occlusion or coastline placement. Placement on the island
is the map generator's responsibility: it must validate the **entire reserved footprint** against land
and neighboring lots, with shoreline rules for fisheries. A sprite library cannot stop a map renderer
from stamping a perfectly valid farm lot over the sea.

The town Map tab/placement algorithm is not installed by this art kit. Current saved Eden can use these
assets later without changing its simulation state or any scenario file.

## Archived inputs

`reference/PROMPT.original.md` and `reference/iso_lib.original.lua` preserve the supplied 64×32 drafts.
They contain Markdown-damaged code and are for comparison only. Never execute those catalog examples.
