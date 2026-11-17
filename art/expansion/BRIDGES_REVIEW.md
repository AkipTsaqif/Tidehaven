# Bridge artist review — not production approved

## Taller-stone revision — current disposition
User approved taller stone bridges. This section supersedes the low-deck limitations below.

- Stone arch and viaduct walking decks now use z10, soffits z9, taller openings and matching piers.
- Stone bank pieces have five2px stair drops to ground-level landings. Span connections are z10;
  bank landings are z0; support-only piers have no walkable access and record supportTopZ9.
- Timber remains z6. All256timber PNGs match the pre-change hashes exactly.
- Existing canvas/footprint/pivots/IDs unchanged. Exactly256stone PNGs changed; none outside bridges.
- Full1356draft inventory rebuilt twice with identical repeat hashes.
- Catalog-driven `scripts/art-checks/bridge-seams.py` passes in all4biomes. It exits nonzero on failure;
  a synthetic regression test confirms a missing endpoint makes it fail. Tolerant occupancy remains
  only a sanity check, not complete cross-section/navigability/aesthetic proof.
- `npm run verify`:302tests, lint/typecheck/build pass. `npm run art:test`:164legacy renders pass.
- Visual review: new arch opening/piers visibly read beneath the raised deck; intact/construction/
  damaged/rebuilding and both axes viewed in `art/samples/taller-stone-bridges.png`.
- Gameplay remains pending. A crossing must choose one consistent style/height; mixed timber/stone
  chains require separate transition modules (not supplied). Catalog still draft; no live atlas or
  save/gameplay state changed by this revision.


## Revision 2 disposition (supersedes the original findings below)
Integrator opened the revised stone arch/viaduct intact and damaged close-ups, timber near/far-bank
comparison and assembled j-axis montage. Verified source mirroring fixes and independently ran
seamcheck.py for all four biomes: every combination reported PASS. Full verify passes298tests on D:.

- FIXED: unmirrored far-bank deck, seams and coping, double-mirrored strips, reversed rope runs.
- IMPROVED: timber bank handrails now join the spans; revised damaged stone spans have visibly missing
  deck/parapet geometry, not only recoloured cracks.
- ACCEPTABLE FOR CURRENT LOW-DECK KIT: timber visual direction and stone state separation.
- STILL PENDING DESIGN DECISION: deckZ6 yields very shallow stone openings. Taller visually legible
  arch/viaduct assets need an integrator-approved style-specific deckZ10 contract, matching bank
  stairs/piers/access metadata and no mixed-height module chains.
- NOT YET LIVE/PRODUCTION APPROVED: catalog status remains draft; crossing mechanics and bank landing
  endpoint heights are unresolved. No blanket aesthetic approval of every512frame is claimed.

The per-piece seam tool samples structural occupancy at t2/t30 with a vertical1px window; it does
not prove exact whole-cross-section equality. Construction is checked for support, not finished
handrail continuity. Its failure message currently does not set a nonzero process status; automation
must inspect FAIL/SEAM_ENDPOINT_FAIL explicitly or harden that tool before using it as a gate.


## Verified by integrator
- Complete inventory:1356expansion entries; bridges512changed and0outside family relative to before-bridges.
- All128bridge identities per biome have unique PNG hashes. This proves file distinctness, not visual distinctness.
- `npm run verify` with TMP/TEMP on D: passes298tests, typechecks, lint and production build.
- `npm run art:test` passes all164legacy asset renders.
- Actual image review:32tropical identities per state (intact/construction/damaged/rebuilding),
  enlarged spans and representative four-biome sheets, plus modular montages/closeups.
- No production approval status changed. No gameplay integration or saved-town changes made.

## Verdict
Useful bridge family implementation, but final aesthetic approval is withheld pending targeted revision.
Timber bridges read clearly. Stone arch/viaduct are too slab-like at1x; their openings do not read well
at4x either. Stone intact vs damaged spans are visually weak despite different hashes.

## Required revisions
1. Make arch vs viaduct identifiable from silhouette/openings at native scale. Existing deckZ6 is a genuine
   geometry constraint, not the artist's fault. Do not secretly change it. First improve lower masonry
   silhouette and contrast within the current envelope; if still not readable, integrator/user must approve
   a taller, style-specific deck contract with matching bank transitions and routing metadata.
2. Stone damage must show an actual broken/missing parapet bay or visibly lost masonry. Current
   spanStone draws the full parapet first, then paints a dark stripe over it. For tropical i-span,
   stone_arch changes54of951opaque pixels and stone_viaduct35of940, but neither removes any opaque
   pixels. Do not equate dark recolouring with missing geometry.
3. Correct the report's seam coverage. tools/montage.py checks alpha continuity ONLY for intact and
   rebuilding, not construction/damaged (the latter intentionally have gaps). Its solid_near test is
   tolerant ±pixel neighbourhood occupancy, not an exact material/deck/rail cross-section proof.
   State this accurately; add explicit cross-section/endpoint checks for all pieces where appropriate.
4. Current bridge biomes mostly share WOOD/CONCRETE colours and differ by a tiny coping tuft. This is
   okay for structurally shared materials, but don't describe them as four strongly biome-tinted sets.

## Additional contract review (verified against recipe)
5. **Far-bank mirroring defect:** `bank()` mirrors boxes through its `bx` wrapper, but calls
   `deckSlab` and `plankSeams` with raw0..22coordinates in both stone and timber branches. The far-bank
   deck should lie at10..32. Mirror the complete deck/texture/coping geometry consistently, preserving
   world-face lighting. Also remove the double-mirroring of `pa,pb` passed to `strip` (which mirrors again).
6. **Bank endpoint metadata needs integrator reconciliation:** the stairs descend to ground at the land
   end, but every catalog access point advertises z6. Do not have an artist quietly change catalog.json.
   Define the actual landing/walkway endpoint heights and verify ramp/stair traversal before integration.

A reviewer also suspected missing seed injection. That finding is **not a supported normal-workflow bug**:
`scripts/art-expansion.mjs` explicitly adds the validated numeric seed to each job entry. The documented
build path supplies `s.seed` correctly. Directly inventing a job without the wrapper is outside that contract.

## Tool/environment note
The artist honestly stated that images were unavailable to its model. Text occupancy/lint checks do
not replace aesthetic review. The reported disk-pressure test failures are explained by C: having
less than5GiB free; use TMP/TEMP D:/tmp-tidehaven-tests without weakening the guard.

## Follow-on
The other five family files remain draft starters. Their production may proceed independently, but
keep bridges draft until the above visual/report fixes have been reviewed. Atlas paging is a separate
integrator task; never shrink or omit sprites to fit the current1024x4096cap.
