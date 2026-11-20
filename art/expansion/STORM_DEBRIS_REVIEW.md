# Storm debris — independent review

## Final disposition: revision 2 accepted as component artwork; proceed to flood staining

Supersedes the sections below. Entries remain draft; nothing here is packaged, atlas-approved or
wired into gameplay.

### Independently verified after revision 2

- Fresh `compose.py`: STORM_DEBRIS_OK. Both validators run for every placed piece (146 pieces across
  the 18 compositions); injecting a failure into either one now fails the run.
- Re-ran placement independently over all 198 candidate pieces on the six targets: zero accepted
  placements keep only part of a piece. The 50% retention rule is gone.
- Registration compares the mask-probe base to the delivered target by hash; all six pass.
- Exact-key isolation: 59 PNGs changed since revision 2 and 60 since the original snapshot, every one
  a storm_debris key; 1,296 other expansion PNGs unchanged. The 59-sprite change is the one genuine
  art fix (a shingle whose torn edge floated off its tile).
- Fresh rebuild: 120 files (60 PNG + 60 metadata), no differences.
- Fresh verify 305 tests, art:test 164 assets, damage proof and fixtures pass. The 996-image portable
  package still verifies, so it was not disturbed.
- Viewed the updated cottage and civic compositions and the severity ladder. Fragments are small,
  readable and subordinate to the building; severity reads as more pieces over a wider area.

### Limits to carry forward

- Placement is a review search, not the production rule. Because pieces must now fit whole, small
  lots drop many of them (home_4 arid moderate keeps no ground debris). Integration needs a real
  ground map, and may want a smaller debris vocabulary for 3x3 lots.
- The attachment-edge check is still a screen-space projection of the recorded edge. It is not a
  resolved target-face identity. Treat it as a review gate only.
- Masks carry no provenance sidecar, so registration is a hash check against the live base.
- Cross-biome proof is one `home_4` per biome. Ground/attached split lives in JSON, not layers.
- Uncommitted: `art/expansion/families/damage.lua` (scorch + storm) and `scripts/art-expansion.mjs`
  (per-run metadata directory). Review tools and metadata stay under ignored `art/generated/`.

## Previous disposition: ownership fixed; composition validation still needs wiring

This supersedes the original pixel-split finding below. No broad art redesign requested.

### Independently verified improvements

- All60sprites split with zero ownership errors; recombining ground+attached gives exact RGBA bytes
  of every delivered PNG. No PNG changes from before-storm-revision (metadata/source-only revision).
- Fresh compose run exits0; rerenders and compares120files (60PNG+60JSON), zero differences.
- Fresh verify305tests/allgates; legacy164validated; damage proof and fixtures pass.
- Viewed updated home8severe detail and aridhome4severe composition. More original fragments now
  survive; accepted pixel split removes the prior2122missing-pixel issue.

### Remaining focused corrections

1. **Ground validator is never called for ordinary compositions.** `check_compositions` calls
   validate_attached_piece only in the non-ground branch and never calls validate_ground_piece.
   Independently replaced validate_ground_piece with an unconditional failure and reran ordinary
   check_compositions: no failure propagated. Negative fixtures calling this function therefore
   do not establish protection of the delivered composition path. Wire a shared placed-piece
   validation step for BOTH classes into ordinary composition and every counterexample. Include
   injection/spy regression proving each shared validator is reached and failures reach exit1.

2. **Intact-or-omitted claim remains false.** place_piece filters pixels to allowed support, and
   check_compositions accepts any retained fraction>=0.5. Independent severe-sample inspection
   found18partial candidate pieces accepted by this threshold (e.g. home8ground6/10,14/16,3/6;
   cottage attached3/6). Select an offset preserving the entire final-visible source piece or
   omit/report it. If a narrowly justified crop is genuinely necessary, explicitly define it
   and validate connectivity/identity; do not call50%clipping "intact".

3. **Attachment provenance still isn't checked against the receiving face.** Recorded face is
   the notional source plane; no target face identity/contact is resolved. validate_attached_piece
   receives `edge_px = placed` (the ENTIRE pixel list), so its edge check is always nonempty.
   edge_survives tests only the source's minimum screen-y row for top edges; bottom edges always
   pass. Project the recorded real attachment edge (not just min screen-y), transform with the
   selected placement, resolve to an actual target face/known-depth support, and validate surviving
   contact/connectivity. Use the SAME ordinary placed-piece validator for a severed-edge fixture.
   The current fixture calls edge_survives directly and even reports "residue still on WALL:False",
   contradicting the report's premise. Build an appropriate known-depth wall fixture/control.

4. **Registration is size-only.** Runtime check only compares base.size to mask.size; compare the
   mask-probe base RGBA/hash to the delivered target and bind masks to recipe/probe/job provenance
   or regenerate fresh. Dimension equality alone cannot prove correct material registration.

5. Preserve true pixel split and separate --dir metadata outputs. Fresh-run provenance still needs
   recipe/helper/job binding (not present in metadata currently). Require actual metadata file-set
   enumeration for extras/missing on both sides, not a fixed120-key comprehension.

Take before-storm-revision-2 evidence before edits. Keep source fixes storm-specific, no change to
fire/other effects. Update report with actual retained/omitted results. No commits/pushes or catalog/
package/gameplay edits. Stop before flood. This request primarily corrects tool wiring and claims.

## Original disposition: focused split/attachment revision required

Viewed tropical cottage severe before/after, home8 severe detail and northern home4 severe
before/after. Palette and small timber/tile fragments are a suitable direction; no broad redraw
requested. However the review compositions omit pixels from the delivered artwork, so they do not
currently establish acceptance of the complete ground/attached components.

## Independent checks passed

- Full before-storm-debris snapshot: exactly60storm_debris PNGs changed;1296others unchanged.
- Fresh separate damage-family rerender:60/60storm PNGs byte-identical.
- Fresh verify:305tests passed, all typecheck/lint/build gates passed.
- Fresh art:test:164legacy assets validated across4biomes, repeat identical.
- Accepted damage proof DAMAGE_PROOF_OK and FIXTURES_OK.

## Required corrections

### 1. Exact ground/attached pixel provenance

`stormBox` records only two projected diagonal corners. An isometric rectangle can have screen
extrema at the other corners. `load_pieces` then copies visible pixels from axis-aligned boxes,
which cannot recover individual ownership when pieces overlap.

Independent comparison of every sprite's opaque pixels against the UNION of its metadata boxes:
ALL60sprites have unassigned pixels;2122opaque pixels in total lie outside every piece box.
Examples tropical3x3_104 light19/55, moderate35/162, severe59/307 omitted. Compositions therefore
silently discard real fragments. Even corrected box extrema alone cannot solve overlap ownership.

Emit actual per-piece/class masks or separate source layers, with final occlusion/draw order
preserved. Require complete classification of every delivered visible pixel, ground/attached
exclusivity after compositing and exact recomposition of the delivered PNG (RGBA where relevant).
Add a diamond-extrema fixture and overlapping cross-class fixture that fail if ownership is wrong.
Do not simply enlarge every box and declare success.

### 2. Prove physical support/contact, not clipped containment

`validate_attached_layer` only checks WALL/ROOF+known depth; the alleged detached-hanging fixture
moves a pixel onto GROUND. It never tests a severed cloth anchor while the cloth remains over a
valid wall. Record and validate each piece's receiving face/anchor, attachment edge and retained
connection after clipping. A hanging fragment whose top connection is removed must fail the normal
validator even if every remaining pixel lies on WALL with known depth.

`validate_ground_layer` accepts a connected piece if ANY pixel is within2px of ground. An
independent synthetic12px vertical fragment with only its final pixel supported passes. That does
not prove a plank lies on the ground or that its world geometry is founded. For flat debris validate
world-plane footprint/contact and visible support; for a thickness/lift allow an explicit small
geometry-derived tolerance, not arbitrary unsupported connected tails. Do not rely only on
post-placement clipping that destroys the piece's identity.

Review-only content search may remain explicitly labelled, but preserve intact pieces and reject
or report targets where a piece cannot be placed. No claimed production placement from pixel search.

### 3. Honor copied directories and immutable metadata

`check_compositions(directory)` ignores directory: `load_pieces` always reads DELIVERED. Metadata
always comes from a shared fixed META directory. The repeat build also overwrites that same metadata
from inside `stormMeta`, so it is not independent evidence.

Honor the supplied input directory for ALL images and geometry/provenance. Emit metadata alongside
the requested output or into a passed destination; fail clearly if required metadata cannot be
written (stormMeta currently silently returns). Keep rerender outputs separate, compare metadata
and PNG key sets/hashes, and reject stale recipe/helper/job provenance. No shell-outs per sprite.

### 4. Complete report evidence

Replace attached/ground count rows containing `...` with actual18composition results. State kept
versus omitted piece/pixel counts and reasons; use meaningful supported pieces, not merely >0pixel.
Verify target mask/base exact registration at run time. Retain exact60identity checks for real and
repeat directories rather than a fixed dictionary that always has60keys.

## Revision scope

Preserve before-storm-debris and genuine pre-revision source/output evidence. Only storm-specific
code may change in damage.lua; fire scorch and all other effect branches/outputs must remain
unchanged. Isolated generated review tooling may change. No shared art helpers, accepted proof
baselines, catalog, packaged assets, atlas, gameplay, save, environment, dependencies, commits or
pushes. Stop before flood staining. All storm entries remain draft.
