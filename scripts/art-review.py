#!/usr/bin/env python
"""Review helper for sprite-family redesigns. Needs local Aseprite (via art-build.mjs) and Pillow.

  python scripts/art-review.py build                       # rebuild all four biome sets (164 sprites)
  python scripts/art-review.py snapshot before-production  # remember current PNG hashes
  python scripts/art-review.py diff before-production --kinds farm,fishery,bakery,timber_camp
  python scripts/art-review.py sheet production --kinds farm,fishery,bakery,timber_camp

`diff` fails if any sprite OUTSIDE --kinds changed (protects other families) and warns about
requested kinds that did not change at all. Output goes to art/generated/review/ (git-ignored).
Never touches data/, scenarios/ or saved towns.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "art" / "generated"
REVIEW = GEN / "review"
SNAPSHOTS = REVIEW / "snapshots"
SEED = "tidehaven-founding-39146379"
SETS = [  # (directory, biome, art-build.mjs arguments)
    ("eden", "tropical", ["--scenario", "eden"]),
    ("temperate", "temperate", ["--scenario", "tidehaven", "--biome", "temperate"]),
    ("arid", "arid", ["--scenario", "tidehaven", "--biome", "arid"]),
    ("northern", "northern", ["--scenario", "tidehaven", "--biome", "northern"]),
]
SPECIALS = ["camp", "home_site", "development_site", "development_abandoned", "destroyed"]
ALL_KINDS = ["home", "farm", "fishery", "bakery", "timber_camp", "workshop", "shop", "clinic",
             "guard_house", "court", "council", "public_works"]


def manifest(dirname):
    path = GEN / dirname / "manifest.json"
    if not path.exists():
        sys.exit(f"missing {path}; run: python scripts/art-review.py build")
    data = json.loads(path.read_text())
    if len(data["items"]) != 41:
        sys.exit(f"{path} lists {len(data['items'])} items, expected 41; rerun the full build")
    return data


def build(_args):
    for dirname, biome, extra in SETS:
        cmd = ["node", "scripts/art-build.mjs", *extra, "--seed", SEED, "--out", f"art/generated/{dirname}"]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            sys.stdout.write(r.stdout[-4000:])
            sys.stderr.write(r.stderr[-4000:])
            sys.exit(f"FAILED building {biome}")
        print(f"built {biome}: {r.stdout.strip().splitlines()[-1]}")


def hashes():
    out = {}
    for dirname, _, _ in SETS:
        for item in manifest(dirname)["items"]:
            out[item["id"]] = hashlib.sha256((GEN / dirname / item["png"]).read_bytes()).hexdigest()
    return out


def snapshot(args):
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    (SNAPSHOTS / f"{args.name}.json").write_text(json.dumps(hashes(), indent=1))
    print(f"snapshot {args.name}: 164 sprite hashes saved")


def kind_of(sprite_id):
    for kind in sorted(ALL_KINDS + SPECIALS, key=len, reverse=True):
        if sprite_id.startswith(kind + "_"):
            return kind
    return sprite_id


def diff(args):
    allowed = set(args.kinds.split(","))
    before = json.loads((SNAPSHOTS / f"{args.name}.json").read_text())
    now = hashes()
    changed = sorted(i for i in now if before.get(i) != now[i])
    outside = [i for i in changed if kind_of(i) not in allowed]
    unchanged = sorted(i for i in now if kind_of(i) in allowed and i not in changed)
    print(f"changed: {len(changed)} sprites")
    for i in changed:
        print("  " + i)
    if unchanged:
        print(f"WARNING {len(unchanged)} requested sprites are byte-identical to before:")
        for i in unchanged:
            print("  " + i)
    if outside:
        print("FAIL sprites outside the allowed family changed:")
        for i in outside:
            print("  " + i)
        sys.exit(1)
    print("OK no sprite outside the family changed")


def sheet(args):
    from PIL import Image, ImageDraw
    kinds = args.kinds.split(",")
    REVIEW.mkdir(parents=True, exist_ok=True)
    bg, cell_bg = (34, 36, 42), (48, 50, 58)
    sets = [(d, b, {(i["kind"], i["tier"]): i for i in manifest(d)["items"]}) for d, b, _ in SETS]
    written = []
    # 1) one sheet per kind: biome rows x tier columns, 2x nearest-neighbour.
    for kind in kinds:
        tiers = [1] if kind in SPECIALS else [1, 2, 3]
        cw, ch, lab = 192, 208, 90
        img = Image.new("RGB", (lab + len(tiers) * (cw + 6) + 6, 24 + len(sets) * (ch + 6) + 6), bg)
        d = ImageDraw.Draw(img)
        d.text((6, 6), kind, fill=(240, 200, 90))
        for c, t in enumerate(tiers):
            d.text((lab + c * (cw + 6) + 4, 6), f"tier {t}", fill=(200, 200, 210))
        for r, (dirname, biome, items) in enumerate(sets):
            y = 24 + r * (ch + 6)
            d.text((6, y + 6), biome, fill=(220, 220, 230))
            for c, t in enumerate(tiers):
                x = lab + c * (cw + 6)
                d.rectangle([x, y, x + cw - 1, y + ch - 1], fill=cell_bg)
                spr = Image.open(GEN / dirname / items[(kind, t)]["png"]).convert("RGBA")
                spr = spr.resize((cw, ch), Image.NEAREST)
                img.paste(spr, (x, y), spr)
        path = REVIEW / f"{args.family}-{kind}.png"
        img.save(path)
        written.append(path)
    # 2) every tropical sprite at true 1x size: readability and cross-family distinctness check.
    _, _, trop = sets[0]
    order = [(k, t) for k in ALL_KINDS for t in (1, 2, 3)] + [(k, 1) for k in SPECIALS]
    cols = 9
    rows = (len(order) + cols - 1) // cols
    img = Image.new("RGB", (cols * 100 + 4, rows * 116 + 4), bg)
    d = ImageDraw.Draw(img)
    for n, key in enumerate(order):
        x, y = 4 + (n % cols) * 100, 4 + (n // cols) * 116
        spr = Image.open(GEN / "eden" / trop[key]["png"]).convert("RGBA")
        img.paste(spr, (x, y), spr)
        if key[0] in kinds:
            d.rectangle([x - 2, y - 2, x + 97, y + 105], outline=(240, 200, 90))
        d.text((x, y + 104), f"{key[0][:11]} {key[1]}", fill=(170, 170, 180))
    path = REVIEW / f"{args.family}-all-tropical-1x.png"
    img.save(path)
    written.append(path)
    for p in written:
        print(p)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build").set_defaults(fn=build)
    s = sub.add_parser("snapshot"); s.add_argument("name"); s.set_defaults(fn=snapshot)
    s = sub.add_parser("diff"); s.add_argument("name"); s.add_argument("--kinds", required=True); s.set_defaults(fn=diff)
    s = sub.add_parser("sheet"); s.add_argument("family"); s.add_argument("--kinds", required=True); s.set_defaults(fn=sheet)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
