# Council towers — independent review

## Disposition: artwork accepted; all catalog entries remain draft

Viewed four native biome ladders plus enlarged tropical clock, belfry, ceremonial entrance and
megatall crown crops. Warm plaster/timber, round clocks, bells and civic crowns distinguish these
from the heavy grey judicial family. The authored council set is acceptable to proceed to the
next asset stage; this does not activate towers, add capacity, grant land, approve atlas release,
or complete damage integration.

## Independent checks

- Examined all 1,356 baseline expansion hashes: exactly 20 council_4..8 PNGs changed across four
  biomes; 1,336 other expansion PNGs unchanged.
- Compared the source against `source-baseline/towers.pre-council.lua`: the ENTIRE protected
  prefix before the new council section is byte-identical, stronger than selected helper matches.
  Unified diff has only the council insertion and council dispatch hunk; saved at
  `D:/tmp-tidehaven-tests/council-source.diff`.
- Existing council checker: `COUNCIL_CHECKS_OK`.
- Independently rerendered all towers to `D:/tmp-tidehaven-tests/council-repeat`: 100/100 tower
  PNGs byte-identical to delivered output, including 20/20 councils. Main manifests not narrowed.
- Fresh Aseprite instrumented probe to `D:/tmp-tidehaven-tests/council-fresh-probe.json`:
  20 records, zero scalar-colour violations. Complete records and metadata match delivered probe.
- Fresh verify: 302 tests passed; all typecheck/lint/build gates passed. Fresh legacy art:test:
  164 assets rendered and validated across four biomes with identical repeat pixels. Worker
  results checked directly in `council-verify.log` / `council-legacy.log` under the temp directory.

## Review limits and integration requirements

- Completion report's "highest parsed mass top" is NOT highest built geometry. It excludes
  belfry/cupola helpers: e.g. council_8 lists 576 (the belfry's floor), while posts reach 592
  and the cupola extends to at least 610. Therefore do NOT adopt the report's roof-anchor
  deltas as final corrections. Reconcile actual geometry and visible surface masks, not a
  truncated parser summary. Catalog attachments remain unchanged and unapproved for overlays.
- Clock is a screen-space disc on a projected wall. Visually legible at current scale; current
  u/v radius check is a bounding heuristic, not an inverse-projected per-pixel surface proof.
- `councilBanner` is visually a narrow wall-mounted strip, not a demonstrated projecting flag
  bracket: its width argument is unused and most geometry stays on the wall plane. Accepted as
  decoration; do not reuse it as a general variable-width banner API or cite the report as proof
  of a fully checked 3D bracket. No gameplay depends on it.
- The council_8 cupola base and belfry cap overlap in z; the visible composition is acceptable.
  Surface/roof masks must reflect their actual union, not assume a free flat roof deck.
- Probe freshness hashes recipe/probe/job but not the whole loaded dependency graph. Independent
  regeneration supplies current-run evidence; not a cryptographic authenticity guarantee.
- Generated review utilities are ignored. Promote durable checks to tracked scripts before
  release integration; ignored reports alone are not reproducible release gates.

## Next stage

All five tower functions now have accepted authored artwork (100 sprites total), still draft.
Before broad damage/repair overlay production, do a small attachment/mask proof against actual
native buildings, including the tall helper geometry above. Do not silently edit catalog anchors
or infer persistent fire/flood/destruction from condition damage. No gameplay/catalog/atlas/save/
environment/dependency changes, commits or pushes were made by this review.
