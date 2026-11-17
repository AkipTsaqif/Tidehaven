# Damage / repair attachment proof — independent review

## Current disposition: revision 3 accepted as a LIMITED attachment proof

This supersedes earlier revision requests below. Approval covers the three tropical sample
buildings and three moderate effects only, not a general production compositor or all overlays.
All expansion art remains draft.

### Independent v3 review and verification

- Viewed native before/after panels for all three buildings; cottage, tower scaffold and attachment
  closeups. Scaffolds now follow the facade's world projection, platforms have depth and braces,
  flood marks remain low. Restrained soot is acceptable for this moderate proof.
- Checked every reported attachment pixel directly against material, decoded z, visible face ID
  and recorded world face bounds: home_1 (27.5,14.5,6), home_8 (54.5,55.5,468), council_8
  (64,64,604) all pass. These are qualifying local decks, NOT replacement roof-apex anchors.
- Normal validator returns no failures; all six support/footprint counterexamples reject with
  their intended reasons, including the one-pixel transverse post gap.
- Source uses a full even-odd quad rasterizer; symmetric fill fixture passes. Face-aware resolver
  requires a horizontal face, connected visible region and an interior candidate.
- Found and fixed ONE review-tool wiring error directly: `main()` computed `raster_fails` but
  discarded it. Now `fails = raster_fails + validate()`. An injected raster failure previously
  yielded exit0/DAMAGE_PROOF_OK; after the correction it yields exit1. No artwork changed.
- Reran full `run_all.py` AFTER this correction: RUN_ALL_OK; both generation passes succeed,
  FIXTURES_OK / DAMAGE_PROOF_OK, 104 generated outputs have zero hash/set differences. Broken
  probe, missing output and extra output runner tests all reject.
- Full protected coverage verified by runner: 1,356 expansion PNGs + 164 legacy PNGs + 31
  source/atlas/proof inputs = 1,551 entries; zero external changes. Eight proof-tool files
  differ in-scope from their v3 pre-edit baseline. Logs: D:/tmp-tidehaven-tests/damage-v3-final-run.log.

### Boundaries for next production stage

- Keep face IDs, masks and actual surface selection as integration prerequisites; legacy generic
  overlay IDs alone do not encode the target building's surfaces.
- Current validator is purpose-built: post row coverage is not a general 3D structural solver;
  world-vertex lists and face summaries must remain tied to emitted geometry. Rounded pixel
  transforms and thin boundaries require explicit raster tolerances in a production tool.
- Attachment validator checks material/depth but does not independently recompute all connected
  patch/face claims; the resolver and this independent direct inspection supplied that evidence
  for the three samples. Strengthen before generalizing to arbitrary buildings.
- Corrected flood bands and masks are accepted on these three tropical samples. Other biomes,
  other tower functions, severity progression, live map compositions and gameplay selection
  still need separate acceptance.
- Next artist batch should be fire_scorch only (15 identities/biome, 60 total), not all 360 at once.
  Preserve proof baselines and all other expansion PNGs; source edits only in damage.lua.
  Promote reusable proof utilities into tracked scripts only in a separate integration change.

No catalog/atlas/gameplay/save/environment changes, commits or pushes made by this review.

## Previous disposition: v2 improved; focused correctness revision still required

### Improvements independently verified

- Fresh `python art/generated/damage-proof/tools/run_all.py` exits 0: 8 MASK_OK,
  FIXTURES_OK, DAMAGE_PROOF_OK; 50 generated PNG repeat hashes identical.
- All three native probe bases now match delivered RGBA pixels exactly, including home_1.
- Viewed revised cottage before/after, tall scaffold crop, low council flood crop, cottage masks
  and council attachment preview. World-space scaffold direction is materially improved.
- Common validator now catches the supplied four larger counterexamples.

### Remaining blockers (v2)

1. **Attachment is not a receiving patch.** `previews.py:resolve_attachment` groups ALL roof
   pixels by rounded z, then averages them. There is no face/connected-component identity,
   planarity check, or guarantee the centroid belongs to that group. It labels sloped contours
   "horizontal deck" without checking the recorded faces. Independent decoded samples:
   - home_1 reported pixel (51.5,52), z24; rounded point is roof at z25.
   - home_8 reported (127.5,114.3), z591; rounded point is roof at z593.
   - council_8 reported (127.5,105.5), z600; rounded point is WALL at z601.
   Select an actual recorded receiving face/connected visible patch; choose an interior pixel
   on it, not a centroid in a hole/other face. Verify full world i/j/z against that face and
   actual material/depth map using consistent pixel-centre coordinates. If horizontal support
   is required, choose a genuinely horizontal deck; do not rename a slope as a deck.

2. **Continuity remains a percentage heuristic.** `check.py` accepts 90% sampled post coverage.
   Independently erased one complete pixel row across both shaft columns at world z13 on the
   second home_8 post: `validate(copy,False)` returns `[]`. A physically disconnected post must
   not pass merely because the gap is short. Check unbroken endpoint-to-endpoint connectivity
   in the intended post corridor (with explicit raster tolerance, not an arbitrary missing-row
   budget). Keep foot/mid-gap/platform fixtures through the same normal validator.
   Evidence copy: `D:/tmp-tidehaven-tests/damage-v2-one-row-gap`.

3. **Platform rasterizer draws only one triangle.** `effects.py:quad_world` tests edges of
   pts[0], pts[1], pts[2] only, never the second triangle or full quad, despite its docstring.
   A symmetric diamond test leaves (7,4) transparent and fills its symmetric mate (12,4).
   Render both triangles or use the established full-polygon pixel-centre test. Validate the
   expected full platform footprint with a tight justified raster tolerance; the current 45%
   threshold permits this half-platform defect.

4. **Lot-bound check is a stub.** Under "everything inside reserved lot", `check.py` assigns
   i,j=None, runs an empty z loop, and checks only canvas bounds. Validate all emitted world
   post/brace/rail/platform vertices/extents against [0,A]x[0,D], including depth/overhang.
   Add an out-of-lot geometry fixture that remains on-canvas and fails the ordinary validator.

5. **External hash scope is overstated.** BEFORE_STATE.json has 187 entries and ZERO expansion
   PNGs. It cannot support "every delivered legacy/expansion PNG unchanged". Keep the original
   manifest intact and correct the report. For the next revision snapshot an explicit complete
   1,356 expansion PNG set, plus intended legacy sources/assets/atlas and proof-input scripts.
   Verify exact coverage/key sets as well as hashes; never reconstruct old baseline provenance.

6. **Repeat runner can accept failed regeneration.** `run_all.py` ignores all return codes and
   MASK_OK/error markers on its SECOND probe/effects/previews pass. Old files can remain equal
   after failure. Fail closed on every second-pass error and compare exact file sets. Also assert
   base pixel equality within the ordinary runner, not only in prose.

All fixes stay inside art/generated/damage-proof/. Preserve v2 evidence separately before edits.
No full overlay production, catalog corrections, gameplay/atlas/save/environment edits, commits or
pushes approved.

### Supplemental mask audit (verified after v2 review)

- `fx_unknown` puts its decoration at screen (20,40), where the undeco­rated box has NO opaque
  pixel or depth. Verified `fx_texture` and `fx_layer_order` bases/depth images are transparent
  there. Thus it tests creation of unknown depth on empty space, not replacement of a known
  hidden wall depth. Put the decoration on a verified existing wall sample; assert the original
  known class/depth first, then DECAL/UNKNOWN after replacement through the normal path.
- Texture fixture checks labels/depth but not whether any texture was actually drawn. Assert
  changed base pixels compared to an otherwise identical untextured control, at intended surface
  samples, while material/depth stay unchanged.
- `encodeZ(UNKNOWN)` calls `rgb(255,255)` without the blue argument. The subagent flagged this as
  a runtime error, but that severity is NOT supported by actual evidence: the full run succeeds
  and the fixture encodes (255,255,0,255), correctly decoding to 65535. Make the blue argument
  explicitly 0 for a complete API call; do not claim an observed runtime failure.

These fixture gaps supplement the focused revision above; they do not undo the independently
verified exact base registration or the improved per-layer implementation.

## Original disposition: useful experiment, not yet accepted for full overlay production

This is a review-only proof; no live damage behavior or catalog changes are approved. Viewed native
before/after panels for home_1, home_8 and council_8, material preview for home_1, and enlarged scorch,
flood and scaffold crops. Scorch is restrained and flood stays visually low, but scaffolding and its
validation need correction before scaling the family.

## Required corrections

### 1. Build scaffold geometry in world coordinates

`tools/effects.py:repair_scaffold` forces one SCREEN y for all platform endpoints. Equal screen y
is not equal world z along a 2:1 isometric frontage. With ground foot z=0, platform z is
`foot_screen_y - platform_screen_y`. The delivered home_8 top platform heights are therefore
121, 131, 141, 133, 125 across the five posts — not level.

Use a selected actual facade plane and world-space i/j/z support coordinates. Give each platform
one world z and project every endpoint using the established projection. Keep poles/footings
inside the reserved footprint and founded on ground or a verified structural surface; LOW wall
pixels alone are not ground. Include real platform depth and believable braces. The current
"diagonal braces" interpolate identical platform y values, so they merely redraw horizontal rails.

Flood ceiling clipping is a good start, but `line_y = bottom - 9` is still a screen-space line,
not a common world-height water mark. Derive a low constant-z band from the verified surface map,
then let mud run downward in world space. No high-floor inundation or permanent flames.

### 2. Make the NORMAL validator reject disconnected supports

`check_all` checks scaffold metadata but never requires the rendered post pixels or the claimed
platform pixels to exist. Its disconnected-support counterexample calls a DIFFERENT custom check
(`f2`) instead of the normal validator. This is not a valid regression proof for delivered assets.

Independently ran `check_all(TMP/'ce2', verbose=False)` against the supplied disconnected-post
counterexample: it returned `[]` (no failures). The headline DAMAGE_PROOF_OK therefore overstates
support coverage.

Validate the actual emitted scaffold geometry and rendered component. Removing a post foot,
inserting a mid-post gap, detaching a platform, and changing one endpoint's world z must each fail
through the SAME ordinary validation entry point. For copied evidence, read the manifest from that
copy too, not the original EFFECTS directory. Compare only relevant invariants; do not accept a
counterexample merely because an unrelated check failed.

### 3. Match the legacy render exactly before claiming mask registration

The cottage mask probe uses seed 597353970, but the existing delivered legacy manifest supplies
`seed = tidehaven-founding-39146379`. `art/build.lua` derives the numeric seed with a base-131
mod-2147483647 fold plus tier*101. For home_1 the actual spec seed is **650124396**.

Use the stored manifest/build path rather than guessing. The independent pixel comparison confirms
232 probe/base differences. A mask contained within the base alpha does NOT prove surface/material
registration when plant/decor pixels differ. Match the cottage base pixels, or explicitly limit
proof to the exact pixels/surfaces whose provenance is verified.

### 4. Do not promote measured maximum-z pixels directly to catalog corrections

The reported maximum visible ROOF z is not a substitute for an attachment at the catalog's specific
world i/j, on an adequate receiving surface. Cylinder pixels use the helper's top z everywhere,
which the report acknowledges; that is not a per-pixel curved-surface depth measurement. Keep the
595/610 results as provisional measurements only. Validate a specific surface patch and its world
coordinates before proposing a complete i/j/z anchor, rather than changing z alone.

### 5. Correct material/depth mask visibility before trusting containment

The separate mask audit completed; its key findings were checked against the actual wrapper code:

- `mask_probe.lua` writes every layer's callback into ONE material image and ONE z image in
  drawing-call order. Actual sprite layers composite in layer order. A late lot/ground primitive
  can therefore replace a classification belonging to a visible building on a higher layer.
  Track material/depth per source layer, then composite using the actual layer stack and alpha.
- The report says texture/edge passes preserve material, but `L.px` outside a quad writes DECAL.
  `L.edge`, `L.stripe`, and `L.speckle` call that wrapped primitive and are not excluded. Preserve
  underlying surface class/depth for texture recolouring explicitly; distinguish true decals.
- Raw non-cylinder pixel/ellipse decorations may replace material classification without replacing
  or invalidating the existing z value. Keep classification, visibility and depth provenance
  synchronized; unknown depth must be explicit, not inherited from an obscured face.
- Blanket roof-helper classification cannot distinguish sloping roof faces from gable/shed wall
  infill. Classify the actual emitted surface role rather than the entire helper as ROOF.
- Cylinder pixels are all assigned its top z, including side/body/dome pixels. Do not call that a
  true per-pixel depth measurement or use it for receiving-surface attachment proof. Supply
  suitable geometry depth or mark curved surfaces unknown/excluded until supported.

Add synthetic regression fixtures: lower-layer geometry drawn AFTER a higher-layer wall must not
win final material/depth; texture recolour must not erase surface provenance; a true foreground
prop must hide it; known low/high wall samples must decode correctly. Run these through the normal
mask-generation/validation path. The superseded `_low` mask may remain clearly labelled diagnostic
output, but cannot supply height evidence.

These are correctness requirements for the small proof, not authorization to rewrite production
recipes or the shared art library. Keep fixes in its isolated instrumentation.

## Checks independently completed

- Existing `tools/check.py` exits 0, DAMAGE_PROOF_OK; caveat above reproduced independently.
- All nine effect generators independently re-executed in memory: exact RGBA pixels match the
  delivered components. This is effect repeat evidence only, not a full independent mask replay.
- Probe/base comparisons: home_8 and council_8 pixels exactly match delivered native renders;
  home_1 differs in 232 pixels. All three material masks have zero pixels outside delivered alpha.
- Current towers.lua/catalog MD5s match supplied report:
  `b00c33c01f95513aa3ab3ca0a947426f` / `06eecffa94a191265f54aeafde83a8b2`.
  No pre-proof all-files hash manifest was supplied, so "zero files outside proof touched" cannot
  be independently established from mtimes or current git status alone.

## Scope for revision

Keep all work under `art/generated/damage-proof/`; no source recipes/catalog/atlas/gameplay/save/
environment/dependency changes. Preserve a before-revision proof copy or hashes. Record an explicit
before/after external asset/source hash set, not only modification-time claims. Refresh masks,
components, compositions and closeups; run repeated fresh proof builds and common-entry-point
counterexamples. Do not start the full 360-overlay family yet. No commit or push.
