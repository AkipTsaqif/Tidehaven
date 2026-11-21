# Repair scaffold — independent review

## Final disposition: revision accepted as draft component art, with caveats about legibility

Supersedes the earlier request below. All 60 entries remain draft; nothing is packaged,
atlas-approved or wired into gameplay.

### Independently verified after the revision

- Exact-key isolation against both snapshots: 60 PNGs changed, every one a repair_scaffold key;
  1,296 others unchanged. Against the committed recipe: 4 lines removed (the old draft repair branch
  and the line that opened the outbreak branch, re-written as `if`) and 439 added, all in the new
  repair block and the dispatch arm.
- Fresh `compose.py`: REPAIR_SCAFFOLD_OK, with 18 counterexamples caught through the shared validator,
  each with a passing control, including the one this review asked for (standoff reads +2 but the
  scaffold is behind the wall) and the injected-failure test. Fire, storm, flood, drought, outbreak,
  damage proof and fixtures all pass. Verify 307 tests; art:test 164 assets; the portable package is
  intact.
- The standoff-number check was replaced by a test that reads the building's recorded depth and the
  piece's own world box. That answers the finding that the old test could never fail.
- Size is now scaled to the building. Measured: the cottage scaffold is 18x25, 22x31 and 32x40 px at
  light, moderate and severe against a 42x52 building, so it is no longer taller than the building
  (it was 60-81 px). The home_4 and tower scaffolds are 18x25 to 32x40 and 36x52 to 58x87
  respectively. Width now grows with severity (18, 22, 32 on the cottage; 36, 46, 58 on towers).
- Viewed the cottage and civic before/after and the size sheet. It now reads as a timber frame with
  posts, a platform, rails and braces standing against the lower facade, with more bays and a second
  level at higher severity, not a single mast.

### Caveats

- Legibility at 1x is modest. On the 654 px tower the severe scaffold is 58x87 px, so it is a small
  frame at the building's front corner. It reads as scaffolding only when looking closely.
- The post and platform counts are small: 3 posts and 1 platform at light, 4-5 posts and 2 platforms at
  severe. That is a minimal scaffold, not a large reconstruction site, even at severe.
- The report says the facade-relation test deliberately ignores the lot's own boundary wall, so a frame
  standing on the apron is judged only against frontage faces. That is a stated, reasonable scope but it
  means the test does not cover every wall pixel the scaffold overlaps.
- Placement is still one unit with a vertical-only offset, so a lot with its apron elsewhere would be
  omitted. All 18 review targets placed; cross-biome proof is one home_4 per biome.
- The catalog's `requiresMask: true` is kept. A naive mask clip would erase the scaffold's own posts,
  so integration needs a front-of-facade composition rule, not a plain mask.
- Not yet in the portable package: drought, outbreak and repair scaffold.

## Earlier disposition (superseded)

### Earlier disposition: structure and isolation sound; the scaffold does not look like a scaffold. Revision required.

All 60 entries remain draft. Nothing is packaged, atlas-approved or wired into gameplay.

## Independently verified

- Exact-key isolation against before-repair-scaffold: 60 PNGs changed, every one a repair_scaffold
  key; 1,296 others unchanged. The pre-repair copy is identical to the committed recipe.
- Source against the committed recipe: 4 lines removed (the old draft repair branch and the line
  that opened the outbreak branch, re-written as `if`) and 362 added. The dispatch arm moved above the
  generic branch. Nothing in the other effects' code changed.
- Fresh `compose.py`: REPAIR_SCAFFOLD_OK. All 14 counterexamples are caught through the shared
  validator with matching controls, and the injected failure propagates. Fire, storm, flood, drought,
  outbreak, damage proof and fixtures all still pass. Verify 307 tests; art:test 164 assets; the
  portable package is intact.
- The `RUN_ALL_FAIL` the report mentions is a stale baseline from the damage-proof tool and is not a
  regression from this task.

## Findings

1. **The scaffold is a thin vertical tower, not scaffolding along a facade.** Measured on the
   delivered sprites it is 10, 14 and 18 px wide at light, moderate and severe, on every target, and
   60 to 165 px tall. Viewed in the cottage composition it is a single narrow column with a red
   outline from the preview tool. In the civic tower it is a thin pole rising from the front corner.
   A scaffold is a lattice of bays along a wall; this reads as a ladder or a mast. The report itself
   flags "ladder versus scaffold" as the thing to check, and it does not pass.

2. **On the small buildings it is taller than the building.** The 3x3 cottage's wall and roof span
   52 px; its moderate and severe scaffolds are 79 and 81 px tall and reach y 23 and 21 against the
   building's top at y 45. The home_4 towers span about 110 px and their severe scaffold is 81 px, so
   it covers most of the front. The brief said a cottage gets a low scaffold. Only the light variant
   (60 px) is near the building's height; the others tower over it.

3. **On the tall towers it is small.** A 123 to 165 px scaffold against a 654 to 662 px building is
   about a quarter of the height, which fits the "lower storeys only" instruction, but at 10 to 18 px
   wide it is a sliver against a 220+ px frontage. Severity is legible in height and not in width.

4. **"In front of the facade" is asserted, not measured.** `validate_facade_relation` only checks that
   a `standoff` number the recipe wrote into its own metadata is greater than zero. It reads no
   building geometry, so it cannot fail for a real scaffold. 66% of placed pixels sit on WALL and 11%
   on ROOF; that is argued to be correct but is not demonstrated by any test that looks at the
   building's actual faces.

5. **Placement is vertical-only by design,** so a lot whose apron is elsewhere would be omitted, not
   moved. All 18 review targets placed, which is a measurement for these six buildings only.

6. **Viewing limits.** I viewed the cottage and civic compositions, a cottage closeup and the size
   sheet. The closeup crop is dominated by the preview tool's red outline, which makes the actual
   scaffold hard to judge at that scale.

## Requested revision

- Redraw the scaffold as bays along a facade: at least two or three bays wide at light and more at
  severe, with posts, platforms, rails and braces forming a recognisable frame. If the apron is too
  narrow, widen it by standing the structure along the facade rather than only at one corner.
- Scale height to the building. A 3x3 cottage should not be taller than itself; limit height to the
  building's own wall height measured from the mask, with a margin.
- Make severity legible in width as well as height.
- Replace the standoff-number check with a test that reads the building's actual wall faces (or
  mask) to prove the scaffold is in front of them.
- Keep every structural property that now passes: bottom-row foot check, level platforms, two
  supports, connected braces, world-space lot bounds, one-unit placement, exact ownership, per-biome
  metadata, and byte-identical other effects.

No catalog, packaged assets, atlas, gameplay, saves, .env, dependencies, commits or pushes.
