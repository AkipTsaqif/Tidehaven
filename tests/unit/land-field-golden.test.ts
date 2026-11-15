import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IslandField } from '../../src/domain/geography/land-field.js';
import { buildTerrain, layoutTown } from '../../src/application/map-layout.js';

/**
 * Two kinds of fingerprint, because they change for different reasons.
 *
 * LAND_GOLDEN is the coastline itself (which tiles are sea or land, which lots are on land or shore).
 * Reclamation, scenery and every saved town depend on it: if it fails, every town's coastline just
 * changed. Never regenerate it casually.
 *
 * LAYOUT_GOLDEN is where buildings sit (lot spacing, the order candidates are tried) and the terrain
 * box drawn around them. It is presentation only: nothing saved depends on lot positions, so it may be
 * regenerated deliberately when the layout is intentionally retuned (say so in the commit).
 */
const LAND_GOLDEN: Record<string, string> = {
  'island:tidehaven-founding-39146379': '5f3b15829c38837214a044840d51db2e14e6024efe887b592aa4d605a6ff3b2e',
  'island:golden-a': '361f83bb7d3ccd90b7d2c8e58c252214bd4b8ec6e250e93c6bd0eeb3cf4f6d2f',
  'island:golden-b': '4fd954a31872b79bef6e28f878b29d66d1bebab0dfef543f65c26999a0fdc247',
  'coast:tidehaven-founding-39146379': 'e519097ccc5cb24e4e7c11a2353a5e6f0a6d5873c30e1f26ed8f9aaa7f3dd5de',
  'coast:golden-a': '743b1541bff601da6841d26f59ab8abe826a578f5dcb4d6698c8d9035eb462dd',
  'coast:golden-b': '07c84e1351c01c9dbad36f96271aa6569ce492b2004891ff5d6033b08548b0ba',
  'river_plain:tidehaven-founding-39146379': '89b5580a866295ee068c22f911ea990aa42ecd103df2f2d3cea99536753300c7',
  'river_plain:golden-a': 'e72c17ccb802a39744b9896c5c9848e7494895c16344ca86c24330abf8a7c1a2',
  'river_plain:golden-b': '8ea5b47527a1e0530193e6579c2d5e5197ba0b2e63058cdd9637d677c00b9cdd'
};

const LAYOUT_GOLDEN: Record<string, string> = {
  'island:tidehaven-founding-39146379': '082a11cffc5feb0e8d537533469aeed81b19549c124f05448174738ae2c6eca0',
  'island:golden-a': '95b6c1aac579a7726fab4f53149d1e9177894a32316b6c592f2deec1f941f228',
  'island:golden-b': '3761f1c32577dadac58d0ed2ad3f440ca0ed792176db6c76c5034863da598810',
  'coast:tidehaven-founding-39146379': '39e9619cbbb1efc42435188b6ddd69392bf76e1f331187737238442b5acf60b2',
  'coast:golden-a': '6b5a4b8c4eebd0091f591735800202dab2c3b78875c60713453e975a0d45a864',
  'coast:golden-b': '4a7c146e631e637ca78b13af14ea392bc3c7ab9605dd1cf768422d8b8b172d36',
  'river_plain:tidehaven-founding-39146379': 'c9955a4bcec5673551c90307a9bfa59835115ad668ea0bf6cb14c685af85fcb8',
  'river_plain:golden-a': 'de68c8caaf8fcd44eb58e7be0335f479b07dfb36db6156b44920669b868d4198',
  'river_plain:golden-b': '8b17fded9a8a1a9f39e90935577ab17e00f814c540d8c9d3b3165a98ca899de8'
};

type Terrain = 'island' | 'coast' | 'river_plain';

function landFingerprint(terrain: Terrain, seed: string): string {
  const field = new IslandField(seed, terrain);
  const hash = createHash('sha256');
  for (let y = -120; y <= 120; y += 1) {
    let row = '';
    for (let x = -120; x <= 120; x += 1) row += field.land(x, y) ? '1' : '0';
    hash.update(row);
  }
  for (let y = -60; y <= 60; y += 3) {
    for (let x = -60; x <= 60; x += 3) hash.update(`${field.lotIsLand(x, y)}${field.lotIsShore(x, y)}`);
  }
  return hash.digest('hex');
}

function layoutFingerprint(terrain: Terrain, seed: string): string {
  const hash = createHash('sha256');
  const buildings = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, placement: i % 9 === 0 ? 'shore' as const : 'land' as const }));
  const layout = layoutTown(seed, buildings, [1, 2, 3], terrain);
  hash.update(JSON.stringify(layout.lots));
  hash.update(JSON.stringify(buildTerrain(layout).rows));
  return hash.digest('hex');
}

describe('coastline golden fingerprints (must never change by accident)', () => {
  for (const [key, expected] of Object.entries(LAND_GOLDEN)) {
    it(`${key} coastline is unchanged`, () => {
      const [terrain, seed] = key.split(':') as [Terrain, string];
      expect(landFingerprint(terrain, seed)).toBe(expected);
    });
  }
});

describe('building layout golden fingerprints (regenerate only on a deliberate retune)', () => {
  for (const [key, expected] of Object.entries(LAYOUT_GOLDEN)) {
    it(`${key} layout is unchanged`, () => {
      const [terrain, seed] = key.split(':') as [Terrain, string];
      expect(layoutFingerprint(terrain, seed)).toBe(expected);
    });
  }
});

describe('domain geography layering', () => {
  it('imports nothing from application, storage, model, runtime or http', () => {
    const dir = 'src/domain/geography';
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const target of imports) {
        expect(target, `${file} imports ${target}`).not.toMatch(/application|storage|model|runtime|http/);
      }
    }
  });
});
