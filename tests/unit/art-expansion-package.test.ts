import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without declarations
import { checkPackage, pngSize } from '../../scripts/art-expansion-package.mjs';

describe('portable expansion art package', () => {
  it('matches the catalog, committed hashes and image sizes without Aseprite', () => {
    expect(checkPackage()).toEqual([]);
  });

  it('packages reviewed families and the three reviewed overlay effects only', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../art/expansion/assets/manifest.json', import.meta.url), 'utf8')) as {
      families: string[];
      overlays: string[];
      files: Record<string, unknown>;
      meta: Record<string, unknown>;
    };
    expect(manifest.families).toEqual(['bridges', 'boats', 'fishing', 'water', 'towers']);
    expect(manifest.overlays).toEqual(['fire_scorch', 'storm_debris', 'flood_stain']);
    expect(Object.keys(manifest.files)).toHaveLength(1176);
    const names = Object.keys(manifest.files);
    expect(names.filter((name) => name.includes('overlay_'))).toHaveLength(180);
    for (const unfinished of ['drought_ground', 'outbreak_sign', 'repair_scaffold']) {
      expect(names.some((name) => name.includes(unfinished))).toBe(false);
    }
  });

  it('ships ground/wall ownership metadata for storm and flood sprites only', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../art/expansion/assets/manifest.json', import.meta.url), 'utf8')) as {
      meta: Record<string, unknown>;
    };
    const names = Object.keys(manifest.meta);
    expect(names).toHaveLength(120);
    expect(names.every((name) => /overlay_(storm_debris|flood_stain)_/.test(name))).toBe(true);
    expect(names.some((name) => name.includes('fire_scorch'))).toBe(false);
  });

  it('detects tampered metadata and stray files', () => {
    const dir = new URL('../../art/expansion/assets/tropical/meta/', import.meta.url);
    const name = 'overlay_flood_stain_3x3_104_light_tropical.json';
    const original = readFileSync(new URL(name, dir));
    try {
      writeFileSync(new URL(name, dir), original.toString('utf8').replace('"pieces":[', '"pieces":[{"class":"ghost"},'));
      expect(checkPackage().some((problem: string) => problem.includes('hash differs'))).toBe(true);
      writeFileSync(new URL(name, dir), original);
      writeFileSync(new URL('stray.json', dir), '{}');
      expect(checkPackage().some((problem: string) => problem.includes('not a catalogued metadata file'))).toBe(true);
    } finally {
      writeFileSync(new URL(name, dir), original);
      rmSync(new URL('stray.json', dir), { force: true });
    }
    expect(checkPackage()).toEqual([]);
  });

  it('reads PNG dimensions and rejects other files', () => {
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.write('IHDR', 12, 'latin1');
    header.writeUInt32BE(96, 16);
    header.writeUInt32BE(104, 20);
    expect(pngSize(header)).toEqual({ width: 96, height: 104 });
    expect(() => pngSize(Buffer.from('not an image data here!!'))).toThrow('not a PNG');
  });
});
