# Brief 2 — Civic family: guard_house, court, council

- **Edit only:** `art/families/civic.lua`
- **FAMILY:** `civic`
- **KINDS:** `guard_house,court,council`
- Read `art/briefs/README.md` first. Its rules, workflow, budget and report format apply.

## The problem you are fixing

All three kinds currently use the same flat-roof box (`U.flatHall`) with a small rooftop add-on.
**Court and council are nearly identical**: same box, same columns, same little hip-roofed cupola.
Tiers only scale the box. **Stop using `U.flatHall`.** Give each kind its own architecture and its own
tier progression.

## What these places are in the game

Guards keep order, the court resolves disputes and crimes, and the council is the town's governing
body. Tier 1 is ≤6 workers, tier 2 is 7–20, tier 3 is 21+. Saved Eden has a 3-worker guard house and a
3-worker court, both tier 1 today. **Council** has a recipe but no building yet in the current maps,
so it must still be clearly different from the court for when it appears.

## Visual language per kind (keep these identities separate)

| Kind | Material | Key shapes | Mood |
|---|---|---|---|
| guard_house | rough stone (`CONCRETE` / `WHITE` dark steps) + `WOOD` | **tower**, crenellations, palisade/wall, flag | defensive |
| court | pale stone `WHITE` | **columns**, triangular **pediment** facing the street, wide **steps**, scales icon | formal, classical |
| council | `theme.wall` + `WOOD` / `BRICK` | **pitched hall + bell or clock tower**, banner/flag, plaza with benches | civic, communal |

## Designs

### guard_house
- **T1 watch hut:** a **wooden watchtower** on 4 tall posts (`L.box` 2×2, height ~22) with an X brace and
  a railed platform (`L.flat` at z≈22, plus thin rail boxes). Top it with a small hip roof in `theme.roof`.
  Add a ladder (two thin posts + `L.stripe "h"` rungs) and a tiny guard shed at its foot.
- **T2 guard house:** a squat stone building with **crenellated** parapet. Make the crenels by
  alternating small boxes along the parapet rim. Attach a taller stone tower at one back corner with
  crenels and a flag (pole `STEEL` + a small `L.quad` cloth using `theme.roof` or `BARN`). Add an arched-look
  door (dark 4×7 rect with a lighter top edge), a weapon rack or a bench, and a lamp (`L.LIT` dot).
- **T3 watch station:** a **walled compound**. Low stone walls (`L.box` height 5–6) enclose a yard, with a
  gate gap facing the street. Inside: the stone guard house, a taller tower with crenels and flag, and a
  small barracks shed. Use a paved yard on `c.lot` (`CONCRETE` or `DIRT`).
- **Biome:** tower roof uses `theme.roof`; stone stays the same. In tropical, a thatch-like `theme.roof`
  watchtower is fine.

### court
- **Identity:** a classical temple front. Draw a row of **columns** (thin `WHITE` boxes, 2×2) holding up a
  **pediment**: a gable with `axis "j"`, so the triangle faces the street (left face). Wide **steps** in
  front (2–3 stacked `L.box` slabs, each 2 units deeper and 2 px lower). Put a scales-of-justice icon in the
  pediment triangle, at least 3 px wide, in `IND_YELLOW` or `STEEL`.
- **T1 court house:** small pale stone hall, 2 columns, a small pediment, two steps and a lamp post.
- **T2 town hall:** a larger hall with 4 columns, a full pediment, three steps, and tall windows on the side
  wall (2×4 with sills). Add a small paved forecourt with two planters.
- **T3 civic hall:** the columned front plus a **dome** on a drum behind it (`L.cyl` drum + `dome=true` cap in
  `WHITE` or `ROOF_GREEN` for a copper look). Add side wings, broad steps across the front, and a paved
  plaza with a statue on a plinth (small box + figure dots).
- **Biome:** stone stays `WHITE`; roof slopes behind the pediment may use `theme.roof`. Plaza edges get
  `theme.leaf` bushes.

### council
- **Identity:** a **long pitched-roof meeting hall** with a **bell tower or clock tower**, plus a gathering
  space out front: benches, a flag or banner. It must look communal and warm, not classical.
  **No columns-and-pediment front**, which belongs to the court, and **no dome**.
- **T1 council hut:** an open-sided **meeting pavilion**: a hip roof (`theme.roof`) on 4–6 posts, with no
  walls. Inside, a ring of benches or a central post can be seen. Add a flag pole beside it and a
  fire/brazier or notice board out front (board = `WOOD` box with a few `WHITE` dots for notes; no text).
- **T2 council hall:** an enclosed long hall (gable along i, side wall with 3–4 windows facing the street),
  a big double door on the street face, a small **bell cupola** on the ridge (tiny box + hip roof + bell
  dot in `IND_YELLOW`), benches and a flag.
- **T3 assembly hall:** the hall plus a **tall square clock tower** at one end, 2–3× the hall's height. The
  clock face is a ≥3 px `WHITE` circle (screen-space `L.ellipse(c, x, y, rx, ry, col)` anchored with `L.P`) with `L.OUTLINE` hands, under a
  pyramid `L.hip` cap. Add an annex wing, a plaza with benches, flags or banners in `theme.roof`, and a
  bush border.
- **Biome:** walls `theme.wall`, roofs `theme.roof`. These should change visibly between biomes.

## Distinctness requirements

- Covering the props, guard house = tower/walls, court = columns + pediment + steps,
  council = pitched hall + bell/clock tower. They must not share a main silhouette.
- Court and council must be distinguishable at 1× in every biome. This is the single most important check
  in this brief.
- Do not reuse the old rooftop cupola on more than one kind.
- No text; icons only.

## Acceptance checklist

- [ ] 9 sprites (3 kinds × 3 tiers) redesigned; `diff` shows all 36 family sprites changed and
  nothing outside the family.
- [ ] Court vs council clearly different at 1× in all biomes; guard house reads as defensive.
- [ ] Tiers add structures (tower, wings, wall, dome, clock tower), not just scale.
- [ ] Tall towers and domes stay below the top row; flags and sails are not clipped.
- [ ] `npm run art:test` passes.
