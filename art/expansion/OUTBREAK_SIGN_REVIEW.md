# Outbreak sign — independent review

## Final disposition: revision accepted as draft component art, with one real concern about size

Supersedes the earlier request below. All 60 entries remain draft; nothing is packaged,
atlas-approved or wired into gameplay.

### Independently verified after the revision

- Exact-key isolation against both snapshots: 60 PNGs changed, every one an outbreak_sign key;
  1,296 others unchanged. Against the committed recipe: 0 lines removed, 333 added.
- Everything before the outbreak section of `damage.lua` is byte-identical to the pre-revision copy,
  so fire, storm, flood and drought source is untouched. The report says it found and reverted a stray
  edit to a shared storm helper; the byte comparison supports that.
- Placement is fixed. Across all six targets the sign now sits at the lot's front paving, within a few
  pixels of the ground mask, instead of in a column at the canvas edge (for example home_1 now
  x 21-27, y 85-91 against ground x 1-94, y 64-103). Viewed the cottage and civic before/after.
- The foot check now tests the bottom row: all 24 placed posts and stakes have their true bottom row
  on verified ground (it was 29 of 36 before), and the new top-only fixture fails through the
  ordinary validator.
- Fresh `compose.py` OUTBREAK_SIGN_OK with the injected-failure test propagating. Fire, storm, flood,
  drought, damage proof and fixtures pass; verify 307 tests; art:test 164; portable package intact.
- The placed-pixel breakdown is now honest: 53.3% GROUND, 6.6% OTHER, 40.2% over empty space (the
  top of the board and cloth), none on WALL or ROOF.

### The concern: the sign is now very small

To fit the narrow paving the revision shrank the art. Measured on the delivered tropical sprites,
the sign is 15 px (5x6) at light, 24 px (6x7) at moderate and 27 px (7x7) at severe, and that is
identical for every size class from 3x3 to 8x8. It was 47, 87 and 118 px before.

- On a large tower the sign is a few pixels beside a 768 px building; in the civic tower panel it is
  barely visible.
- Moderate and severe differ by only 3 pixels, so severity is real in the data (piece count and
  kinds) but hard to read at 1x.
- The report calls this unavoidable. It is a consequence of fitting a review tool's search to narrow
  paving, and the production placement will not be that search.

Accepted because the brief asked for a subtle marker and the structure is sound, but it should be
judged in the real map. If it is unreadable there, the next change is a larger sprite for larger
size classes, not another placement fix.

### Other limits

- The 4x arid closeup crops mostly building wall with the sign at its edge, so it is a poor detail.
- Placement is still a review search; cross-biome proof is one home_4 per biome.
- `requiresMask: false` in the catalog is still unedited.
- Not yet in the portable package: drought and outbreak.

## Earlier disposition (superseded)

### Earlier disposition: validation machinery sound; the artwork is misplaced and under-tested. Revision required.

All 60 entries remain draft. Nothing is packaged, atlas-approved or wired into gameplay.

## Independently verified

- Exact-key isolation against before-outbreak-sign: 60 PNGs changed, every one an outbreak_sign key;
  1,296 others unchanged.
- Source against the committed recipe: 0 lines removed, 319 added (the outbreak section and a
  5-line dispatch arm). Fire, storm, flood and drought source is untouched.
- Fresh `compose.py`: OUTBREAK_SIGN_OK, injected-failure test propagates (78 pieces). Fire, storm,
  flood, drought, damage proof and fixtures all still pass. Verify 307 tests; art:test 164 assets;
  the portable package is intact.
- No outbreak pixel lands on a WALL or ROOF.

## Findings

1. **The review compositions do not show the sign next to a building.** I measured the pixels that
   differ between each base image and its composition. On home_1 the sign occupies x 1-9, y 0-81; on
   council_8 x 1-9, y 0-705; on home_4_arid x 1-10, y 0-139. That is a thin column against the
   **left edge of the canvas**, nowhere near the lot (home_1's ground starts at y 64 and its lot
   centre is x 48). In the viewed previews it is a small orange mark floating in the top-left corner
   of each panel, with the building untouched. Of the pixels placed, only 17 of 68 are on verified
   ground, and 54 sit in empty space with no mask class at all. The report calls this "stands in
   front of the building"; it does not.

2. **The sprite itself is anchored sensibly, so the fault is in placement.** The delivered sprite
   puts the sign at x 20-49, y 70-90 on a 104x104 canvas whose lot centre is x 52, which is near the
   building's front. The composition tool then slides each piece independently to wherever the
   mask check passes. For a standing object that destroys the very arrangement the art depends on.
   Pieces must move together as one assembly, because a board belongs on its post and a rope
   between its stakes.

3. **The post-foot check tests the wrong end.** `validate_post_footed` takes `min(y)`, which is the
   TOP of a post in screen space, then asks whether that row touches ground. Measured over the 36
   placed posts and stakes: the validator's row is grounded for all 36, but the true bottom row
   touches verified ground for only 29. Seven posts have a bottom row on no verified ground. So the
   "every post meets the ground" claim is unproven, and the "post not touching the ground" fixture
   passes only because its synthetic piece is arranged for the wrong end.

4. **The unclassified share is a symptom, not a property of the effect.** 86.5% of placed pixels are
   on unclassified surfaces because the pieces are placed away from the building. Once the assembly
   is placed at the lot's front edge, this figure should change and must be re-measured.

5. **Review image limits.** I viewed the cottage and civic compositions, the four-biome severe
   sheet and one closeup. The closeup is a 4x crop of the stray top-left mark, not of a notice
   standing at an entrance. I could not open an enlarged copy of the sprite because the image viewer
   refused the file path, so I could not judge the board's detail at 4x.

## Requested revision

- Place each composition's assembly as one unit at the front edge of the building's lot, using the
  piece anchors that the metadata already records. Show a before/after where the sign visibly stands
  in front of the building.
- Fix the foot check to test the bottom row in screen space, and add a fixture where only the top
  of a post touches ground, which must fail through the ordinary validator.
- Re-measure and report the material-class breakdown after the placement change.
- Keep every structural property: ground-only class, exact pixel ownership, per-biome metadata, no
  wall or roof pixels, ropes connected at both ends, pieces whole or omitted.
- Keep fire, storm, flood, drought and all shared helpers byte-identical; re-render and compare.

Art direction otherwise stands. No catalog, packaged assets, atlas, gameplay, saves, .env,
dependencies, commits or pushes.
