# Brief 1 — Production family: farm, fishery, bakery, timber_camp

- **Edit only:** `art/families/production.lua`
- **FAMILY:** `production`
- **KINDS:** `farm,fishery,bakery,timber_camp`
- Read `art/briefs/README.md` first. Its rules, workflow, budget and report format apply.

## The problem you are fixing

All four kinds currently draw the **same red-roofed house** (`U.house`), told apart only by a small prop
(a field strip, a pier, an awning, logs). At 1× they are almost interchangeable. Tiers only make that
house taller. **Stop using `U.house` as the main building.** Each kind needs its own working building
type, and the work area must dominate the lot.

## What these places are in the game

Workers produce goods: farms grow food, fisheries catch fish, bakeries turn grain into bread, and
timber camps cut wood used for construction. Workplaces expand with capacity: tier 1 is ≤6 workers,
tier 2 is 7–20, tier 3 is 21+. Saved Eden currently has a 6-worker farm and 4-worker fishery, bakery
and timber camp, so **all four are tier 1 in Eden today**.

## Designs

The masses, positions and sizes below are guidance. You can adjust them, but keep the listed identity
elements. Use even values.

### farm — "the field is the building"
- **Identity:** crop rows on `c.lot` cover a large part of the lot and are always visible. They grow
  each tier and must stay inside the lot.
  Use `L.flat` + `L.stripe` with `WHEAT` and `DIRT`. A second crop colour (`theme.leaf` rows) is welcome.
- **T1 garden farm:** a small timber shed (e.g. 12×10, low `L.shed` roof) at the back, crop rows over the
  front half, a short fence along one edge, and a hand cart or basket.
- **T2 farmstead:** a proper **barn**: `L.C.BARN` walls, ridge along j (`axis "j"`) so the big gable faces
  the street. Draw the barn door on the gable face, with an X brace using `L.quad` lines in `WOOD`. Add one
  silo (`L.cyl`, `STEEL` or `WHITE`, `dome=true`), bigger fields and a fence line.
- **T3 large farm:** the barn plus a second building (shed or granary), two silos of different heights,
  hay bales (small `L.cyl` or boxes in `WHEAT`), fields on two sides, and a dirt track from barn to lot edge.
- **Biomes:** crops keep `WHEAT`, but fence and shed wood stay `WOOD`. Barn walls stay `BARN` everywhere.
  Use `theme.roof` on the shed/house roofs. In arid, show fewer, sparser rows.

### fishery — "boats and a dock on the water"
- **Identity:** water on the lot's **right edge** (high i, screen lower-right), a wooden pier going into
  it, and at least one boat. Keep the water on the same edge for all three tiers. The future map placer
  will use that edge as the shoreline, so don't move it.
- Water: `theme.water` ramp, with small `L.stripe` highlights; `theme.sand` beach strip between land and water.
- **Boats:** draw with `L.quad` in world space: a hull of 2–3 quads in `WOOD`, sitting at z=0 on the water,
  with a mast (`L.box` 2×2) and optionally a small sail triangle in `WHITE`.
- **T1 fishing hut:** a small hut on short stilts at the water's edge (e.g. a box raised on 4 posts at
  z=3), a net-drying rack (two posts + a crossbar + a `L.stripe` net in `WHITE[2]`), a short pier and one
  rowing boat.
- **T2 fishing station:** a boat shed with a wide open water-facing front, made from `L.shed` or a box with
  a dark doorway. Add a longer pier, two boats (one with a mast), barrels or fish crates, and the net rack.
- **T3 fishing harbour:** a long L-shaped pier, a warehouse (gable roof using `theme.roof`), a small
  hand crane (posts + beam + hanging rope dot line), three boats including one sailing boat, and stacked
  crates.

### bakery — "oven and chimney"
- **Identity:** a domed brick bread oven and/or a tall smoking chimney, plus a shopfront with a loaf sign.
  Draw the loaf icon as a ≥3 px rounded shape in `WHEAT[4]`/`WHEAT[2]` on a small board with a `WOOD` frame.
- **T1 bread oven:** a free-standing **dome oven**: `L.cyl` in `BRICK` with `dome=true`, a dark mouth made
  with `L.wallRect`-style quad in `L.OUTLINE`, beside a tiny lean-to hut (`L.shed`) with a counter. Add a
  woodpile for the fire and a table of loaves (speckle `WHEAT`).
- **T2 bakery:** a narrow 2-storey shop with the gable on the street face (`axis "j"`), a striped awning
  over a wide shop window, the loaf sign, a tall brick chimney, and the dome oven attached at the back or
  side.
- **T3 large bakery:** the bakery plus a **windmill** for flour. Make a round or octagonal tower (`L.cyl`,
  `theme.wall` or `WHITE`) with a conical/hip cap and four sails drawn in **screen space** with `L.poly`,
  anchored at `L.P(c, i, j, z)`. Sails use thin `WOOD` arms with `WHITE` cloth. Add flour sacks (small boxes
  in `WHITE`).
  Keep the sails inside the canvas and below the top row.

### timber_camp — "logs, saw and forest"
- **Identity:** stacked logs (round ends visible), standing trees behind the site, and stumps.
  Log ends are small `L.cyl` or dots showing rings in `WOOD[4]`/`WOOD[2]` on the visible face of a log stack.
- Back trees: use `B.plant` on `c.props_back` near the back corner. Use 2 trees at T1, 3 at T2 and T3.
  Leave headroom. Stumps are tiny `L.cyl` in `WOOD`.
- **T1 woodcutter hut:** an open lean-to shelter (`L.shed` on 4 posts, open at the front), a chopping block
  with an axe (a 1 px `STEEL` blade and a `WOOD` handle), one log pile and a few stumps.
- **T2 logging yard:** an open-sided **saw shed** (long low roof on posts), a sawhorse with a log on it,
  two log piles, stacked planks (flat boxes in `WOOD[4]`), and a hand cart.
- **T3 large logging yard:** a timber-framed sawmill hall (box + gable, visible `L.stripe "v"` framing on the
  walls), a log stack yard covering a quarter of the lot, a plank stack, a hand crane or log ramp, and more
  stumps where the forest was cut.

## Distinctness requirements

- **No two production kinds may share a main building shape.** Field+shed, water+pier+boat, oven/mill+shop
  and log yard+open sheds should all be identifiable from 1× at a glance.
- None may look like a home: no plain cottage with a chimney as the main mass. The bakery T2 shop is the
  exception, and it must have the awning, loaf sign and oven.
- The timber camp's open sheds must not look like the specials' construction frames. Use solid roofs, and
  logs rather than scaffold beams.

## Acceptance checklist

- [ ] 12 sprites (4 kinds × 3 tiers) redesigned; `diff` shows all 48 family sprites changed and
  nothing outside the family.
- [ ] Each kind identifiable at 1× from shape, in all four biomes.
- [ ] Each tier adds structures/work area; T3 clearly the largest operation.
- [ ] Fishery water stays on the high-i edge in all tiers.
- [ ] Farm fields, water and yards stay inside the lot; nothing clipped.
- [ ] `npm run art:test` passes.
