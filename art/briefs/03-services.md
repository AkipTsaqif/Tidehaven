# Brief 3 — Services & industry family: workshop, shop, clinic, public_works

- **Edit only:** `art/families/services.lua`
- **FAMILY:** `services`
- **KINDS:** `workshop,shop,clinic,public_works`
- Read `art/briefs/README.md` first. Its rules, workflow, budget and report format apply.

## The problem you are fixing

All four kinds use the same flat-roof box (`U.flatHall`). Shop, clinic and public works differ only by
a small awning, a red cross or a prop, and tiers only scale the box. Public works also has a
**modern yellow vehicle**, which breaks the setting rule. **Stop using `U.flatHall`.** Give each kind
its own building type and tier progression.

## What these places are in the game

Workshops make tools and goods, shops sell goods to residents, clinics treat the sick, and public works
maintains roads, water and town infrastructure. Tier 1 is ≤6 workers, tier 2 is 7–20, tier 3 is 21+.
Saved Eden has a 4-worker workshop, a 3-worker shop, a 3-worker clinic and a 6-worker public works,
**all tier 1 today**.

## Designs

### workshop — "forge and craft"
- **Identity:** a brick or timber workshop with a **big open work door**, a **forge chimney** (square brick
  stack, not the old round pipe), an anvil and a workbench in the forecourt.
  - Anvil: a small `STEEL` shape at least 3 px wide on a `WOOD` stump.
  - Forge glow: a few `L.LIT` / `IND_YELLOW` pixels inside the dark door.
- **T1 workshop:** a one-storey brick workshop (`L.C.BRICK` walls, gable roof `theme.roof`), a wide dark
  doorway on the street face with the forge glow, a square chimney, plus the anvil and a workbench with tools.
- **T2 craft hall:** a longer hall with a **sawtooth roof**: 2–3 `L.shed` roofs side by side along i, each
  with a light strip suggesting skylights (`GLASS[4]`). Add the forge chimney, a lean-to storage annex,
  crates and a hand cart with planks.
- **T3 factory:** a big brick hall with a 3–4 tooth sawtooth roof, **two tall square smokestacks** (with
  banding: a darker `L.stripe "h"` every 4 px), a raised loading dock (flat box) with crates and barrels,
  and a small office block in `theme.wall`. Pave the lot (`CONCRETE` or `ASPHALT` on `c.lot`).
- **Biome:** factory brick stays `BRICK`; office and annex use `theme.wall` and `theme.roof`.

### shop — "goods on display"
- **Identity:** a **market look**: striped awnings, displayed goods (fruit, fabric, pots as coloured
  speckles or small boxes in varied ramps), and a hanging sign with a ≥3 px coin or bag icon.
- **T1 stall shop:** an open **market stall**: 4 posts with a striped cloth canopy (`L.quad` roof, striped
  with `L.stripe`, `theme.roof` + `WHITE[4]`), a counter piled with produce, crates and baskets around it,
  and a tiny storage kiosk behind it.
- **T2 market shop:** a 2-storey shop with a big shop window (wide `GLASS` rect with a `WOOD` frame) and a
  deep striped awning on the street face. Upper floor in `theme.wall` with shuttered windows. Add a hanging
  sign and display crates out front.
- **T3 market hall:** a **long open market hall**: a large gable roof on rows of posts, with open arcade
  sides so stalls show inside. Inside or around it, 3–4 stalls with **different awning colours**
  (`theme.roof`, `ROOF_GREEN`, `IND_YELLOW`, `GLASS_TEAL`), plus barrels and carts. The ground is a paved
  square.
- **Biome:** walls and roof from `theme`; awning stripes always alternate with `WHITE[4]`.

### clinic — "white building, red cross, garden"
- **Identity:** **white walls** (`WHITE`), a clear **red cross** (≥5×5 px, `BARN[4]` or `L.BEACON`), a
  covered **entrance canopy**, and a calm garden: bench, flowers (`L.FLOWERS`), hedges.
- **T1 dispensary:** a small white one-storey cottage-clinic with a hip roof (`theme.roof`), a cross on the
  street face, a small porch canopy over the door, a bench, and flower beds.
- **T2 clinic:** a 2-storey white building with an entrance **portico canopy** on 2 posts, the cross above
  the door, regular windows, and a fenced garden with a bench and a hand cart for patients.
- **T3 hospital:** an **L-shaped or two-wing** white building: main block + perpendicular wing. Add a
  central entrance block with a bigger cross, rows of windows, a rooftop with a water tank or vents, a
  garden courtyard with trees, and a covered walkway.
- **Biome:** walls stay `WHITE` everywhere (it is the clinic's identity); roofs use `theme.roof`.

### public_works — "town yard"
- **Identity:** an **infrastructure yard**: a **water tower** or tank, material piles (gravel/sand cones,
  pipes, stacked bricks), tools, a fenced yard, and a utilitarian shed.
  **Remove the modern yellow vehicle.** Use hand carts or wheelbarrows instead.
  - Gravel cones: small `L.poly` triangles with `CONCRETE` / `DIRT` shading.
  - Pipes: a few `L.cyl` lying stacked, or `STEEL` boxes with dark ends.
- **T1 tool shed:** a timber tool shed (`L.shed` roof), a wheelbarrow, a gravel pile, a stack of pipes or
  planks, and shovels leaning on the wall (thin `WOOD` lines with `STEEL` ends).
- **T2 town yard:** a fenced yard (low `WOOD` fence boxes) with a larger shed, a **water tank on legs**
  (`L.cyl` `WOOD` or `STEEL` on 4 posts, conical cap), two material piles, and a cart.
- **T3 works depot:** a big depot garage with 2–3 large doors (dark rects with `L.stripe "h"` slats), a tall
  **water tower**, a material yard (gravel, sand, bricks, pipes), and a small office. Pave the yard.
- **Biome:** sheds and office use `theme.wall`/`theme.roof`; tanks and pipes stay `STEEL` / `WOOD`.

## Distinctness requirements

- Covering the props: workshop = brick hall + square chimney (sawtooth roof at T2/T3), shop = stall /
  awning shopfront / open market hall, clinic = white building + cross + canopy, public works = yard +
  water tower/tank + piles.
- The workshop T3 factory must not look like the public works depot: the factory has smokestacks and a
  sawtooth roof, the depot has garage doors and a water tower.
- The shop must not look like the bakery from brief 1. The bakery has a loaf sign, oven and chimney; the
  shop has goods display and coloured awnings.
- No motor vehicles. No text.

## Acceptance checklist

- [ ] 12 sprites (4 kinds × 3 tiers) redesigned; `diff` shows all 48 family sprites changed and
  nothing outside the family.
- [ ] Each kind identifiable at 1× in all four biomes; the vehicle is gone.
- [ ] Tiers add structure (sawtooth, smokestacks, wings, market hall, water tower), not just scale.
- [ ] Red cross clearly readable at 1×.
- [ ] `npm run art:test` passes.
