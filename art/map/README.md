# Map art

Original pixel art for the town map. 2:1 isometric, base tile 32×16, crisp pixels (no smoothing).

- `eden-mockup.lua` — draws the tropical Eden sample scene from code. Every random choice is seeded,
  so it rebuilds identically.
- `eden-mockup.aseprite` — the generated, editable Aseprite file.
- `eden-mockup.png` (1×) and `eden-mockup-4x.png` — exported previews.
- `previews/` — review snapshots (`zoom-levels.png` shows ½×, 1× and 2× side by side).

Rebuild: `bash art/map/render.sh` (needs Aseprite; set `ASEPRITE_PATH` if it is not at the Steam path).

Palette: about 40 colours, light from the top-left — left faces lit, right faces shaded, soft dithered
ground shadow to the bottom-right. Placement follows Miniville's ideas (see `docs/MAP.md` once
written); no Miniville art is used.
