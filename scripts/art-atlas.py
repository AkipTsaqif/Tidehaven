#!/usr/bin/env python
"""Pack legacy sprites and optional expansion assets into multi-page atlases. Requires Pillow.

python scripts/art-atlas.py [--source art/generated] [--out client/public/map]
                           [--extras art/generated/expansion] [--allow-draft]

Pages hold at most PAGE_WIDTH x MAX_HEIGHT pixels, so a biome whose art does not fit one page is split
over several. Frames are never resized. Frames of the 'overlay' class are trimmed to their opaque
bounding box (their canvases are mostly empty); the offset and full canvas size are recorded so the
pivot still means what it meant before trimming. Every other frame keeps its full canvas.
"""
import argparse
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SETS = [("eden", "tropical"), ("temperate", "temperate"), ("arid", "arid"), ("northern", "northern")]
PAGE_WIDTH, MAX_HEIGHT, PAD, MAX_PAGES = 1024, 4096, 2, 16
TRIM_CLASSES = {"overlay"}


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"invalid geometry: {value!r}")
    return value


def read_assets(manifests):
    """Validated assets in manifest order. No filesystem globbing."""
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
            assets.append({"key": key, "image": image, "pivot": pivot, "footprint": footprint,
                           "assetClass": item.get("assetClass", "building"), "status": item.get("status")})
    return assets


def trim_asset(asset):
    """Crop an overlay to its opaque bounding box. Returns (image, trim) where trim is None if untouched."""
    image = asset["image"]
    if asset["assetClass"] not in TRIM_CLASSES:
        return image, None
    box = image.getchannel("A").getbbox()
    if box is None:
        raise ValueError(f"{asset['key']}: overlay is fully transparent")
    if box == (0, 0, image.width, image.height):
        return image, None
    return image.crop(box), {"x": box[0], "y": box[1], "w": image.width, "h": image.height}


def pack_pages(assets):
    """Deterministic shelf packing into as many pages as needed.

    Returns (pages, frames) where pages is a list of PIL images and frames maps key -> v3 frame.
    Tall frames are placed first so shelves stay tight; transparent gutters stop sampling bleed.
    """
    prepared = []
    for asset in assets:
        image, trim = trim_asset(asset)
        if image.width + 2 * PAD > PAGE_WIDTH or image.height + 2 * PAD > MAX_HEIGHT:
            raise ValueError(f"{asset['key']}: {image.size} cannot fit a {PAGE_WIDTH}x{MAX_HEIGHT} page")
        prepared.append((asset, image, trim))
    prepared.sort(key=lambda p: (-p[1].height, -p[1].width, p[0]["key"]))

    placements = []          # (page index, image, x, y)
    heights = []             # used height per page
    frames = {}
    page, x, y, row_h = 0, PAD, PAD, 0
    for asset, image, trim in prepared:
        if x + image.width + PAD > PAGE_WIDTH:
            x, y, row_h = PAD, y + row_h + PAD * 2, 0
        if y + image.height + PAD > MAX_HEIGHT:
            heights.append(y + row_h + PAD)
            page, x, y, row_h = page + 1, PAD, PAD, 0
            if page >= MAX_PAGES:
                raise ValueError(f"atlas needs more than {MAX_PAGES} pages")
        frame = {"page": page, "rect": {"x": x, "y": y, "w": image.width, "h": image.height},
                 "pivot": asset["pivot"], "footprint": asset["footprint"], "assetClass": asset["assetClass"]}
        if trim:
            frame["trim"] = trim
        frames[asset["key"]] = frame
        placements.append((page, image, x, y))
        row_h = max(row_h, image.height)
        x += image.width + PAD * 2
    heights.append(y + row_h + PAD)

    pages = [Image.new("RGBA", (PAGE_WIDTH, height), (0, 0, 0, 0)) for height in heights]
    for number, image, px, py in placements:
        pages[number].paste(image, (px, py))   # no alpha mask: preserve RGBA bytes exactly
    return pages, frames


def write_pages(pages, directory, stem):
    """Save pages and return their v3 descriptors. Page 0 keeps the historic file name."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    described = []
    for number, sheet in enumerate(pages):
        name = f"{stem}.png" if number == 0 else f"{stem}-{number}.png"
        sheet.save(directory / name, optimize=True)
        described.append({"image": f"/map/{name}", "width": sheet.width, "height": sheet.height})
    return described


def remove_stale_pages(directory, stem, keep):
    """Delete extra pages from an earlier, larger run so no orphan image is left behind."""
    directory = Path(directory)
    for path in directory.glob(f"{stem}-*.png"):
        suffix = path.stem[len(stem) + 1:]
        if suffix.isdigit() and int(suffix) >= keep:
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "art/generated")
    parser.add_argument("--out", type=Path, default=ROOT / "client/public/map")
    parser.add_argument("--extras", type=Path)
    parser.add_argument("--allow-draft", action="store_true",
                        help="pack draft expansion art (for testing; never for the committed atlas)")
    args = parser.parse_args()
    index = {"version": 3, "tile": {"w": 32, "h": 16}, "biomes": {}}
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
            if not args.allow_draft and any(i.get("status") != "approved" for i in e["items"]):
                raise ValueError("draft expansion art cannot be packed into production")
            manifests.append(extra)
        pages, frames = pack_pages(read_assets(manifests))
        described = write_pages(pages, args.out, f"atlas-{biome}")
        remove_stale_pages(args.out, f"atlas-{biome}", len(pages))
        index["biomes"][biome] = {"pages": described, "frames": frames}
        print(f"{biome}: {len(frames)} frames on {len(pages)} page(s)")
    (args.out / "atlas.json").write_text(json.dumps(index, indent=1) + "\n")


if __name__ == "__main__":
    main()
