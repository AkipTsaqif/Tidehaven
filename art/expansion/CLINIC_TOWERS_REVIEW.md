# Clinic towers — independent review

## Current disposition: revision accepted; proceed to court artwork

This section supersedes the original revision request below. All assets remain catalog `draft`;
this is artwork acceptance, not release/integration approval.

### Revision independently checked

- Crosses are now visibly contained within their backing. Viewed the revised clinic_4 and clinic_8
  emblem closeups; inspected the derived placement constraints in `clinicEmblem`. The updated
  rendered-pixel containment checks pass for all 20 frames.
- Bench supports now reach the seat: two legs z..z+4, seat z+4..z+6, upper/backrest z+6..z+8.
  Read actual recipe and viewed a fresh crop from the native clinic_6 PNG at the garden coordinates.
  The supplied `clinic_bench_tropical.png` / `clinic_bench_arid.png` previews instead show the
  ENTRANCE, so those two labelled preview crops are not bench evidence. The actual bench crop is
  `D:/tmp-tidehaven-tests/clinic-revision-real-bench.png`.
- Viewed all four revised native biome ladders. No new blocking visual defect found.
- Examined all 1,356 entries in `before-clinic-revision`: exactly 20 clinic PNGs changed, 1,336
  other expansion PNGs unchanged. Original `before-clinic-towers` baseline MD5 remains
  `5eb1b3edd280c610415c402b206dc618`.
- Rerendered all 100 tower assets into separate output
  `D:/tmp-tidehaven-tests/clinic-revision-repeat`: 100/100 hashes match current output, including
  20/20 clinic frames. Main expansion manifests were not narrowed.
- Updated clinic checker: `CLINIC_CHECKS_OK`, including emblem-interior and supported-bench tests.
- Fresh `npm run verify` with D: TMP/TEMP: 302 tests passed; all gates passed.
- Fresh `npm run art:test`: 164 legacy assets validated across four biomes; repeat pixels identical.

Catalog attachment anchors still need integration-time surface reconciliation. No catalog, atlas,
gameplay, save or environment changes were made by this review. No commit or push.

## Original disposition: focused revision required

The hospital silhouettes and progression are acceptable. All four biome ladders were visually
inspected, along with emblem, entrance, connection and crown crops. Pale masonry, green medical
emblems, ward wings and planted setbacks give the family a consistent hospital identity.
Do not redesign the masses or change other tower functions.

## Required corrections

### 1. Keep the whole cross inside its plaque

In `clinicEmblem`, the plaque shears down toward the right on the L face, but the upright cross
uses an unsheared vertical origin. Its upper arm escapes the plaque and paints over the wall/window
above. This is visible in the supplied detail crops, especially clinic_8.

A direct calculation of the actual L-face plaque bounds reproduces the defect:

- n=11: cross pixels at relative (4,-9) and (5,-9) are outside the plaque.
- n=13: cross pixel at relative (6,-10) is outside the plaque.

Keep the cross upright if desired, but place every cross pixel on the plaque's INTERIOR, not its
rim or the neighbouring wall. Derive/test this against the actual sheared plaque bounds. Cover
both supported face directions if retaining the R branch. A deliberately upward-shifted cross
must make the new test fail. Do not simply redraw the emblem last to hide an obstruction.

### 2. Join the garden bench seat to its support

`clinicBench` draws a support box from world z to z+2 and a separate seat at z+4. The two world-unit
gap is real; a magnified native clinic_6 garden crop shows the unsupported seat. Extend the support
to the underside of the seat, or supply actual legs reaching it. Preserve the bench footprint and
terrace elevation. Add a helper-level geometry check that fails if the support is shortened again.

## Checks independently rerun

- Full snapshot comparison: all 1,356 baseline expansion keys examined; exactly 20 changed, all
  `clinic_4..clinic_8` in the four biomes. No other expansion PNG changed.
- `python scripts/art-expansion-review.py diff before-clinic-towers --family towers`: passed,
  `INVENTORY_OK 1356`.
- Current generated `tools/cliniccheck.py`: passed. Its current checks do NOT catch the two helper
  defects above. Parsed box overlap and opaque sample pixels are supporting evidence, not a general
  visual-correctness proof.
- `TMP='D:\tmp-tidehaven-tests' TEMP='D:\tmp-tidehaven-tests' npm run verify`: all gates passed;
  302 tests passed, including typecheck/lint/build gates.

- Independent tower rerender to `D:/tmp-tidehaven-tests/clinic-repeat-rerender`: 100 tower assets
  generated; all 20 clinic PNG hashes match the saved pre-rerender hashes exactly. Hashes were
  checked directly after the worker returned. Main expansion output was not replaced.
- Independent `npm run art:test`: passed; 164 legacy catalog assets rendered and validated across
  four biomes, repeat pixels identical, custom starter and geometry/palette checks passed.

These checks establish reproducibility, not correction of the two visual/helper defects above.

## Revision scope and evidence

Only the clinic-specific helpers in `art/expansion/families/towers.lua` may change. Preserve home,
shop, court and council pixels, all other families, catalog metadata, draft status, production atlas,
gameplay, saves and environment configuration.

Take a genuine `before-clinic-revision` snapshot BEFORE any edit/rebuild. Retain the original
`before-clinic-towers` baseline unchanged. Produce new native ladders and enlarged emblem/bench
crops; rerun exact-ID isolation, repeat renders, legacy `art:test`, the strengthened checker and
project verification. Do not claim image viewing if unavailable. No commit or push.
