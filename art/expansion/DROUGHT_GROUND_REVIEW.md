# Drought ground — independent review

## Final disposition: revision accepted as component artwork

This supersedes the earlier request below. All 60 entries remain draft; nothing is packaged,
atlas-approved or wired into gameplay.

### Independently verified after the revision

- Exact-key isolation against both before-drought-ground and before-drought-revision: 60 PNGs
  changed, every one a drought_ground key; 1,296 others unchanged.
- Source against the committed recipe: 0 lines removed, 326 added (the drought section and the
  dispatch arm). Fire, storm and flood source is untouched.
- Colour is fixed. In the 8x8 sprites the dominant colour is now pale earth (201,160,106; arid
  216,184,74) at 35-39%, mean luminance 118-132, instead of one dark brown at 53%. Arid is clearly
  distinct from the other three by tone as well as by cactus.
- Viewed the cottage before/after, the four-biome severe sheet and the arid cottage. The marks now
  read as pale, dry patches with dark crack lines and some dead scrub, and arid reads as the
  driest. Severity reads as more and larger patches.
- Fresh `compose.py`: DROUGHT_GROUND_OK, 352 pieces validated, the injected failure propagates.
  Fire, storm, flood, damage proof and fixtures pass. Verify 307 tests; art:test 164 assets; the
  portable package is intact.
- Omissions on large lots are much lower (home_8 now drops 1, 2 and 3 pieces).

### Limits to carry forward

- Only 60.9% of placed pixels sit on GROUND material; 17.6% sit on OTHER, 21.1% on unclassified
  pixels, and none on WALL or ROOF. The report now says so. Storm and flood share this looseness.
- At 1x the marks are small and subtle on the cottage; judge in the real map before tuning.
- The report's section 7 contains one duplicated paragraph. Cosmetic.
- The catalog still says `requiresMask: false` for drought; it should likely be true. Not edited.
- Placement remains a review search. Cross-biome proof is one home_4 per biome.
- Not yet in the portable package: the three finished overlay effects are packaged, drought is not.

## Earlier disposition (superseded): validation accepted; artwork needs one focused look

All 60 entries remain draft. Nothing here is packaged, atlas-approved or wired into gameplay.

## Independently verified

- Exact-key isolation against before-drought-ground: 60 PNGs changed, every one a drought_ground
  key; 1,296 others unchanged.
- Source: the pre-drought copy is byte-identical to the committed HEAD recipe, and the diff against it
  is pure addition (0 removed lines): one new 301-line drought section and a 5-line dispatch arm.
  Fire, storm and flood source is untouched, so this report's isolation claim holds literally.
- Fresh `compose.py`: DROUGHT_GROUND_OK. Fresh fire, storm, flood, damage-proof and fixture checks
  all still pass. Fresh verify: 307 tests; art:test 164 assets. Portable package intact.
- Through the ordinary composition path with a spy: 272 placed pieces, 4,618 pixels. None on WALL or
  ROOF, none unsupported. The injected-failure test reaches the validator.
- The report's note that its own injected-failure test found a real bug (marks placed on walls) is
  plausible and the fix is evidenced by the zero-violation result above.

## Findings

1. **The ground the marks sit on is largely not verified ground.** The placement check accepts
   ground OR "other" material at known depth <= 2. Measured over the placed marks: 3,150 pixels sit
   on GROUND, but 628 sit on OTHER and 819 on no classified surface at all. The "verified ground"
   claim is only fully true for about 68% of placed pixels. This is the same looseness as storm and
   flood, so it is not new, but the report should not say every pixel rests on verified ground.
   Evidence: `placed px by material class: {None: 819, GROUND: 3150, OTHER: 628, DECAL: 21}`.

2. **Palette reads as dark brown rather than dry.** In the 8x8 sprites, 53% of all pixels are one very
   dark brown (59,42,34, luminance 46), and tropical and arid share the same dominant colours. Dry
   cracked earth should read lighter and paler than the surrounding grass, and arid ground is
   already dry. In the cottage and tower compositions the marks look like dark scattered debris
   rather than cracked, bleached earth. This is the main art concern.

3. **Biome difference is mostly arrangement.** Tropical and arid differ by a few percent of colour;
   arid's visible distinction is a handful of yellow cactus pixels. The report claims real shape
   changes; the cracks do differ in layout, but the colour reads as near-identical.

4. **Large lots lose most of the effect.** Measured in the report itself: home_8 omits 3, 7 and 12
   pieces at light, moderate and severe, so its severe drought shows less than its light one would at
   full strength. Severity ordering holds for the sprites but not for what the composition shows.

5. **Viewing limit.** I viewed the cottage, the civic tower, the four-biome severe sheet and the arid
   closeup. I could not open an enlarged copy of the cottage because the image viewer refused the
   path, so finer judgement of crack shape at 5x was not possible.

## Requested revision (art only, small)

- Make the dry ground read as dry: lighter, paler cracked earth with a few dark crack lines, not
  mostly dark brown. Keep dark for the cracks themselves.
- Make arid differ by tone and crack depth, not only by an added cactus.
- Keep all structure: pixel ownership, ground-only class, no wall or roof pixels, per-biome files.
- Re-run every check from the original brief, and state how many placed pixels sit on GROUND versus
  OTHER or unclassified in the report instead of calling all of them verified ground.

No changes to fire, storm, flood, the catalog, packaged assets, atlas, gameplay, saves, .env,
dependencies, commits or pushes.
