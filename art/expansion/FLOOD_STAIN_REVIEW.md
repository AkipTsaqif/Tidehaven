# Flood stain — independent review

## Disposition: accepted as component artwork; proceed to the next effect

All 60 entries remain draft. Nothing here is packaged, atlas-approved or wired into gameplay.

## Independently verified

- Exact-key isolation against before-flood-stain: 60 PNGs changed, every one a flood_stain key;
  1,296 others unchanged.
- Fresh `compose.py`: FLOOD_STAIN_OK. Fresh fire-scorch and storm-debris runs also pass.
- Height rule, measured by me through the ordinary composition path with a spy: 768 placed pieces
  across the 18 compositions, 4,547 wall-stain pixels, none above world z 24, none on unknown depth,
  none off WALL material; no ground pixel lacks verified support.
- Both validators are reached in the normal path; injecting a failure into either fails the run.
- Viewed the tall-tower composition, the cottage tide-line closeup and the severity ladder. The stain
  is deliberately low and subtle, a broken waterline with silt and a few ground patches. Severity
  reads as a wider, higher band and more ground silt.
- Fresh rebuild: 120 files (60 PNG + 60 metadata), no differences.
- Accepted damage proof and fixtures pass; art:test 164 assets; 996-image portable package intact.

## Corrections to the completion report

- **"Storm branch unchanged" is imprecise.** The flood work edited the shared storm helpers
  (`stormEnd`, `stormQuad` return value). I re-rendered all 60 storm sprites and their metadata from
  the pre-flood source: byte-identical to the current output. So storm artwork is unaffected, but the
  report's claim that only the flood branch changed is not literally true.
- **Verification was not clean on my first run.** `npm run verify` failed once on
  `runtime-regressions` ("keeps the committed hash identical after checkpoint and backup
  bookkeeping"), expecting `lastCheckpointDay` 1 and getting 2. It passed on three isolated reruns
  and on a full rerun (305 passed). It looks like a timing-sensitive flake unrelated to art, but it is
  real and worth investigating before relying on that test.
- The counterexample list is 10 validator cases plus 2 injected-failure tests, matching the report's
  "12" only if both kinds are counted.

## Limits to carry forward

- At 1x on a tall tower the stain is a small mark at the base. That follows the height rule but may
  be too subtle to read on large buildings; judge it in the real map before tuning.
- Placement is a review search, not the production rule. Masks carry no provenance sidecar.
- Cross-biome proof is one `home_4` per biome. The ground/wall split lives in metadata, not layers.
- Remaining draft effects: drought ground, outbreak sign and repair scaffold.
