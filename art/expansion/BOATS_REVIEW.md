# General boats — integrator review

## Verdict
Visually acceptable as a general-boat asset set at the present catalog scale. No mandatory art revision
identified. Keep catalog draft until formal production packaging/integration; these are not yet owned
or operating boat entities in the simulator.

## Independent checks
- Opened all4tropical orientation/state montages at4x and the tropical water composition.
- Opened native48-identity grids for temperate,arid,northern; inspected arid sailboat comparison.
- Bow/heading, hull lighting, cargo state and damaged hull/sail changes read clearly.
- Inventory1356complete; family isolation192changed boat sprites and0outside boats vsbefore-boats.
- Rebuilt complete expansion inventory:192/192general boat PNG hashes match the prior delivered files.
- `npm run verify` with TMP/TEMP on D: passes302tests, typecheck, lint and production build.
- `npm run art:test` passes164legacy renders.

## Honest checker exception
`tools/boatcheck.py` passes tropical,temperate,northern but reports `cargo_barge_sw_damaged` in arid
removes7pixels, below its8pixel heuristic. This is a threshold exception, not a demonstrated art defect:
the damaged cover and changed hull remain visibly distinct. The model report's removal numbers were
explicitly tropical; do not generalize those ranges to every biome. No validation was weakened.

The review tool prints BOAT_CHECKS_FAIL without returning nonzero. Harden it before using it as a CI
gate; currently callers must inspect its output. Unique hashes prove distinct files, not correct
headings or aesthetics. Its horizontal span check is not full3D/world-footprint validation.

## Scale and style notes
Rowboat/skiff are small but consistent across headings within their2x1reservation. Do not enlarge the
reservation until comparing actual map/berth scale and fishing boats. Biomes mainly differ in paint,
cover/pennant/accent palette, which is suitable for boats made of shared timber and cloth.

## Follow-on
Fishing boats are the next isolated artist task, followed by water details. Preserve the approved
stone deckz10/timberz6bridge contract, all other recipes and the general boats during those tasks.
Atlas paging, ownership/berths, catches and production integration remain integrator work.
