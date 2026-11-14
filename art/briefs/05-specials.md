# Brief 5 — Special states: camp, home_site, development_site, development_abandoned, destroyed

- **Edit only:** `art/families/specials.lua`
- **FAMILY:** `specials`
- **KINDS:** `camp,home_site,development_site,development_abandoned,destroyed`
- Read `art/briefs/README.md` first. Its rules, workflow, budget and report format apply.
- Specials have **one sprite each** (`spec.tier == 1`). `spec.seed` is provided.

## The problem you are fixing

- `home_site` and `development_site` are **identical**: the same square timber frame and crates.
- `development_abandoned` and `destroyed` are **identical**: the same rubble patch with grey blocks.
- The camp tent is fine as a start but sparse.

Each of the five states means something different in the simulation. A player must be able to tell
them apart at 1× on the map.

## What each state means in the game

| State | Game meaning | Must read as |
|---|---|---|
| `camp` | A household with **no building** (e.g. new arrivals before a home is built). It is not a building row. | people living rough, temporarily |
| `home_site` | A **home under construction** by a household (capacity 0 until finished). Small, domestic scale. | a house being built |
| `development_site` | A **workplace under construction** (resource-funded growth). Bigger, organised, commercial scale. | a construction project |
| `development_abandoned` | A workplace project that was **cancelled** before finishing. Materials were returned and the site was left. | a half-built shell, overgrown |
| `destroyed` | A building that was **destroyed** (a `destroyedDay` is set). Reserved for disasters/drama, which no current rule triggers yet. | a ruin after a fire or collapse |

## Designs

### camp
- A canvas **tent**: a ridge tent from two triangular faces + one sloped side, in `WHITE` or `SAND`, with a
  dark opening. Add a **campfire** (a ring of stone dots in `CONCRETE` with 3–5 flame pixels in
  `IND_YELLOW[4..5]` / `BRICK[4]` and a `L.LIT` core), a bedroll (small `BARN` or `theme.roof` quad), a cooking
  pot on a tripod (3 thin `WOOD` lines + a `STEEL` dot cluster), and a bundle or crate.
- Trampled ground: a `DIRT` patch on `c.lot` under the camp with irregular speckle edges; the rest stays
  `theme.ground`.
- It should look small, temporary and lived-in. **No walls, no roof structure.**

### home_site
- **Domestic scale** (cottage footprint, about 16–20 units square). A low stone or concrete **foundation
  slab** (`L.box` height 2), a **partly raised timber frame**: corner posts, a top plate on two sides
  only, and an **A-frame roof truss outline** at one end showing the future pitched roof. Use thin `WOOD`
  boxes and `L.quad` diagonals.
- Nearby: a neat plank stack, a sawhorse, a ladder against the frame, a few bricks.
- It should look small and hopeful: a family building its house.

### development_site
- **Commercial scale**, using most of the lot. Show **scaffolding**: a grid of thin `STEEL` or `WOOD`
  posts and planks around a rising 2-storey wall shell (`theme.wall` or `BRICK`), with walls at different
  heights so it looks unfinished. Add a **tall hand crane** or treadwheel hoist (mast + jib beam + rope
  line + hanging load), material pallets (bricks, planks, stone), a site fence with a gate (`WOOD`
  posts + rails, or hoarding boards), and a cement mixing trough.
- The crane is the key silhouette difference from `home_site`. Keep it inside the canvas and below the
  top row.

### development_abandoned
- The **same kind of project, left to decay**: a half-built wall shell with no roof, at uneven heights,
  with **no** fresh materials (the game returned them). Add **rusty** leftover scaffolding using the `RUST`
  ramp, with a few poles leaning or fallen (diagonal `L.quad` lines), **weeds and bushes growing through**
  (`L.bush` with `theme.leaf`, grass tufts inside the shell), and a broken fence with missing rails.
- Ground: overgrown, with `theme.ground` speckle reclaiming the dirt.
- It must read as "never finished", not "burned down". No char black, no collapsed roof, no smoke.

### destroyed
- A building that **was finished and then destroyed**: **charred, broken wall stumps** (dark `CONCRETE[1..2]` /
  `BRICK[1..2]` / `WOOD[1]` boxes with jagged tops, made by stacking boxes of different heights), a
  **collapsed roof**: fallen beams lying diagonally plus a slab of `theme.roof` tiles sloping into the rubble,
  a rubble pile (`L.speckle` of grey and brick on a dark patch), and scorch marks on the ground (dark `DIRT[1]`
  patch). An optional thin smoke wisp (2–4 `WHITE[2..3]` pixels) is allowed, but no flames.
- It must read as "a disaster happened here". It must not look like the overgrown abandoned site.

## Distinctness requirements (the point of this brief)

- **Pairs that must clearly differ at 1×:**
  - `home_site` (small, domestic, A-frame truss) vs `development_site` (large, scaffolding + crane).
  - `development_abandoned` (overgrown, rusty, unfinished, no roof ever) vs `destroyed` (charred, collapsed
    roof, rubble).
  - `camp` vs everything else: no structure, just a tent and fire.
- None of the five should resemble a functioning building from the other briefs.

## Acceptance checklist

- [ ] 5 states × 4 biomes = 20 sprites redesigned; `diff` shows all 20 special sprites changed and
  nothing else.
- [ ] The two pairs above are clearly distinguishable at 1× in all biomes.
- [ ] Crane and smoke stay inside the canvas, below the top row.
- [ ] Ground stays readable; biome plants are still present where natural.
- [ ] `npm run art:test` passes.
