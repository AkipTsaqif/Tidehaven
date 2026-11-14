#!/usr/bin/env python
"""Pack the generated building sprites into per-biome atlases for the dashboard Map tab.

  python scripts/art-review.py build     # (re)generate art/generated/<set>/ with Aseprite first
  python scripts/art-atlas.py            # write client/public/map/atlas-<biome>.png + atlas.json

The atlas is committed, so the app never needs Aseprite. Sprites keep their exact 96x104 cells and
pivots; each biome is one 9-column PNG (nearest-neighbour, no resampling). Needs Pillow.
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "art" / "generated"
OUT = ROOT / "client" / "public" / "map"
SETS = [("eden", "tropical"), ("temperate", "temperate"), ("arid", "arid"), ("northern", "northern")]
COLS = 9
W, H = 96, 104


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    index = {"version": 1, "tileWidth": 32, "tileHeight": 16, "cell": {"w": W, "h": H},
             "pivot": {"x": 48, "y": 104}, "footprint": {"i": 3, "j": 3}, "biomes": {}}
    for dirname, biome in SETS:
        manifest = json.loads((GEN / dirname / "manifest.json").read_text())
        items = manifest["items"]
        if len(items) != 41 or manifest["biome"] != biome:
            sys.exit(f"{dirname}: expected 41 {biome} sprites; run python scripts/art-review.py build")
        rows = (len(items) + COLS - 1) // COLS
        sheet = Image.new("RGBA", (COLS * W, rows * H), (0, 0, 0, 0))
        frames = {}
        for n, item in enumerate(items):
            sprite = Image.open(GEN / dirname / item["png"]).convert("RGBA")
            if sprite.size != (W, H):
                sys.exit(f"{item['id']}: size {sprite.size}")
            x, y = (n % COLS) * W, (n // COLS) * H
            sheet.paste(sprite, (x, y))
            frames[f"{item['kind']}_{item['tier']}"] = {"x": x, "y": y}
        path = OUT / f"atlas-{biome}.png"
        sheet.save(path, optimize=True)
        index["biomes"][biome] = {"image": f"/map/atlas-{biome}.png", "frames": frames}
        print(f"{path.relative_to(ROOT)}  {sheet.size[0]}x{sheet.size[1]}  {len(frames)} sprites")
    (OUT / "atlas.json").write_text(json.dumps(index, indent=1) + "\n")
    print(f"{(OUT / 'atlas.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
