# Brief 4 — Homes family: home

- **Edit only:** `art/families/homes.lua`
- **FAMILY:** `homes`
- **KINDS:** `home`
- Read `art/briefs/README.md` first. Its rules, workflow, budget and report format apply.

## The problem you are fixing

Homes currently use the starter house (`U.house`), the same mass the production buildings used.
Tiers just make it taller, and walls are plain apart from faint stripes. Homes will be the **most
common sprite on the map**, so they need the most charm and the clearest tier progression. You may
copy ideas from `U.house`, but write your own drawing in `homes.lua`. Do not edit `common.lua`.

## What homes are in the game

Households live in homes. Tier comes from beds: **T1 ≤6 beds, T2 7–12, T3 13+**. A home can expand up
to 20 beds. Saved Eden's founding home has **6 beds, so it is tier 1** today. New homes start at 5
beds (tier 1) and grow to tier 2/3 as households expand them. Homes are private. They never have shop
signs, workplace props or public plazas.

## Designs

### T1 cottage (≤6 beds) — most important sprite in this brief
- A one-storey cottage (about 16–20 × 14–16 units, walls ~11 px) with a pitched roof (`theme.roof`), a
  chimney, a small **front porch** on two posts over the door, and 2–3 windows **with shutters** (1 px
  `WOOD` or `theme.roof` strips beside the glass).
- **Facade detail:** wall courses or clapboard lines (`L.stripe` in `[2]` at a gentle period), corner trim
  (`L.edge` `[4]`/`[5]`), a door frame, sills, a foot line, and a ridge cap on the roof.
- **Yard:** a garden path from door to lot edge, a low fence or hedge along part of the lot,
  a vegetable patch or flower bed (`L.FLOWERS`), and one biome plant.

### T2 family house (7–12 beds)
- **Two storeys**, with an **L-shaped plan**: a main block plus a perpendicular wing with its own cross
  gable. That gives two ridge lines meeting. Draw the back wing first, then the front block, so the roofs
  overlap correctly.
- Porch or veranda along part of the front, a chimney, upstairs windows aligned over the downstairs ones,
  and a small dormer or balcony.
- **Yard:** a laundry line (two posts and a sagging line with 2–3 coloured cloth pixels), a garden shed, a
  path and a fence.

### T3 courtyard house (13+ beds)
- A **multi-household compound**: three wings in a U (or main house + two annexes) around a **central
  courtyard** with a tree or well. Use wings of different heights (one 2-storey, one or two 1-storey),
  multiple chimneys and several doors. It must clearly house several families.
- The courtyard opens toward the street, with a gate or arch in the front wall. Courtyard ground is paved
  or packed earth with a well (small `L.cyl` `CONCRETE` + roof on 2 posts) or a tree.
- It must not look like the court/council hall or a hotel: keep it domestic, with laundry, garden beds,
  benches and chimneys.

## Biome variation (required for homes)

Homes are the most numerous sprite, so give each biome a **shape** difference, not just colours.
Branch on `theme.biome`:

| Biome | Variation |
|---|---|
| tropical | raised on a low plinth or short stilts (house z0 = 2–3, visible posts or a plinth), **wide veranda**, broad overhang (o=4), palm. Thatch-look roof colour from `theme.roof` is fine. |
| temperate | standard pitched roof, chimney, hedges and fence, deciduous tree. |
| arid | **flat roofs with a parapet** (`L.box` `parapet=`) and a roof terrace: rooftop railing or a canvas shade on posts. Thick `theme.wall` (adobe), small deep windows, courtyard walls, a cactus. No chimney, or a short stubby one. |
| northern | **steeper roof** (larger R relative to span), big chimney, woodpile against the wall (stacked `WOOD` with log-end dots), small windows, pine. |

All three tiers should follow their biome's style. Keep shared code in local helper functions so the
four branches stay small.

## Distinctness requirements

- Homes must not look like any workplace: no signs, awnings, smokestacks, columns or piles of goods.
- Across tiers, the cottage, L-shaped house and courtyard compound must be recognisable at 1×.
- Across biomes, a tropical home and an arid home must differ in **shape** (stilts/veranda vs flat roof
  terrace), not just colour.

## Acceptance checklist

- [ ] 3 tiers × 4 biomes = 12 sprites redesigned; `diff` shows all 12 home sprites changed and nothing
  else.
- [ ] Tier 1 cottage has porch, shutters, wall detail and a yard, and reads clearly at 1×.
- [ ] T2 is L-shaped with two storeys; T3 is a courtyard compound.
- [ ] Each biome has its required shape variation.
- [ ] Nothing clipped; tall northern roofs stay below the top row.
- [ ] `npm run art:test` passes.
