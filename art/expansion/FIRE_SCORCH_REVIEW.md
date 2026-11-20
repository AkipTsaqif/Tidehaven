# Fire scorch — independent review

## Current disposition: revision accepted as component artwork; proceed to storm debris

This supersedes the original verification request below. All60 entries remain draft; no gameplay,
production atlas or portable package approval is implied by this review.

### Independent revision verification

- Viewed new temperate/arid severe and northern moderate native before/after compositions.
  Soot/char remains recognizable and building identity retained; no required redraw.
- Decoded each new biome mask probe base and compared to delivered base RGBA: all3 exact matches.
- Read the shared class/known-depth validator used by ordinary composed layers and leak fixtures.
  Independently exercised known-depth control, UNKNOWN-depth failure and opaque-corner rejection.
- Fresh compose.py: FIRE_SCORCH_OK; all18 compositions, all20 biome/size severity ladders,
  transparency/leak tests pass. Fresh rerender yields 60/60 matching scorch hashes.
- Re-examined full pre-fire snapshot: exactly60scorch changed,1296other expansion PNGs unchanged.
- Recipe byte-identical to source-baseline/damage.pre-rev1.lua: revision changed verification only.
- Fresh verify:305tests, all gates passed. Fresh legacy art:test:164 assets validated across4biomes.
- Accepted proof DAMAGE_PROOF_OK and FIXTURES_OK.

### Limits to carry into integration

- Vertical content-maximizing offset is review-only, NOT production attachment selection.
- Non-tropical composition coverage is one home4 per biome, not every building/function.
- Spot-like darkest clusters are an accepted stylistic limitation at current native scale.
- Generated validation utility has minor CLI/coverage limitations: --rerender flag is parsed but
  main always rerenders; absolute --dir outside repository can fail relative_to(ROOT); repeat
  hash enumeration lists expected keys rather than independently rejecting extra repeat files.
  Delivered-side exact-set checking and independently successful catalog-driven rerender establish
  this batch's60expected files. Fix these utilities before promoting them as release tooling.
- Debug/proof outputs remain under ignored art/generated/. This review does not commit or push
  any files or add scorch PNGs to the996-image portable package.

## Original disposition: component art provisionally acceptable; focused verification completion required

Viewed native cottage severe before/after, enlarged cottage/tower severe details, civic moderate
before/after, short-frame severity ladder and four-biome megatall severe sheet. Marks read as char/
soot without flames. The darkest clusters are somewhat spot-like; future refinement can follow real
window/eave sources, but no wholesale redraw is requested. Content-maximizing offset search is
review-only and cannot become the production attachment rule.

## Independent checks completed

- All 1,356 baseline hashes examined: exactly 60 fire_scorch PNGs changed, 1,296 others unchanged.
- All 996 packaged reviewed non-damage PNGs still match current generated output.
- Fresh separate damage-family rerender: 60/60 scorch PNGs byte-identical to delivered output.
- Independently checked area and vertical reach progression PER BIOME and size, not only means:
  all 20 biome/size ladders monotone. All four corners transparent on every delivered image.
- Fresh verify: 305 tests passed; all typecheck/lint/build gates passed.
- Fresh legacy art:test: 164 assets validated; repeat pixels identical.
- Accepted proof validator DAMAGE_PROOF_OK and fixtures FIXTURES_OK.
- Source diff limited to damage.lua; other effects' rendered pixels unchanged.

## Required completion

1. Supply the requested non-tropical review compositions: matching base artwork AND verified target
   masks for temperate, arid and northern. Reporting UNSUPPORTED is honest and preferable to fake
   masks, but it does not complete the assigned cross-biome acceptance requirement. Use isolated
   copies/parameterized runs of accepted mask tooling under art/generated/fire-scorch; do not edit
   accepted proof baselines. One representative building per additional biome, all three severities,
   is enough. Show native before/after and enlarged details; preserve identity and mask containment.

2. Make validation inspect DELIVERED outputs by default, with an explicit directory parameter for
   copied fixtures/repeat output. compose.py currently reads expansion-scratch for its component
   checks/compositions, while its repeat section only compares existing files (does not itself
   rerender and does not require exact count60). Document a fresh rerender command and require
   exact60 key coverage on both sides; missing/extra identities fail closed.

3. Correct transparency validation: `alpha not in (0,255)` accepts an OPAQUE corner. Require alpha0
   at all four corners and verify alpha outside the allowed component envelope. Use a copied opaque
   corner fixture and assert its intended transparency failure rather than an unrelated reach error.

4. Add a shared composed-layer validator for class AND known depth. Use it for every delivered
   clipped layer and the deliberately leaked component. The current leak counterexample performs
   a standalone scan, while ordinary composition checks only require kept>0; this is the same
   divergent-validator pattern rejected in the attachment proof. Require failures for OTHER/ground
   leakage AND UNKNOWN-depth roof/wall leakage through the same normal validation entry point.

5. Keep progression checks per biome/size in the tool, not only biome averages. Existing delivered
   images already pass the stronger independent checks, so this is validation hardening, not a
   demand to alter artwork merely to make tests exercise changes.

## Revision scope

Preserve before-fire-scorch and a current pre-revision snapshot/source copy before any artwork edit.
Only fire-specific recipe code may change if a genuine visual correction is needed. Prefer generated
review-tool/mask/composition changes for these verification items. No other damage branches, shared
libraries, accepted proof baselines, catalog, packaged assets, atlas, gameplay, saves, environment,
dependencies, commits or pushes. Recheck exact-key isolation and fresh repeats after any recipe edit.

All60 remain draft and are NOT added to the portable package or live atlas by this review. Stop before
storm debris until the cross-biome compositions and shared validation pass.
