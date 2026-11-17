#!/usr/bin/env python
"""Pack legacy sprites and optional expansion assets without resizing. Requires Pillow.
python scripts/art-atlas.py [--source art/generated] [--out client/public/map]
                           [--extras art/generated/expansion]
"""
import argparse
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SETS = [("eden", "tropical"), ("temperate", "temperate"), ("arid", "arid"), ("northern", "northern")]
PAGE_WIDTH, MAX_HEIGHT, PAD = 1024, 4096, 2


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"invalid geometry: {value!r}")
    return value


def pack_set(manifests, output):
    """Returns v2 frames; caller owns destination and manifest inventory. No filesystem globbing."""
    if isinstance(manifests, (str, Path)):
        manifests = [manifests]
    assets, keys = [], set()
    for path in manifests:
        path = Path(path)
        manifest = json.loads(path.read_text())
        for item in manifest["items"]:
            key = item.get("key", f"{item['kind']}_{item['tier']}")
            if key in keys:
                raise ValueError(f"duplicate frame: {key}")
            keys.add(key)
            w, h = integer(item["width"], 1, 1020), integer(item["height"], 1, 1024)
            pivot = {"x": integer(item["pivot"]["x"], 0, w), "y": integer(item["pivot"]["y"], 0, h)}
            footprint = {"w": integer(item["footprint"]["i"], 1, 16), "d": integer(item["footprint"]["j"], 1, 16)}
            source = (path.parent / item["png"]).resolve()
            if not source.is_relative_to(path.parent.resolve()):
                raise ValueError("asset path escapes manifest directory")
            image = Image.open(source).convert("RGBA")
            if image.size != (w, h):
                raise ValueError(f"{key}: image does not match manifest")
            assets.append((key, image, pivot, footprint, item.get("assetClass", "building")))
    # Deterministic shelves; transparent gutters and nearest-only rendering avoid frame bleed.
    assets.sort(key=lambda a: (-a[1].height, -a[1].width, a[0]))
    frames, positioned, x, y, row_h = {}, [], PAD, PAD, 0
    for key, image, pivot, footprint, asset_class in assets:
        if x + image.width + PAD > PAGE_WIDTH:
            x, y, row_h = PAD, y + row_h + PAD * 2, 0
        if y + image.height + PAD > MAX_HEIGHT:
            raise ValueError("atlas exceeds 4096px; pack smaller family batches")
        frames[key] = {"rect": {"x": x, "y": y, "w": image.width, "h": image.height},
                       "pivot": pivot, "footprint": footprint, "assetClass": asset_class}
        positioned.append((image, x, y))
        row_h = max(row_h, image.height)
        x += image.width + PAD * 2
    sheet = Image.new("RGBA", (PAGE_WIDTH, y + row_h + PAD), (0, 0, 0, 0))
    for image, x, y in positioned:
        sheet.paste(image, (x, y))  # no alpha mask: preserve RGBA bytes exactly
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, optimize=True)
    return frames


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "art/generated")
    parser.add_argument("--out", type=Path, default=ROOT / "client/public/map")
    parser.add_argument("--extras", type=Path)
    args = parser.parse_args()
    index = {"version": 2, "tile": {"w": 32, "h": 16}, "biomes": {}}
    for dirname, biome in SETS:
        primary = args.source / dirname / "manifest.json"
        m = json.loads(primary.read_text())
        if len(m["items"]) != 41 or m["biome"] != biome:
            raise ValueError(f"{dirname}: rebuild complete legacy set first")
        manifests = [primary]
        if args.extras:
            extra = args.extras / biome / "manifest.json"
            e = json.loads(extra.read_text())
            if e["biome"] != biome:
                raise ValueError("extra biome mismatch")
            if any(i.get("status") != "approved" for i in e["items"]):
                raise ValueError("draft expansion art cannot be packed into production")
            manifests.append(extra)
        frames = pack_set(manifests, args.out / f"atlas-{biome}.png")
        index["biomes"][biome] = {"image": f"/map/atlas-{biome}.png", "frames": frames}
        print(f"{biome}: {len(frames)} frames")
    (args.out / "atlas.json").write_text(json.dumps(index, indent=1) + "\n")


if __name__ == "__main__":
    main()
