# Fishing boats — integrator review

## Verdict
Visually acceptable at the current catalog scale; no mandatory redraw identified. All entries remain
draft until production packaging/gameplay integration. This review does not activate catches, ownership
or boat placement, and does not claim every procedural geometry check is a full footprint proof.

## Independent evidence
- Viewed the three tropical four-heading/three-state montages at4x.
- Viewed native36identity grids for temperate, arid and northern over water backgrounds.
- Canoe vs net boat reads through hull/gear; fishing sailboat's gaff silhouette differs from the
  triangular general coastal sailboat. Damaged rigging/net/hull changes are readable.
- Loaded states are small but fish crates visible enlarged; do not increase the reserved footprint
  solely to make a thumbnail look larger. Reassess at actual map/berth scale on integration.
- Family isolation:144changed PNGs, zero outside fishing compared with before-fishing.
- Rebuilt complete inventory:144/144delivered fishing PNG hashes identical.
- fishcheck.py passes all4biomes with exit0 and no heuristic exceptions.
- verify passes302tests, lint/typechecks/production build (TMP/TEMP on D:).
- art:test passes all164legacy renders.

## Limitations
- Palette-led biome variants are intentional; not four independent vessel cultures/designs.
- Horizontal-span probes are not full world-space hull/gear-footprint validation.
- Local-frame helpers contain harmless duplicated/dead intermediate variables (e.g. fishCrate's unused
  inner mask). Not a visual blocker; no unrelated refactor requested.
- Keep water-school sprites separate from these loaded-fish/gear drawings. They are decorative water
  markers and must never create inventory or duplicate production.

## Next artist task
Only art/expansion/families/water.lua:12identities per biome,48total (fish_school,fish_shadow,ripples,
net_floats ×3variants). Preserve all bridge/general-boat/fishing pixels and metadata.
