# Impact — sprite expansion foundation and production handoff

## Target
Per-frame asset dimensions, pivots, footprints, attachments and layers; production-kit v2 extension
for bridges, boats, fish-water markers, vertical towers and damage/repair overlays. Keep legacy 164
sprite pixels unchanged. New assets are not automatically new gameplay entities.

## Dependents
art/build.lua and catalog.lua; art-build.mjs; art-atlas.py; art-test.mjs; client map-render.ts,
TownMap.tsx and MiniMap.tsx. Shared map-query DTO gains explicit legacy 3x3 footprints only.

## Risk: Medium
Asset/API shape changes cross authoring, packing and rendering. Domain placement and state remain
unchanged for this slice. Larger runtime footprints require a separate authorized redevelopment
permit; a sprite alone must never enlarge a live building or grant capacity.

## Test coverage
Existing art-test runs 164 sprites with clipping/palette/pivot checks. Add manifest-v2 packing and
legacy adapter tests, variable footprint pivot/culling/hit-test tests, sample bridge/megatall renders,
repeat output hashes, alpha-preserving atlas crop identity. Run verify and browser tests.

## Follow-on phases
Visible existing damage, real bridge/boat construction, spatial permits/funded relocation and tower
economy remain separate release steps from the approved multi-phase plan. Handoff must state which
features are art-ready versus live, and forbid artists from editing saves/economy to demonstrate art.
