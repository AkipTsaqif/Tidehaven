# Court towers — independent review

## Current disposition: portico correction accepted; proceed to council artwork

This section supersedes the earlier revision requests below. Acceptance is for the authored artwork;
all catalog entries remain `draft`, not released or active gameplay.

### Independent final checks

- Read actual `courtPortico`: a solid full-depth landing z0..6 now fully supports the column
  bases, with separate lower steps outside it. Viewed revised tropical/arid entrance closeups and
  all four native biome ladders. Filled pediment retained; no new blocking visual issue found.
- Read per-part support checks: plan containment and elevation now checked for individual bases,
  shafts, capitals and entablature, plus pediment contact and lot bounds.
- Independently mutated COPIES of the instrumented record and ran temporary checker copies:
  horizontal shaft shift, horizontal entablature shift, vertical colonnade lift, and stale recipe
  metadata ALL rejected with exit 1. No production recipe or original evidence modified.
  Evidence: `D:/tmp-tidehaven-tests/court-final-negative-*.{json,py,log}`.
- Fresh Aseprite instrumented probe generated separately to
  `D:/tmp-tidehaven-tests/court-final-fresh-probe.json`: 20 records, zero colour violations;
  records AND freshness metadata exactly match delivered probe. Recipe/probe/job freshness guard
  passes. This guard is not a cryptographic authenticity system or a complete dependency hash;
  the independent regeneration provides current-run evidence for the loaded helpers as well.
- Full baseline comparison: exactly 20 court PNGs changed; 1,336 other expansion PNGs unchanged.
  All three original baseline MD5s match the report.
- Separate rerender `D:/tmp-tidehaven-tests/court-final-repeat`: 100/100 tower PNGs byte-identical,
  including 20/20 courts. Main expansion manifests not narrowed.
- Fresh court checker: `COURT_CHECKS_OK`.
- Fresh verify: 302 tests passed; typecheck/lint/build and all gates passed. Fresh art:test:
  164 legacy assets validated across four biomes, repeat pixels identical. Worker results verified
  directly against `court-final-verify.log` and `court-final-legacy.log`.

Roof attachment metadata still needs later surface reconciliation. Generated review tools need
promotion to tracked utilities before long-term integration; ignored reports alone are not durable
release tests. No catalog, atlas, gameplay, save, environment, dependency, commit or push changes
were made by this review.

## Previous disposition: revision 1 partly fixed; one focused support correction remains

This section supersedes the original findings below where noted. Do not redesign tower masses.

### Accepted corrections

- `courtPediment` now uses scalar `L.C.CONCRETE[3]`. Viewed repaired tropical pediment and
  entrance crops: the previous black/open wedge is filled with masonry.
- Removed the accidental judicial-gallery block from `clinicWard`; inspected the actual helper.
- Fresh instrumented Aseprite probe: 20 records, zero scalar-colour violations, written separately
  to `D:/tmp-tidehaven-tests/court-rev-fresh-probe.json`.
- Revision baseline audit: exactly 20 court PNGs changed, 1,336 other expansion PNGs unchanged.
- Fresh separate tower rerender: 100/100 hashes match, including all 20 courts.
- Fresh verify: 302 tests passed and all gates passed. Fresh legacy art:test: 164 assets validated.

### Remaining blocker: support check still ignores horizontal contact

Section E now reads real instrumented coordinates, which is an improvement, but it aggregates
minimum/maximum z values by part category. It does NOT check plan overlap or containment between
any individual step, base, shaft, capital and entablature. Equal heights do not establish contact.

An isolated counterexample was run without editing the real recipe or artist's probe data:
all shaft boxes (H=38) in a copy of the draw record were shifted +4 in j, disconnecting them from
their bases and capitals. A temporary copy of the checker consumed this altered record and returned
exit 0, `COURT_CHECKS_OK`.

Evidence: `D:/tmp-tidehaven-tests/court-shifted-shafts.json`,
`court-shifted-check.py`, `court-shifted-check.log` in the same temp directory.

The actual current foundation mismatch raised in the original review also remains unchanged.
Example court_8 tropical, relative to its front wall at j=110:

- highest step: i48..92, j110..112, top z6;
- first column base: i48..54, j110..116, bottom z6;
- first shaft: i50..52, j112..114, bottom z6;
- lower steps beneath that projection reach only z4/z2.

Thus only the rear strip of the wide base meets the highest step; the shaft's direct projection
is beyond that highest landing. The report's claim that the columns stand on the top step is not
established by its z equalities. Provide a continuous founded landing/plinth under the column bases
(or adjust their positions/steps) while retaining visible descending entrance steps and staying
inside the lot. This is a small portico correction, not a tower redesign.

### Final revision requirements

1. Check each actual support link in plan AND elevation, not category extrema. Require each column
   base to be fully founded by the landing/plinth, shaft inside its base, capital supported by its
   shaft, and entablature contacting real capitals. Spanning beams need support at their ends,
   not full-length solid fill. Preserve the filled pediment and its beam contact.
2. Add failing counterexamples for horizontal shaft separation AND horizontal entablature
   separation, plus the existing vertical-lift test. Test all current tiers/biomes.
3. Make stale probe evidence fail closed: regenerate the probe on each checker run, or bind its
   records to recipe/helper/job hashes and reject mismatches. Currently courtcheck.py reads an
   existing JSON file without proving it matches the recipe under review.
4. Take a genuine `before-court-revision-2` snapshot before changes. Keep both earlier baselines.
   Only court helpers and generated validation tools/reports may change. No further clinic edits.
5. Rebuild/refresh crops; repeat exact-key isolation, repeat rendering, strengthened checker,
   legacy art:test and project verification. No non-court PNG changes permitted.

All assets remain draft. Do not start council yet; no commit/push or gameplay/catalog/save changes.

## Original disposition: focused revision required

The courthouse identity, grey stone, entrance colonnades, scales plaques and tier progression are
acceptable directions. Viewed all four native biome ladders and enlarged emblem, entrance, gallery
and northern crown crops. No broad redesign requested. All sprites remain `draft`.

## Required corrections

### 1. Give the pediment a real scalar palette colour

`courtPediment` passes `r == 0 and trim[3] or tympanum` to `L.quad`, but `tympanum` is the
ENTIRE `L.C.CONCRETE` ramp table. For r>0 this is not a pixel colour. The enlarged court_6 entrance
shows a black/open wedge and a broken light edge where the masonry triangle should be.

This was reproduced against real Aseprite without changing the source: a wrapper around `L.quad`
asserting `col == nil or type(col) == 'number'` fails with `QUAD_NON_SCALAR_COLOUR table` and a
traceback to `towers.lua:1820`, `courtPediment` -> `courtPortico` -> `court6`.
Probe: `D:/tmp-tidehaven-tests/court-colour-probe.lua`.

Use an indexed palette colour, then verify the filled triangle and cornice visually. Add a
helper-level scalar-colour guard/test: replacing the colour with the ramp table must fail even if
the ordinary builder and final image palette check pass. Do not change the shared art library as
part of this family pass; a generated validation wrapper can enforce the contract.

### 2. Restore the accidentally edited clinic helper

The block beginning `-- projecting judicial galleries` was inserted into `clinicWard`, before the
court section, as well as into `courtHall`. It calls `courtGallery` and uses court-only style fields
`cs.deep`. Because the `local function courtGallery` declaration occurs LATER in the chunk, the
reference inside `clinicWard` is not bound to that local helper either.

It happens to be dormant because existing clinic calls do not set `opt.gal`; hence clinic hashes
remain unchanged. This is still an unauthorized source change and contradicts the completion
report's claim that no clinic helper was edited. Remove only the accidental block from clinicWard;
retain the intended courtHall implementation. Verify the rest of home/shop/clinic helpers against
the actual pre-court source if available. Output hashes alone cannot prove source isolation.

### 3. Make the entrance checker evaluate the real helper, not a different formula

Section E of `tools/courtcheck.py` uses `calls[5]` (the PORTICO WIDTH argument) as if it were
`cs.deep`. Its formula also omits the real helper's minimum depth of six. It consequently reports
portico depths 10/8/10/12/16 for the five tiers, while the actual helper resolves to depth SIX for
all current biomes/tiers: even(max(6, min(cs.deep+2, room-2))).

The section title promises that the pediment is carried by the colonnade, but its implementation
only checks a computed j endpoint. It does not inspect the column/step/entablature/pediment
foundation chain. With actual depth six, the highest step ends at rail+2, the column shafts occupy
rail+2..rail+4, and their wider bases reach rail..rail+6. Explicitly check and, if needed, correct
the support geometry rather than silently treating these mismatched extents as full support.

Derive the actual style fields and helper geometry (prefer instrumented helper calls) and test
outward bounds and the support chain. Deliberately moving a column/entablature away from its
support must fail. Correct the report's geometry numbers accordingly; do not preserve the current
incorrect evidence merely because COURT_CHECKS_OK is green.

## Independent validation completed

- Full baseline examination: 1,356 entries; exactly 20 changed PNGs, all court_4..8 across four
  biomes; 1,336 other expansion PNGs unchanged.
- `before-court-towers.json` MD5: `c03b29d8fb27662a1c742441a02f5dbd`, matches supplied report.
- `diff before-court-towers --family towers`: passed; `INVENTORY_OK 1356`.
- Repeat tower render to `D:/tmp-tidehaven-tests/court-review-repeat`: 100/100 tower PNG hashes
  match current output, including 20/20 court frames. Main manifests not narrowed.
- Existing court checker passed; its weaknesses above explain why that is not acceptance.
- Fresh `npm run verify` using D: TMP/TEMP: 302 tests passed; all gates passed.
- Fresh `npm run art:test`: 164 legacy assets validated, four biomes, repeat pixels identical.
- Verified worker test claims against saved logs directly.

## Revision scope

Take `before-court-revision` snapshot BEFORE edits/rebuilds; preserve original court baseline.
Edit court-specific code plus ONLY the removal of the accidental court-gallery block from
clinicWard. No other helper/family changes. Generated checks/reports/previews may be updated.

Rebuild, regenerate true entrance crops, rerun strengthened checker/counterexamples, exact-key
isolation, repeat hashes, legacy art tests and project verification. Expected changed PNGs: court
keys only (possibly fewer than 20 if some corrections are source/checker-only); require all non-court
keys unchanged. Document actual changes rather than requiring gratuitous changes to reach 20.

Catalog anchors still require later integration-time surface reconciliation. No catalog, atlas,
gameplay, save, configuration, dependency, commit or push changes authorized.
