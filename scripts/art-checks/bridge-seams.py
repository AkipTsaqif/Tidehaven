#!/usr/bin/env python
"""Per-piece bridge endpoint sanity checks, driven by catalog geometry.

python scripts/art-checks/bridge-seams.py --biome tropical

Each PNG is sampled independently, not as an overlapping composite. Outline pixels do not count
as structural material. Samples are two world units inside each connection and allow one vertical
pixel of raster tolerance. These are occupancy checks, NOT proof of exact cross-section equality,
structural engineering, navigability or aesthetic approval. Construction is checked for support,
not an uninterrupted finished deck. Fails with a nonzero exit status.
"""
import argparse
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / 'art/expansion/catalog.json'
OUTLINE = (0x14, 0x16, 0x1C)
RAILS = {'timber_footbridge': (3, 13), 'timber_wagon': (2, 16),
         'stone_arch': (2, 16), 'stone_viaduct': (2, 16)}


class Piece:
    def __init__(self, path, entry):
        self.img = Image.open(path).convert('RGBA')
        self.px = self.img.load()
        a, d = entry['footprint']['i'] * 16, entry['footprint']['j'] * 16
        self.gx = entry['pivot']['x'] - a + d
        self.gy = entry['pivot']['y'] - (a + d) / 2
        self.axis = entry['orientation']
        self.deck_z = entry['deckZ']

    def solid(self, t, w, z):
        lat = (t - w) if self.axis == 'i' else (w - t)
        x = int(self.gx + lat)
        y = int((self.gy + (t + w) / 2 - z) // 1)
        for dy in (0, -1, 1):
            if 0 <= x < self.img.width and 0 <= y + dy < self.img.height:
                colour = self.px[x, y + dy]
                if colour[3] and colour[:3] != OUTLINE:
                    return True
        return False

    def band(self, t, w, zlo, zhi):
        return any(self.solid(t, w, z) for z in range(zlo, zhi + 1))

    def any_low(self):
        return any(self.band(t, w, 0, self.deck_z - 1)
                   for t in range(0, 33, 2) for w in range(0, 17, 2))

    def endpoint(self, t, rails):
        return (self.band(t, 8, self.deck_z, self.deck_z),
                tuple(self.band(t, w, self.deck_z + 1, self.deck_z + 4) for w in rails))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--biome', default='tropical', choices=['tropical', 'temperate', 'arid', 'northern'])
    parser.add_argument('--dir', type=Path, default=ROOT / 'art/generated/expansion')
    parser.add_argument('--catalog', type=Path, default=CATALOG)
    args = parser.parse_args()
    entries = {e['key']: e for e in json.loads(args.catalog.read_text())['entries'] if e['family'] == 'bridges'}
    fails = []
    for kind, rails in RAILS.items():
        for axis in ('i', 'j'):
            for state in ('intact', 'construction', 'damaged', 'rebuilding'):
                notes = []
                for a, b in (('far_bank', 'span'), ('span', 'near_bank')):
                    ea = entries[f'bridge_{kind}_{a}_{axis}_{state}']
                    eb = entries[f'bridge_{kind}_{b}_{axis}_{state}']
                    pa = Piece(args.dir / args.biome / f"{ea['key']}_{args.biome}.png", ea)
                    pb = Piece(args.dir / args.biome / f"{eb['key']}_{args.biome}.png", eb)
                    if ea['access'][-1]['z'] != eb['access'][0]['z']:
                        notes.append(f'{a}|{b}: incompatible metadata height')
                    ra, rb = pa.endpoint(30, rails), pb.endpoint(2, rails)
                    if state == 'construction':
                        if not pa.any_low() or not pb.any_low():
                            notes.append(f'{a}|{b}: no construction support')
                    elif not ra[0] or not rb[0] or not all(ra[1]) or not all(rb[1]):
                        notes.append(f'{a}|{b}: missing endpoint deck/rail {ra}/{rb}')
                print(f"{kind}/{axis}/{state}: {'FAIL ' + '; '.join(notes) if notes else 'PASS'}")
                if notes:
                    fails.append(f'{kind}/{axis}/{state}')
    if fails:
        print('SEAM_ENDPOINT_FAIL', fails)
        raise SystemExit(1)
    print('SEAM_ENDPOINT_OK: independent endpoint occupancy/support samples; 1px vertical tolerance, outline excluded.')


if __name__ == '__main__':
    main()
