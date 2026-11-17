#!/usr/bin/env python
"""Check expansion inventory and make per-kind comparison sheets, or take/compare pixel snapshots.
python scripts/art-expansion-review.py sheets --family towers
python scripts/art-expansion-review.py snapshot before-bridges
python scripts/art-expansion-review.py diff before-bridges --family bridges
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / 'art/generated/expansion'
REVIEW = ROOT / 'art/generated/expansion-review'
BIOMES = ['tropical', 'temperate', 'arid', 'northern']


def inventory():
    catalog = json.loads((ROOT / 'art/expansion/catalog.json').read_text())
    wanted = {e['key']: e for e in catalog['entries']}
    sets = {}
    for biome in BIOMES:
        m = json.loads((GEN / biome / 'manifest.json').read_text())
        actual = {e['key']: e for e in m['items']}
        if len(actual) != len(m['items']) or set(actual) != set(wanted):
            raise ValueError(f'{biome}: incomplete/duplicate inventory; rebuild all entries')
        for e in actual.values():
            image = Image.open(GEN / biome / e['png'])
            if image.size != (e['width'], e['height']):
                raise ValueError(f"wrong size {e['key']}")
            if not (GEN / biome / e['source']).is_file():
                raise ValueError(f"missing editable source {e['key']}")
        sets[biome] = actual
    return wanted, sets


def hashes(sets):
    return {f'{biome}/{key}': hashlib.sha256((GEN / biome / e['png']).read_bytes()).hexdigest()
            for biome, entries in sets.items() for key, e in entries.items()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['sheets', 'snapshot', 'diff'])
    p.add_argument('name', nargs='?', default='baseline')
    p.add_argument('--family', default='all')
    args = p.parse_args()
    wanted, sets = inventory()
    REVIEW.mkdir(parents=True, exist_ok=True)
    if args.action == 'snapshot':
        (REVIEW / f'{args.name}.json').write_text(json.dumps(hashes(sets), indent=1))
        print('saved', len(wanted) * 4, 'hashes')
    elif args.action == 'diff':
        before = json.loads((REVIEW / f'{args.name}.json').read_text())
        after = hashes(sets)
        changed = [key for key in after if before.get(key) != after[key]]
        outside = [key for key in changed if wanted[key.split('/', 1)[1]]['family'] != args.family]
        for key in changed:
            print('CHANGED', key)
        if outside:
            raise ValueError(f'{len(outside)} sprites outside {args.family} changed')
        print('OK family isolation;', len(changed), 'changed sprites')
    else:
        # Each sheet is one identity across all biomes at true1x (large towers never squeezed down).
        for key, e in wanted.items():
            if args.family != 'all' and e['family'] != args.family:
                continue
            images = [Image.open(GEN / b / sets[b][key]['png']).convert('RGBA') for b in BIOMES]
            w, h = e['width'], e['height']
            sheet = Image.new('RGB', (4 * (w + 8), h + 26), (30, 38, 46))
            draw = ImageDraw.Draw(sheet)
            for n, (biome, image) in enumerate(zip(BIOMES, images)):
                x = n * (w + 8)
                sheet.paste(image, (x, 24), image)
                draw.text((x + 2, 4), biome, fill='white')
            path = REVIEW / f'{key}.png'
            sheet.save(path)
            print(path)
    print('INVENTORY_OK', len(wanted) * len(sets))


if __name__ == '__main__':
    main()
