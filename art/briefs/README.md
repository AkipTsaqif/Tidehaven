# Sprite redesign briefs — shared rules

Every brief in this folder redesigns ONE sprite family. Read this file completely, then your brief.
These rules override anything in a brief that seems to conflict with them.

| Brief | Family file you edit | Kinds |
|---|---|---|
| `01-production.md` | `art/families/production.lua` | farm, fishery, bakery, timber_camp |
| `02-civic.md` | `art/families/civic.lua` | guard_house, court, council |
| `03-services.md` | `art/families/services.lua` | workshop, shop, clinic, public_works |
| `04-homes.md` | `art/families/homes.lua` | home |
| `05-specials.md` | `art/families/specials.lua` | camp, home_site, development_site, development_abandoned, destroyed |

Run briefs **one at a time**. They share `art/generated/` and the review snapshots.

## 1. What you may change

- You may edit **only your family file**. Put any new helper functions inside that file as `local function`.
- Do **not** edit `art/iso_lib.lua`, `art/biomes.lua`, `art/catalog.lua`, `art/build.lua`, `art/families/common.lua`,
  other family files, `scripts/`, `art/reference/`, `scenarios/`, `src/`, `data/`, `.env`, or `package.json`.
- If you think the shared library is missing something essential, stop and report it. Do not work around it
  by editing shared files. Hand-rasterising with `L.poly`/`L.quad` inside your file is allowed.
- No commits, no pushes, no dependency installs, no paid image services, no copied third-party art.

## 2. Fixed contract (validated; the build fails if you break it)

- Base map tile **32×16 px** = 16 world units per axis. Projection: `x = gx + i - j`, `y = gy + (i+j)/2 - z`.
- Every sprite: canvas **96×104**, lot **48×48 world units** (3×3 tiles), pivot `(48,104)`.
  Every tier of a kind uses the same lot. Bigger tiers grow *inside* the lot.
- All planar values (i, j, widths A/B, overhang `o`, wall offsets `u`, widths `w`) must be **even**.
  Heights (`z`, `H`, `v`, `h`) may be any whole number.
- Geometry including roof overhang must stay inside `0..48` on both axes. Leave ≥2 units margin for props
  and ≥4 for main masses so outlines are not cut.
- Nothing may touch the top pixel row. Ground under point (i,j) is at screen y = `56 + (i+j)/2`.
  So the tallest point allowed above it is about `z = 54 + (i+j)/2`. That is 54 at the back corner (0,0)
  and 78 at the lot centre (24,24).
- Pixels outside the canvas count as clipping and fail the build.
- **Colours: ramps only.** Use `L.C.<RAMP>[1..5]`, theme ramps, `L.OUTLINE`, `L.SHADOW`, `L.LIT`, `L.BEACON`, or
  `L.FLOWERS[n]`. **Never** write hex colours or call `L.hex` in a family file. Off-palette pixels fail the build.
- Ramp index meaning: `[1]` deep/outline · `[2]` right-face shade · `[3]` left-face base · `[4]` top/lit · `[5]` highlight.

## 3. The function you write

```lua
function F.draw(L, B, c, theme, spec, U)
-- L      iso_lib (geometry/raster helpers)    B     biomes (B.plant)
-- c      layer contexts: c.lot, c.shadow, c.props_back, c.building, c.details
-- theme  ramps for this biome: ground, wall, roof, leaf, trunk, water, sand; plus theme.biome (string)
-- spec   {kind, tier (1..3), seed (number), A=48, B=48, Hc=104}
-- U      starter helpers in common.lua (texture, house, flatHall, crates, greenery). Optional. Do not edit them.
```

Specials have `spec.tier == 1`.

**Layers (bottom → top), and what goes on each:**

| Layer | Use for | Outlined automatically |
|---|---|---|
| `c.lot` | ground: `L.lot(...)` first, then paths, fields, water, paving | no |
| `c.shadow` | `L.shadow` / `L.treeShadow` only (`L.SHADOW` colour) | no |
| `c.props_back` | things behind the main building: back trees, rear sheds | yes |
| `c.building` | main masses, roofs, facades | yes |
| `c.details` | foreground props: carts, crates, fences, front plants | yes |

`build.lua` applies the 1 px outline to the last three layers. **Do not call `L.outline` yourself.**
The outline only surrounds a layer's opaque region. Two masses on the same layer that touch get no
dividing line, so separate them with face shading or an `L.edge` line in a darker ramp step.

**Orientation.** The lot's back corner (0,0) is the top of the diamond. Increasing i runs down-right;
increasing j runs down-left. A box's **left face** (`side "L"`, at j = j0+B) faces the viewer's lower-left.
Treat it as the street front: doors, signs and shopfronts go there. The **right face** (`side "R"`,
at i = i0+A) is the shaded side. The front of the lot is high i + high j (bottom of the diamond).
Keep a path from the main door to the lot's front edge.

**Draw order.** Within one layer, later drawing covers earlier. Draw back to front (lower i+j first) and
bottom to top. For a building: walls → wall texture → doors/windows → back half of a chimney → roof → ridge
and gable trim → anything in front.

## 4. Library cheat sheet (real signatures; do not invent others)

```lua
L.lot(c, A, B, ramp, seed, density)          -- whole-lot ground; call first on c.lot
L.flat(c, i0, j0, A, B, col, z)              -- flat ground/roof rectangle -> mask
L.box(c, i0, j0, z0, A, B, H, wallRamp, opt) -- solid box -> {left,right,top,roof,i0,j0,z0,A,B,H}
   -- opt: notop=true (roof goes on top), base=true (dark foot line), corner=false,
   --      parapet={p=2,d=2,floor=RAMP} (flat roof with rim)
L.gable(c, i0, j0, z0, A, B, R, axis, roofRamp, wallRamp, {o=2, rows=3})
   -- axis "i": ridge along i, needs B % 4 == 0, gable triangle on the RIGHT face
   -- axis "j": ridge along j, needs A % 4 == 0, gable triangle on the LEFT (street) face
L.hip(c, i0, j0, z0, A, B, R, roofRamp, {o=2, rows=3})  -- min(A,B) % 4 == 0; pyramid when A == B
L.shed(c, i0, j0, z0, A, B, R, roofRamp, wallRamp, {o=2, rows=3}) -- mono-pitch, high at the back
L.cyl(c, ic, jc, z0, r, H, ramp, {dome=true, matte=true, cap=col, hole=col}) -- r is SCREEN px
L.wallRect(c, box, side, u, v, w, h, col)    -- rectangle on a wall face; u+w <= wall length
L.windows(c, box, side, {cols, rows=1, w, h, gap=2, v0, dv=0, u0=nil, sill=col, glass=RAMP})
L.awning(c, box, side, u, v, w, depth, drop, ramp, stripeCol)
L.stripe(c, mask, dir, period, col, phase)   -- dir "dr" (left-wall courses), "ur" (right-wall), "h", "v"
L.speckle(c, mask, density, col, seed)       -- keep density <= 0.03 on walls, or it reads as noise
L.edge(c, mask, side, col)                   -- side "bottom","top","left","right","all"
L.fill(c, mask, col)   L.union(m1, m2, ...)   L.dot(c, i, j, z, col)
L.quad(c, {{i,j,z}, ...}, col)               -- world polygon -> mask
L.poly(c, {{x,y}, ...}, col)                 -- SCREEN polygon; use L.P(c,i,j,z) -> {x,y} to anchor
L.P(c, i, j, z)                              -- world -> screen {x, y}
L.ellipse(c, cx, cy, rx, ry, col)            -- SCREEN ellipse (clock faces, round signs)
L.shadow(c, i0, j0, A, B, s)   L.treeShadow(c, i, j, size)
L.tree(c, i, j, z, size, leafRamp, trunkRamp, seed)   L.bush(c, i, j, size, leafRamp, seed)
B.plant(L, c, i, j, z, size(3..5), theme, seed)       -- palm / oak / cactus / pine by biome
```

**Ramps:** GRASS, FOLIAGE, DIRT, WHEAT, WATER, CONCRETE, ASPHALT, BRICK, PLASTER, WHITE, WOOD, BARN, ROOF_RED,
ROOF_SLATE, ROOF_GREEN, GLASS, GLASS_TEAL, STEEL, RUST, IND_YELLOW, plus SAND, THATCH, ADOBE, PALM_TRUNK,
CACTUS_TRUNK, PINE_TRUNK. Note: GRASS, FOLIAGE, WATER, PLASTER and ROOF_RED are **re-tinted per biome**.
Prefer `theme.wall`, `theme.roof`, `theme.ground`, `theme.leaf` and `theme.water` for anything that should
change with the biome.

**Determinism.** Same inputs must give byte-identical PNGs. Never call `math.random`/`math.randomseed`
directly, and never use `os.time` or `os.clock`. Get variation only from seeded helpers such as
`L.speckle(..., spec.seed + n)`, `B.plant(..., spec.seed + n)` and `L.windows{seed = ...}`, or from tier and
biome branches.

**Common build errors:**
- `planar coordinates and widths must be even` → an odd i/j/A/B/u/w/o.
- `geometry crosses its lot footprint` → a box or roof (including its overhang) leaves 0..48.
- `gable span must divide by four` → fix B (axis i) or A (axis j).
- `facade detail crosses wall edge` → `u + w` is longer than the wall.
- `pixels clipped` / `touches top row` → too tall or too close to an edge.
- `colour outside approved source palette` → you used a non-ramp colour.

## 5. Art direction (applies to every family)

1. **Silhouette first.** Each kind must be recognisable at **1× (96×104)** from its shape alone, and must not
   be confusable with any kind in another family. Props alone are not identity: if you cover the props and
   two kinds look the same, redesign the masses.
2. **Tiers are structural, not scaled.** T1 → T2 → T3 must add buildings, wings, yards, towers or annexes, or
   change the building type. Simply making the same box taller or wider is a failure. A rough guide:
   T1 uses about a third of the lot, T2 about half, and T3 most of it, with clear open ground still visible.
3. **Tier 1 matters most right now.** The saved Eden town has only tier-1 sizes today (homes 6 beds,
   workplaces 3–6 workers). Spend extra care on T1.
4. **Facade detail without noise.** Use wall courses, corner trim (`L.edge` with `[4]`/`[5]`), door frames,
   sills, shutters, eave shadow lines, ridge caps and foot lines. Windows are 2×3 or 2×4 px; doors are 4×7.
   One storey is 10–12 px. Avoid full-wall high-contrast stripes and speckle above about 0.03.
5. **Light comes from the upper left.** Left faces use `[3]`, right faces `[2]`, tops `[4]`, highlights `[5]`.
   Do not flip shading on individual objects.
6. **Setting.** A timeless small-island town: timber, stone, plaster, brick, thatch and tile; hand carts,
   rowing and sailing boats, barrels and crates. **No** motor vehicles, neon, satellite dishes, helipads or
   modern glass towers. **No text or letters.** Use icons of at least 3 px instead (cross, loaf, fish,
   anvil, scales).
7. **Biomes.** Shapes may stay the same across biomes, but materials must come from `theme`, so all four
   biome sets look native. Brief-specific biome rules come first.
8. **Keep the lot readable.** Use ground (`c.lot`) to explain the function: fields, paving, docks, yards,
   gravel. Do not cover the whole lot with props.

## 6. Workflow (use exactly this; it keeps cost low)

```bash
# 0. Baseline: full build + snapshot (once, before editing). FAMILY/KINDS are in your brief.
python scripts/art-review.py build
python scripts/art-review.py snapshot before-FAMILY

# 1. Iterate one sprite at a time into a SCRATCH directory (never the main set directories):
npm run art:build -- --scenario eden --seed tidehaven-founding-39146379 --kind farm --tier 1 --out art/generated/scratch
#    then look: aseprite MCP view_sprite on art/generated/scratch/farm_1_tropical.aseprite (scale 4),
#    or read the PNG. Check other biomes the same way with:
npm run art:build -- --scenario tidehaven --biome northern --seed tidehaven-founding-39146379 --kind farm --tier 1 --out art/generated/scratch

# 2. When every kind/tier in the family looks right, rebuild everything and review:
python scripts/art-review.py build
python scripts/art-review.py diff before-FAMILY --kinds KINDS      # must print OK
python scripts/art-review.py sheet FAMILY --kinds KINDS            # writes art/generated/review/FAMILY-*.png
npm run art:test                                                   # must pass
```

- **Open and look at every sheet** that `sheet` writes: one per kind (biome rows × tier columns at 2×), plus
  `FAMILY-all-tropical-1x.png` with every sprite at real size, your family boxed in yellow. Use the 1× sheet
  to check your kinds are distinct from each other **and** from the other families.
- `diff` fails if any sprite outside your family changed. It warns if one of your sprites did not change.
  Every sprite in your family must be redesigned.
- **Budget:** at most 5 build-and-look cycles per sprite, at most 3 fix attempts for any one build error,
  and about 80 tool calls in total. If you hit a limit, stop and report what is unfinished. Do not loop.
- Never claim a sprite looks good unless you viewed it after the last change.

## 7. Final report (keep it short)

1. Files changed (should be only your family file).
2. For each kind: one line per tier describing the design.
3. Command results: `diff` OK line, `art:test` PASS lines.
4. Sheet paths, and confirmation that you viewed each one after the final build.
5. Honest list of remaining weaknesses or anything you could not finish.
