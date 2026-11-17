import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

type Access = {
  i: number;
  j: number;
  z: number;
  w?: number;
  t?: number;
  localT?: number;
};

type Bridge = {
  key: string;
  family: string;
  kind: string;
  footprint: { i: number; j: number };
  width: number;
  height: number;
  pivot: { x: number; y: number };
  assetClass: string;
  status: string;
  orientation: 'i' | 'j';
  part: 'near_bank' | 'span' | 'far_bank' | 'pier';
  visualState: string;
  deckZ: number;
  access: Access[];
  supportTopZ?: number;
};

const catalog = JSON.parse(
  readFileSync(new URL('../../art/expansion/catalog.json', import.meta.url), 'utf8'),
) as { biomes: string[]; entries: Bridge[] };

const bridgeKinds = ['timber_footbridge', 'timber_wagon', 'stone_arch', 'stone_viaduct'] as const;
const parts = ['near_bank', 'span', 'far_bank', 'pier'] as const;
const visualStates = ['intact', 'construction', 'damaged', 'rebuilding'] as const;

const bridgeEntries = catalog.entries.filter((entry) => entry.family === 'bridges');
const stoneKinds = new Set(['stone_arch', 'stone_viaduct']);

function identity(entry: Bridge): string {
  return `${entry.kind}/${entry.orientation}/${entry.part}/${entry.visualState}`;
}

function expectedAccess(entry: Bridge): { i: number; j: number; z: number }[] {
  const endpoints = entry.orientation === 'i' ? [{ i: 0, j: 8 }, { i: 32, j: 8 }] : [{ i: 8, j: 0 }, { i: 8, j: 32 }];
  const crossing = entry.part !== 'pier';
  const z = entry.part === 'near_bank'
    ? [entry.deckZ, 0]
    : entry.part === 'far_bank'
      ? [0, entry.deckZ]
      : [entry.deckZ, entry.deckZ];
  return crossing ? endpoints.map((point, index) => ({ ...point, z: z[index]! })) : [];
}

describe('bridge catalog', () => {
  it('contains the complete 128-entry bridge identity matrix', () => {
    expect(bridgeEntries).toHaveLength(128);
    expect(new Set(bridgeEntries.map((entry) => entry.key)).size).toBe(128);
    expect(new Set(bridgeEntries.map(identity)).size).toBe(128);
    expect(new Set(bridgeEntries.filter((entry) => stoneKinds.has(entry.kind)).map(identity)).size).toBe(64);
    expect(catalog.biomes).toEqual(['tropical', 'temperate', 'arid', 'northern']);

    const expectedKeys = new Set(
      bridgeKinds.flatMap((kind) =>
        ['i', 'j'].flatMap((orientation) =>
          parts.flatMap((part) => visualStates.map((state) => `bridge_${kind}_${part}_${orientation}_${state}`)),
        ),
      ),
    );
    expect(new Set(bridgeEntries.map((entry) => entry.key))).toEqual(expectedKeys);
  });

  it('makes the seam checker fail when independent endpoint material is missing', () => {
    // Synthetic occupancy fixtures test the checker's failure behaviour, not artistic quality.
    const code = `
import json, tempfile, subprocess, sys
from pathlib import Path
from PIL import Image
catalog=json.loads(Path('art/expansion/catalog.json').read_text())
with tempfile.TemporaryDirectory() as tmp:
 p=Path(tmp)/'tropical';p.mkdir()
 for e in catalog['entries']:
  if e['family']=='bridges':Image.new('RGBA',(e['width'],e['height']),(160,160,160,255)).save(p/(e['key']+'_tropical.png'))
 cmd=[sys.executable,'scripts/art-checks/bridge-seams.py','--dir',tmp]
 good=subprocess.run(cmd,capture_output=True,text=True)
 assert good.returncode==0,good.stdout+good.stderr
 Image.new('RGBA',(56,80),(0,0,0,0)).save(p/'bridge_stone_arch_far_bank_i_intact_tropical.png')
 bad=subprocess.run(cmd,capture_output=True,text=True)
 assert bad.returncode!=0 and 'SEAM_ENDPOINT_FAIL' in bad.stdout,bad.stdout+bad.stderr
print('BRIDGE_CHECK_GATE_OK')
`;
    const result = spawnSync('python', ['-c', code], { encoding: 'utf8', timeout: 30_000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('BRIDGE_CHECK_GATE_OK');
  });

  it('preserves dimensions, pivots, draft status, and 80px headroom', () => {
    for (const entry of bridgeEntries) {
      expect(entry.width).toBe(56);
      expect(entry.height).toBe(80);
      expect(entry.height).toBeLessThanOrEqual(80);
      expect(entry.pivot).toEqual({ x: entry.orientation === 'i' ? 36 : 20, y: 76 });
      expect(entry.assetClass).toBe('bridge');
      expect(entry.status).toBe('draft');
      expect(entry.footprint).toEqual(entry.orientation === 'i' ? { i: 2, j: 1 } : { i: 1, j: 2 });
      expect(entry.deckZ).toBe(stoneKinds.has(entry.kind) ? 10 : 6);
    }
  });

  it('uses the fixed access z roles and pier support heights', () => {
    for (const entry of bridgeEntries) {
      if (entry.part === 'pier') {
        expect(entry.access).toEqual([]);
        expect(entry.supportTopZ).toBe(
          stoneKinds.has(entry.kind) ? entry.deckZ - 1 : entry.kind === 'timber_footbridge' ? 5 : 4,
        );
        continue;
      }

      expect(entry.supportTopZ).toBeUndefined();
      const access = entry.access;
      expect(access).toHaveLength(2);
      expect(access.map(({ i, j, z }) => ({ i, j, z }))).toEqual(expectedAccess(entry));
      access.forEach((point, index) => {
        expect(entry.orientation === 'i' ? point.i : point.j).toBe(index === 0 ? 0 : 32);
        expect(entry.orientation === 'i' ? point.j : point.i).toBe(8);
      });
    }
  });
});
