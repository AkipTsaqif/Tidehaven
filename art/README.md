# Tidehaven sprite-production kit

Original crisp 2:1 isometric art, **32×16 base tiles**. The production atlas is used by the Map tab and
Overview mini-map. This authoring pipeline never writes simulation state or modifies saved towns.

## New expansion handoff

**Give the cheaper artist `art/NEW_SPRITES_HANDOFF.md`.** It contains the complete new asset inventory,
geometry contracts, individual family briefs, commands, review steps and copy/paste task prompts.
The executable recipes live in `art/expansion/`; all339identities ×4biomes build and every entry is still
`draft`. Reviewed art exists for bridges, boats, fishing, water details and tower tiers 4–8 (996 PNGs).
The 90 damage/repair identities per biome are still starter scaffolds. Do not enable new gameplay from artwork.

**No Aseprite needed to use the reviewed art.** The PNGs are committed in `art/expansion/assets/`
(`<biome>/<key>_<biome>.png`) with a SHA-256 manifest:

```bash
node scripts/art-expansion-package.mjs --check    # any machine: sizes, hashes, exact file set
node scripts/art-expansion-package.mjs --export   # authoring machine after rebuilding the art
```

The packaged art is not in the production atlas: `art/expansion/catalog.json` keeps `draft` status and
`scripts/art-atlas.py` rejects draft extras. Approval and multi-page atlas packing are separate steps.
Per-family review decisions are in `art/expansion/*_REVIEW.md`.

```bash
node scripts/art-expansion.mjs --list --family towers
node scripts/art-expansion.mjs --biome all
python scripts/art-expansion-review.py snapshot baseline
python scripts/art-expansion-review.py sheets --family towers
```

The legacy164assets below remain compatible and unchanged. Atlas v2 packs frames with individual
sizes/pivots/footprints and transparent gutters; the dashboard also accepts the older v1 format.

## Files

- `PROMPT.md`: short production instructions for a cheaper model. Supply this plus one task.
- `iso_lib.lua`: projection/raster/facade helpers, native 16-world-unit (32×16 screen) base tiles.
- `biomes.lua`: deterministic tropical/temperate/arid/northern themes and palm/oak/cactus/pine props.
- `catalog.lua`: kind list, tier thresholds and dispatch to `families/`.
- `families/*.lua`: the drawing recipes, one file per family (production, civic, services, homes,
  specials) so each can be redesigned alone. `families/common.lua` holds shared starter helpers.
- `briefs/`: detailed redesign briefs for a cheaper model, one per family; start with `briefs/README.md`.
- `../scripts/art-review.py`: build all biomes, snapshot/diff hashes per family, write review sheets.
- `build.lua`: batch builder with validation. `templates/new_sprite.lua`: runnable custom-recipe starter.
- `validate.lua`: geometry, seed, palette isolation and tier-contract regression checks.
- `generated/`: reproducible local output, ignored by Git; manifest plus `.aseprite` and `.png` files.
- `samples/`: small committed contact sheets for style review.
- `reference/`: exact copies of the user's supplied 64×32 drafts; **not executable production inputs**.
- `map/`: the earlier hand-placed scene mockup, separate from this recipe kit.

## Build

Aseprite is an authoring dependency, not a runtime dependency. Its MCP starts it in batch mode; no GUI
needs to be open. For shell builds set `ASEPRITE_PATH` if not using the Windows Steam location.

```bash
# Complete set for the user's current Eden seed (no database access):
npm run art:build -- --scenario eden --seed tidehaven-founding-39146379

# One asset:
npm run art:build -- --scenario eden --kind fishery --tier 1

# Seed-selected non-Eden theme:
npm run art:build -- --scenario tidehaven --seed my-world-seed

# Explicit reference biome (Eden still overrides this to tropical):
npm run art:build -- --scenario tidehaven --biome arid --out art/generated/arid

# Full 164-asset test across four biomes against the real Aseprite:
npm run art:test

# After changing sprites: rebuild all biomes, then repack the dashboard Map tab atlas (committed):
python scripts/art-review.py build
python scripts/art-atlas.py
```

Each complete build writes `art/generated/<scenario>/manifest.json` plus 41 assets. Use the manifest,
not a directory glob: partial builds overwrite the manifest with only that requested subset and old
files may still be present. For a delivery atlas always run the complete build.

The manifest includes kind, tier, biome, pixel size, base tile size, fixed footprint, pivot and source
filenames. `scripts/art-atlas.py` packs the production sprite-sheet atlases under `client/public/map/`.
Expansion drafts stay separate until approved; the packer rejects draft entries in production extras.

## Integration with current Eden

Both scenario files' building kinds and every growth workplace template are covered. Existing Eden's
stored scenario identity `eden-growth-1` and seed `tidehaven-founding-39146379` force tropical.

Homes: capacity ≤6 -> small; 7–12 -> medium; 13+ -> large. Workplaces: ≤6 -> small; 7–20 -> medium;
21+ -> large. The optional council recipe is included even though neither founding map currently has
that separate building. Capacity thresholds are presentation only; recipes create no game resources.

All tiers reserve **3×3 base tiles** (96×48 ground diamond) inside a 96×104 canvas, pivot `(48,104)`.
The base tile is still 32×16, not 64×32. Fixed lots prevent later capacity tiers from changing their
map reservation. The renderer positions the continuous bottom vertex at pivot y=104; do not clamp it
to raster row 103. Land/coastline validation must use the entire 3×3 lot, not just its anchor. A fishery
has an explicit water strip inside its lot and needs a shore-aware placement rule.

Pick special assets for actual camps and sites rather than pretending they are operating buildings.
Destroyed state takes precedence over normal kind/tier. `home_site`, `development_site`,
`development_abandoned`, `destroyed` and `camp` are all covered.

## Validation and limits

The builder rejects missing layers, wrong dimensions/pivot, out-of-canvas writes, top-edge clipping,
non-palette source pixels and invalid rectangular/roof footprint coordinates. All four biome sets and
all tiers have been rendered against Aseprite 1.3.18.6. Repeat PNGs for the same seed are byte-identical
under that version. Source-layer palette checks deliberately ignore composite shadow blends.

These checks do **not** prove good art, correct occlusion, plant coverage or land placement. Still
review contact sheets at 1× and 4×. A cheap model saves time by calling tested recipes, not by copying
1,000 lines of catalog prose or reinventing isometric drawing. Wall/facade detailing can be refined in
the shared helpers later; the catalog has been redesigned family by family (see `briefs/`); refine it the same way.
