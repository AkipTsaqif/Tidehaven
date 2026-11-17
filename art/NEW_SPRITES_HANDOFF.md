# Tidehaven expansion sprite production — complete artist handoff

**Read this file completely before editing.** Work in `D:/Projects/Tidehaven`.
This brief is for a cheaper coding model with terminal + Aseprite MCP access, not an image-only model.

## 0. Deliverable and boundaries

Produce original crisp 2:1 pixel-art sprites for:
1. Timber/stone bridge modules, including construction/damage/repair states.
2. Static personal/work/cargo boats.
3. Fishing boats and fish/ripple/net markers in water.
4. Five timeless vertical-building families, from mid-rise to megatall.
5. Transparent hazard/repair overlay components for existing buildings and towers.

**Your job is artwork.** You must not implement or modify gameplay, economic rules, saves, domain
state, boat catches, bridge routing, property acquisition, relocation, capacity ceilings or migrations.
A drawing cannot authorize a tower footprint or generate fish. A separate implementation plan covers
those real mechanics: `specs/SPRITES_AND_INFRASTRUCTURE_PLAN.md`.

### What is already working
- `art/iso_lib.lua`: tested projection, raster, boxes, roofs, facades, palette, deterministic texture.
- `art/biomes.lua`: four biome themes and vegetation.
- `art/expansion/catalog.json`: the exact inventory and geometry contract for this delivery.
- `art/expansion/build.lua`: executes the selected recipes in Aseprite and checks source pixels.
- `scripts/art-expansion.mjs`: batches a family, an identity, or the whole inventory per biome.
- `scripts/art-expansion-review.py`: complete-inventory checks, hash snapshots, family isolation and sheets.
- `scripts/art-atlas.py`: variable-size atlas v2 packer, with transparent gutters and exact RGBA crops.
- `client/src/map-assets.ts`: v1/v2 atlas normalization and footprint geometry helpers.
- Both map views use the same renderer with per-frame canvas sizes/pivots and full-height culling.

### What is NOT finished
The six `art/expansion/families/*.lua` files contain **draft executable scaffolds**, not approved art.
- Many bridge states/parts still resemble one another; stone modules need real arches and caps.
- Boat NE/SE/SW/NW are NOT yet four complete authored views. Loaded/damaged variants need real work.
- Starter towers are stepped boxes. They lack family identity, terraces, rooflets, buttresses and gardens.
- Damage severity variants are not yet differentiated and are NOT attached to live buildings.
- The new sprites are not gameplay entities and do not appear in normal `/api/map` responses.
- `status: "draft"` in the catalog is intentional. Do not mark unreviewed work approved.

Do not claim complete artwork because all drafts execute. Build checks are necessary, not sufficient.

## 1. Read only these inputs first

1. Project `AGENTS.md` (and inherited instructions).
2. This handoff.
3. `art/expansion/catalog.json` (filter to your assigned family).
4. Your assigned file in `art/expansion/families/`.
5. Relevant helper signatures in `art/iso_lib.lua`, not the entire simulation source.

The older `art/PROMPT.md` and `art/briefs/README.md` describe LEGACY buildings. Their fixed96×104/3×3
rules do not override this expansion catalog. `art/reference/` is archival damaged Markdown and must
never be used as executable code.

## 2. Immutable art standard

### Projection and units
- One base tile is **32×16 screen px**. It is **16 world-axis units**, not32.
- World coordinates are `(i,j,z)`:
  `screenX = gx + i - j`, `screenY = gy + (i+j)/2 - z`.
- i goes down-right; j goes down-left; z goes straight up.
- The lot's back corner is `(0,0)`. Main street/front face is the left-facing wall at high-j.
- Ground footprint3×3 tiles is a96×48 diamond; an8×8 footprint is256×128.
- **Do not scale** a cottage up to a tower. Draw every new level at native resolution.
- No blur, smoothing, antialiasing or fractional bitmap resizing. Enlarge previews nearest-neighbour only.

### Geometry and margins
- Planar rectangle i/j/A/B/overhang/u/w values are **even integers**. Height/z may be any integer.
- Use `s.A` and `s.B` (world-axis footprint dimensions) from the build runner; do not redefine tile scale.
- Every primitive must stay within the logical footprint and inside its bitmap.
- Keep at least2 px side/top clearance. `build.lua` rejects top/side edge contact and attempted clipping.
- Land buildings may use the bottom pivot at y=height (one coordinate past the last raster row).
- Transparent water/overlay sprites have4 px bitmap margins; keep those margins transparent.
- Bridge crossing modules must use one consistent style/height: timber `deckZ=6`, stone `deckZ=10`.
  Span endpoints share deck height. Bank landings are z0, their crossing endpoints are deck height.
  Piers have no walkable access points; `supportTopZ` meets the deck soffit. Never mix stone and timber
  modules in one crossing. Footprint/canvas/pivot are unchanged by the taller stone contract.

### Palette and lighting
Only use `theme` or `L.C` ramps and library constants. Never type new hex colours in a recipe.
Ramp indices:1 deepest,2 shaded/right,3 base/left,4 lit/top,5 highlight.
Light comes from upper-left consistently for every heading and every object.
No unexplained colour changes between separately drawn bridge caps and spans.

Theme ramps: `ground,wall,roof,leaf,trunk,water,sand`; `theme.biome` is a string.
Available shared materials: `WOOD,BRICK,WHITE,CONCRETE,STEEL,RUST,THATCH,ADOBE,WHEAT,GLASS,GLASS_TEAL,
ROOF_RED,ROOF_GREEN,ROOF_SLATE,IND_YELLOW,DIRT,BARN` in `L.C`.
Glass is for small windows, NOT a modern mirrored curtain wall.

### Visual era
This is a **timeless island town growing vertically**, not a modern city.
Use stone plinths, masonry, timber galleries, tiled roofs, arcades, buttresses, terraces, courtyards,
bells, banners, gardens, sails, oars, ropes and hand cranes.
No diesel trawlers, motor vehicles, neon, skyscraper glass skins, satellite dishes, airports or helicopters.
No copied Miniville or commercial game sprites. No image-generation service/dependency installation.

## 3. Exact production inventory

Read the catalog as source of truth; these counts are acceptance targets, not suggestions.

| Family | Exact combinatorics per biome | Per biome | Four biomes |
|---|---|---:|---:|
| bridges |4 types ×2 axes ×4 parts ×4 states |128|512|
| boats |4 types ×4 headings ×3 states |48|192|
| fishing |3 types ×4 headings ×3 states |36|144|
| water |4 types ×3 stable variants |12|48|
| towers |5 functions ×5 new tiers |25|100|
| damage |6 effects ×5 footprint/height targets ×3 severities |90|360|
| **Total** ||**339**|**1,356**|

Biomes: tropical,temperate,arid,northern. Expansion builds choose explicit biome; the real game still
forces Eden tropical. A family may share geometry across biome palettes unless its brief below requires
shape variation. Never deliver a single recoloured bitmap resized for every type.

Legacy small/medium/large assets remain untouched:164 original PNGs in the existing catalog.

## 4. File ownership (one task at a time)

| Task | The ONLY recipe file you may edit |
|---|---|
| Bridges | `art/expansion/families/bridges.lua` |
| Boats | `art/expansion/families/boats.lua` |
| Fishing | `art/expansion/families/fishing.lua` |
| Water details | `art/expansion/families/water.lua` |
| Vertical buildings | `art/expansion/families/towers.lua` |
| Damage overlays | `art/expansion/families/damage.lua` |

Do not edit shared library, legacy family files, builder, catalog dimensions/IDs, scripts, atlas, client,
`src/`, `scenarios/`, data, `.env`, or Git settings. If a genuine missing helper/invalid contract blocks you,
report it; don't bypass validation. Add family-local helper functions in your owned file.
No Git commit/push. No save or live-server writes. No permission to run a paid model/provider.

The only additional allowed writes are outputs under `art/generated/` (ignored).
Each family may be subdivided into sequential tasks for each kind. They still own the same file;
**do not run multiple artists against it concurrently**.

## 5. Recipe interface and layers

```lua
local F = {}
function F.draw(L, B, c, theme, s)
  -- s.key         exact catalog identity (no biome suffix)
  -- s.kind        semantic kind (home, rowboat, stone_arch, etc.)
  -- s.tier        numeric tier (tower4..8; some detail markers1..3)
  -- s.family      bridges / boats / fishing / water / towers / damage
  -- s.orientation i/j for bridges; ne/se/sw/nw for boats
  -- s.part        near_bank/span/far_bank/pier for bridges
  -- s.visualState intact/construction/damaged/rebuilding or empty/loaded/damaged or severity
  -- s.variant    1..3 for water markers
  -- s.A,s.B       footprint world units (tiles*16), set by the runner
  -- s.width,height,pivot,footprint  catalog geometry; never overwrite
  -- s.seed        deterministic integer
end
return F
```

Layer order:
1. `c.lot`: land ground only. For water/bridge/overlay assets this stays transparent.
2. `c.shadow`: optional shadow; never bake a square sea background into a transparent prop.
3. `c.props_back`: objects hidden behind the main structure.
4. `c.building`: main object, roofs, facades, hull.
5. `c.details`: foreground furniture, rigging, rails and gear.

The runner commits layers, outlines object layers (except overlays/water markers), sets slice pivot,
validates and exports. **Do not** call `L.new`, `L.commit`, `L.outline`, `L.save`, `L.png`, `L.pivot` or
`app.command` inside a recipe. Do not perform external I/O.

## 6. Helper API (real signatures)

```lua
L.flat(c,i,j,A,B,col,z) -- flat rectangle -> pixel mask
L.box(c,i,j,z,A,B,H,ramp,opt) -- -> masks left/right/top/roof and i0,j0,z0,A,B,H
-- opt: notop=true, base=true, corner=false, parapet={p=2,d=2,floor=RAMP}
L.gable(c,i,j,z,A,B,R,axis,roof,wall,{o=2,rows=3})
-- axis i requires B divisible4; axis j requires A divisible4
L.hip(c,i,j,z,A,B,R,roof,{o=2,rows=3}) -- short span divisible4
L.shed(c,i,j,z,A,B,R,roof,wall,{o=2,rows=3})
L.cyl(c,ic,jc,z,r,H,ramp,{dome=true,matte=true,hole=col,cap=col}) -- radius in SCREEN px
L.wallRect(c,box,'L' or 'R',u,v,w,h,col)
L.windows(c,box,side,{cols,rows=1,w,h,gap=2,v0,dv=0,u0,sill=col,glass=RAMP})
L.awning(c,box,side,u,v,w,depth,drop,ramp,stripeCol)
L.quad(c,{{i,j,z},...},col) -- triangle or polygon, world coordinates
L.P(c,i,j,z) -- -> {screenX,screenY}
L.poly(c,{{x,y},...},col) -- screen polygon anchored with L.P
L.ellipse(c,cx,cy,rx,ry,col) -- screen ellipse
L.dot(c,i,j,z,col)
L.edge(c,mask,'bottom'/'top'/'left'/'right'/'all',col)
L.fill(c,mask,col); L.union(mask1,mask2,...)
L.stripe(c,mask,'dr'/'ur'/'h'/'v',period,col,phase)
L.speckle(c,mask,density,col,seed)
B.plant(L,c,i,j,z,size,theme,seed) -- biome palm/oak/cactus/pine; size3..5
```

Wall detail should read as joints, shutters, sills and trim. Use texture density below0.03 on facades.
Roofs have ridge caps and coherent seams. Do not add a rectangular lattice of black lines over every surface.

Coordinate formula for debugging only (runner already sets it):
`A=16*footprint.i; D=16*footprint.j; gx=pivot.x-A+D; gy=pivot.y-(A+D)/2`.
Rectangular footprints must use BOTH axes. Setting gx=pivot.x without the A/D correction shifts bridges.

## 7. Commands and exact workflow

Everything below runs from the project root. No GUI needs to be open.

### Baseline (once before editing)
```bash
# Rebuild all expansion DRAFTS using Aseprite; all families,4biomes in four batched calls internally.
node scripts/art-expansion.mjs --biome all
python scripts/art-expansion-review.py snapshot before-bridges

# List the exact identities for your assignment.
node scripts/art-expansion.mjs --list --family bridges
```
Replace `before-bridges` and `bridges` with your family name.
A full build currently writes339 entries/biome. Do not use legacy `npm run art:build` for new assets.

### Iterate one identity before batching
```bash
node scripts/art-expansion.mjs --key bridge_timber_footbridge_span_i_intact --biome tropical --out art/generated/expansion-scratch
```
Output is `<out>/tropical/<key>_tropical.aseprite` and PNG plus a manifest for ONLY that selected subset.
Use MCP `view_sprite` with the exact source path, first native scale, then4×. Or open PNG with a fresh
preview filename. Do not re-run an unchanged recipe hoping a random render looks better.

### Family completion
```bash
# Batch your family; after a subset build the manifest contains only that family.
node scripts/art-expansion.mjs --family bridges --biome all

# Restore COMPLETE manifests and rebuild ALL entries before review or snapshot checks.
node scripts/art-expansion.mjs --biome all
python scripts/art-expansion-review.py diff before-bridges --family bridges
python scripts/art-expansion-review.py sheets --family bridges
```

The diff must report no changed pixels outside your family. Unchanged family sprites must be explained
(shared geometry with a palette change is okay; a damaged state identical to intact is NOT).
Contact sheets are one identity across four biomes at true1×, saved under `art/generated/expansion-review/`.
Open sheets in batches, but **inspect every delivered identity** and representative enlarged details.
Do not crop a megatall top or shrink it to fit a tiny sheet.

### Automated validation
```bash
python scripts/art-checks/bridge-seams.py --biome tropical
python scripts/art-checks/bridge-seams.py --biome temperate
python scripts/art-checks/bridge-seams.py --biome arid
python scripts/art-checks/bridge-seams.py --biome northern
```
These are tolerant per-piece endpoint/support checks, not full cross-section or aesthetic proof.
The command exits nonzero on failure.

A successful asset prints `ASSET_OK <key>_<biome>` inside Aseprite and the wrapper prints `OK ...`.
Aseprite exit0 alone is NOT success. Runner checks: layer source palette, positive opaque content,
no clipping attempts, no top/side edge contact, known footprint bounds on rectangle primitives.
Additional artist checks remain mandatory: correct geometry/occlusion, unique headings/states, seam fit.
The runner cannot prove these by reading metadata.

Run regression gates after your final family change:
```bash
npm run art:test
npm run verify
```
`art:test` checks the LEGACY164 recipes; it proves you didn't break the shared kit, not that your new
art is pretty. `verify` includes atlas/geometry tests but does not require Aseprite.

### Integration boundary: don't repack live atlas yourself
The integrator runs:
```bash
python scripts/art-atlas.py
# After HUMAN approval + status approval, OPTIONAL production extras:
python scripts/art-atlas.py --extras art/generated/expansion --out art/generated/release-atlas
```
The extras path must contain complete biome manifests and all included entries must have approved status.
The current single-page cap is1024×4096. The full expansion may exceed it. Stop if it does: a multi-page
release pack is an integration task, not permission to downscale or silently drop sprites.
Transparent2px gutters preserve original RGBA pixels. PNG crop identity is tested.

### Budget and failure policy
- Maximum5 edit/build/view cycles per identity; maximum3 attempts at the same execution error.
- Work in small semantic batches (one bridge type, one boat type, one tower function).
- If a batch is too large for one context, leave a precise Markdown report in `art/generated/` and stop.
- Never weaken validations, alter footprint to hide clipping, or mark unviewed art approved.

## 8. Bridge production brief (128 identities per biome)

IDs follow `bridge_<type>_<part>_<axis>_<state>`.
Types: timber_footbridge,timber_wagon,stone_arch,stone_viaduct.
Axes i/j; parts near_bank,span,far_bank,pier; states intact,construction,damaged,rebuilding.
Dimensions/pivots/access points are already catalogued.

### Geometry and style
- The two axes are separately lit views. Do not rotate a finished pixel bitmap45°.
- **near_bank:** stair/ramp transition from landz0 to deckz6, handrail termination and anchor.
- **span:** continuous deckz6 across its logical endpoints, rails matching both caps. Leave water below
  and around supports transparent.
- **far_bank:** opposite transition; cap's outward rail faces the correct bank.
- **pier:** load-bearing support rising from waterline to the deck underside. Timber bents for wood,
  masonry pier/arch base for stone. Avoid a floating deck.
- Footbridge is narrow with rope/wood rail details. Wagon bridge has heavier beams and a stout deck.
- Stone arch bridge has a real transparent arch opening, voussoir rhythm and parapets.
- Viaduct has slender repeated arches and a distinctive parapet rhythm, not a recoloured timber bridge.
- Side/end cap pixels at access points must meet when pieces are stamped consecutively.
- Avoid double-thick rails where two pieces join. Make seam comparison previews: cap+2spans+cap,
  each axis, at least two styles, over contrasting test water (water is NOT baked into exports).

### States
- Stone arches have a9px soffit and deckz10; five2px stair drops reach land. Timber decks remainz6.
- Construction: partial platform, temporary posts and stored planks/stone; no finished usable deck illusion.
- Damaged: obvious missing/broken rail/deck pieces, not a darker tint of intact.
- Rebuilding: local scaffold/tarp/temporary support, different from first-time construction.
- Keep access metadata fixed through states; a drawing cannot reopen a mechanically closed crossing.

Acceptance: all128 identities, no opaque ground/water backdrop, both axes correct, modular seam proof,
wood/stone identities visible at1×, each state genuinely distinguishable.

## 9. General boat production brief (48 identities per biome)

Types rowboat,work_skiff,cargo_barge,coastal_sailboat; headings ne,se,sw,nw; states empty,loaded,damaged.
Headings mean bow points to screen NE/SE/SW/NW. Stern, rudder, oar mounts, cargo and sail reveal heading.
Do not deliver the same symmetric hull under four names. Mirroring a source sprite is insufficient if
it reverses lighting. Paint the shaded and lit sides correctly in each heading.

- **Rowboat:**2thwarts, oars/oarlocks, narrow pointed bow, no cabin or mast.
- **Work skiff:** flatter bottom, stout gunwale, ropes and tools; broader than rowboat.
- **Cargo barge:** wide low flat hull, tied cargo area, blunt stern, rudder/sweep, optionally a small cover.
- **Coastal sailboat:** clear mast connection, small deck/cabin, triangle/lateen sail, rigging and rudder.
- Empty: visible interior/thwarts or clean cargo deck.
- Loaded: real-looking sacks/crates/rolled cloth within safe deck bounds, no implied new game inventory.
- Damaged: split plank/patch canvas/torn sail or broken oar, still recognizable type/heading.
- Waterline pivot is the footprint's continuous front-bottom anchor. No baked grass, beach or large water square.
- Keep rigging opaque palette pixels, not antialiased grey dust.

Acceptance: all48 identities, four unmistakable bow directions, empty/loaded/damaged visible at1×,
no modern engines or smoke stacks, source/editable layers retained.

## 10. Fishing boat production brief (36 identities per biome)

Types fishing_canoe,net_boat,fishing_sailboat; headings/states as general boats.
- **Canoe:** small narrow hull, single gear basket, paddle, simple line/pot gear.
- **Net boat:** broader work hull, hanging/net-drying supports, baskets and marked working area.
- **Fishing sailboat:** sail/mast/rigging, net/float storage, a small covered gear area.
- Loaded uses fish crates with a few silver/teal fish forms; not a huge loose fish heap.
- Damaged gear differs from empty gear. Torn nets and sail patches remain coherent and attached.
- Do not paint fish schools as part of the hull asset. Water markers are independently placed.
- Each fishery already has boats baked into legacy art: do NOT remove those in this task. The integrator
  must later replace baked-boat scenes to avoid double boats when real owned boat entities ship.

Acceptance: all36 identities, fishing vs cargo visually clear, headings lit consistently, no free-standing
mast or floating net rack. Gear does not exceed the logical water footprint.

## 11. Water-detail production brief (12 identities per biome)

Types fish_school,fish_shadow,ripples,net_floats; variants1..3.
- Fish schools:3–7tiny readable fish silhouettes, not stars or diamonds; vary direction/cluster shape.
- Fish shadows: darker underwater silhouettes, no strong black outline suggesting an object above water.
- Ripples: broken ellipse arcs at2:1 surface perspective; not a full opaque blue tile.
- Net floats: small connected float/rope clusters; restrained highlights, visible at1×.
- Separate markers keep ocean visible. Unpainted pixels stay fully transparent.
- Palette by water biome; subtle but visible over a sample swatch of `theme.water[3]`.
- Variants must differ in arrangement, not just change a random speckle seed.

Acceptance:12 distinct layouts, no cargo/inventory implication, correctly submerged look for shadows,
readable at1× without shouting over boats.

## 12. Tower production brief (25 identities per biome)

Functions home,shop,clinic,court,council. Tiers4..8. Current1..3remain exactly unchanged.

| Tier | Name | Footprint | Canvas |
|---|---|---|---|
|4|Mid-rise|3×3|96×160|
|5|High-rise|3×3|96×224|
|6|Skyscraper|4×4|128×352|
|7|Supertall|6×6|192×528|
|8|Megatall|8×8|256×768|

The canvas is an envelope, not a demand to fill every pixel. Leave top headroom. A tall solid slab is
not final art. Break large masses with coherent setbacks, multiple wings, galleries, green terraces,
arcades and small rooflets. No uniform blue-grid window wallpaper over a huge rectangle.

### Tier progression
- T4: compact courtyard block,4–6implied storeys, street entrance and rooftop garden.
- T5: stepped7–12storey complex with taller central block, terraces and side galleries.
- T6:13–24storey clustered tower with strong base/podium and recognisable crown.
- T7:25–40storey vertical citadel: paired wings, buttresses, sky galleries inside the reservation,
  several garden setbacks. Strong silhouette distinct from simply tallerT6.
- T8:40+implied floors, monumental vertical district: broad8×8base, several structural tiers, gardens,
  restrained connecting galleries and family-specific crown. Retain a human-scale entrance/plaza.
Floor counts guide proportions; they are not metre measurements or runtime capacity values.

### Function identity (mandatory even when the image is greyscaled)
- **home:** balconies, laundry, stacked domestic windows, shared gardens and small roofs. No justice
  columns or retail awning as its primary identity.
- **shop:** ground arcades/covered market, loading/service yard and goods display, galleries stepping
  up the mass. Distinct broad market podium; no free cargo inventories.
- **clinic:** pale walls, health emblem, orderly ward wings, covered walks, garden terraces. Emblem
  remains readable at1×. Do not put a floating tank or hide the emblem under an eave.
- **court:** imposing stone steps, columns/pediment, justice icon, formal courtyards. Distinguish from
  council by classical/heavy judicial massing, not a shared cupola.
- **council:** warm assembly halls, bells/clock/banner, layered meeting terraces, a ceremonial entrance
  and public courtyard. No court copy with a colour swap.

### Biomes (shape changes, not just palette)
- Tropical: ventilated galleries, wide verandas, shade roofs and planted palm terraces.
- Temperate: masonry/timber framing, tiled crowns, broadleaf roof gardens.
- Arid: adobe/stone terraced mass, deep recesses, shaded inner courts, flat/parapet gardens and cactus.
- Northern: steeper roof caps, protected walkways, smaller windows and pine-planted terraces.
Do not try to make terrain-scale trees enormous; use compact palette-appropriate planted clusters.

### Metadata attachment targets
The catalog offers front/roof attachment anchors in world coordinates. These are provisional markers,
not permission to change the metadata. Final damage integration uses per-building material masks.
If a mark would land inside a different wing, note the needed adjustment for the integrator.

Acceptance:25assets/four biomes, five functions recognizable from base and silhouette, every tier changes
architecture, no canvas clipping, straight opaque pixel edges, coherent supports, galleries anchored,
megatall fits its8×8logical ground and its top remains on-canvas.

## 13. Hazard and repair overlay brief (90 identities per biome)

Effects fire_scorch,storm_debris,flood_stain,drought_ground,outbreak_sign,repair_scaffold.
Sizes:3×3with104px and224px canvas,4×4/352,6×6/528,8×8/768. Three severities light/moderate/severe.
Use existing catalog IDs. All overlays are transparent separate sprites; never redraw the complete building.

### Attachment and masking rule
The build currently produces isolated overlays. They are **NOT safe to paint over any building
unmasked**. Markers need model/family-specific attachment maps; stains/holes must clip to the actual
wall/roof/ground masks. The integrator handles that composition. Your art must provide coherent
pieces and no opaque rectangle, not a screenshot that happens to hide a bad rectangle.

- **Fire scorch:** soot/blackened beams and irregular roof-edge wear. No perpetual flames. Current
  hazard data does not include a live burning state, so draw consequences, not invented ongoing fire.
- **Storm debris:** snapped timber, torn awning/roof fragments, scattered shingles. No flood pond.
- **Flood stain:** low wall-water marks, mud streaks, a few puddle/debris pieces at ground level. Do not
  cover high tower floors with water merely because the canvas is tall.
- **Drought:** dry garden/ground, wilted foliage, soil cracking. No burned/collapsed walls.
- **Outbreak:** subtle health/quarantine board or treatment marker. Never rubble/charred roofs. More
  severe means additional/distinct marker arrangement, not structural damage to an infected building.
- **Repair scaffold:** posts, tied platforms, tarps, stored material. Light=local repair,moderate=partial
  facade bays,severe=larger reconstruction support. Platforms must have ground/structure supports.

Severity must be visible but leave base identity. Light is restrained; moderate adds larger missing
patches/debris; severe is substantial but is NOT total destruction. Ruined/collapsed building types
remain a separate future rule/art extension.

Acceptance:90identities, all alpha backgrounds, correct ground/height semantics, clearly distinct
severity where semantically appropriate, no invented flames/inundation/destruction, composition proof
on a T1 cottage and a tall tower using explicit material masks in a REVIEW image only.

## 14. Quality gates and required review artifacts

For every family deliver:
1. Same-seed repeat render with identical PNG hashes (not just similar appearance).
2. Complete manifest, editable `.aseprite`, PNG and exact recipe source.
3. 1× comparison sheets across biomes;4×close-ups for hands/rigging/arch seams/roof details.
4. Orientation montage for every boat type; modular seam montage for every bridge style.
5. Tier ladder montage for each tower function, at true native scale and with a common ground line.
6. Transparent/checkerboard preview of overlays and water details, plus real-background composition proof.
7. No clipping attempts, off-palette source pixels, detached structural parts or unexplained floating objects.
8. No changes to the existing164sprites or another artist's family.

Aseprite `lint_sprite` is supporting evidence: eyes, fish glints and rope dots can be intentional,
so do not blindly erase all orphans. A floating mast/tank/roof is a real defect.

## 15. Final report format (copy this)

```text
Family:
Recipe file changed:
IDs completed:
IDs unfinished:
Biomes rendered:
Build command/result:
Inventory count:
Same-seed repeat hash result:
Family isolation diff result:
Contact-sheet and montage paths:
Viewed every delivered identity after final build? yes/no
Legacy art:test result:
Project verify result:
Remaining visual defects:
Any requested metadata/helper change (not made):
```

## 16. Copy/paste task prompts

### Task A — bridges
> Read `art/NEW_SPRITES_HANDOFF.md` completely. Complete the bridges family in
> `art/expansion/families/bridges.lua`, one bridge style at a time. Do not edit another source file.
> Replace starter geometry with final original artwork for all catalogued axes/parts/states/biomes.
> Follow the build/review/snapshot gates, produce modular seam montages and stop with the final report.

### Task B — general boats
> Read the master handoff. Complete `art/expansion/families/boats.lua`, one type at a time. Four real
> headings and empty/loaded/damaged states are mandatory. Do not mistake the starter headings for
> finished art. No simulation/client/catalog changes. Build, inspect and report as specified.

### Task C — fishing boats
> Read the master handoff. Complete only `art/expansion/families/fishing.lua`. Author canoe/net/sailboat
> identities, four headings and three states. Keep fish-water details out of boat sprites. Use the
> same validation/review gates; do not change catches, staffing or legacy fishery artwork.

### Task D — water details
> Read the master handoff. Complete only `art/expansion/families/water.lua`: fish schools, shadows,
> ripples and net floats,3distinct layouts each,4biomes. Transparent native-resolution art, no game goods.
> Prove readability over actual biome water swatches and report the required checks.

### Task E — vertical buildings
> Read the master handoff. Complete only `art/expansion/families/towers.lua`, in this order:
> home4..8,shop4..8,clinic4..8,court4..8,council4..8. Make each function recognizable and each tier
> structurally different in timeless stone/timber/tile style. Obey catalog footprints/canvases; no
> runtime-capacity or save changes. Work sequentially and stop rather than silently omit tiers.

### Task F — damage and repair
> Read the master handoff. Complete only `art/expansion/families/damage.lua` for all90catalog entries
> per biome. Transparent components only; differentiate effect/severity and show composition proofs.
> Do not invent active flames, giant flood planes or destruction rules; do not attach unmasked overlays
> to the live map. Run the gates and deliver the prescribed report.

## 17. What the integrator does AFTER your art is reviewed

- Approves art status, reconciles attachment metadata and splits atlases into bounded pages as needed.
- Adds bridge/boat/redevelopment mechanics in separate domain-tested stages.
- Verifies funded placement before assigning larger frames/footprints to live buildings.
- Tests map+Overview, occlusion and tall-frame fitting with real variable-footprint reservations.
- Backs up and rehearses any spatial/save upgrade on a copy; no artist may run it on Eden.

The cheaper artist should never have to guess whether a boat makes fish or a megatall holds1000people.
Those are authoritative rule tables handled by the integrator, not pixel-art design choices.
