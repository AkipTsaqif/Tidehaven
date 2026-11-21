import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without declarations
import { checkPackage, pngSize } from '../../scripts/art-expansion-package.mjs';

describe('portable expansion art package', () => {
  it('matches the catalog, committed hashes and image sizes without Aseprite', () => {
    expect(checkPackage()).toEqual([]);
  });

  it('packages every reviewed family and all six overlay effects', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../art/expansion/assets/manifest.json', import.meta.url), 'utf8')) as {
      families: string[];
      overlays: string[];
      files: Record<string, unknown>;
    };
    expect(manifest.families).toEqual(['bridges', 'boats', 'fishing', 'water', 'towers']);
    expect(manifest.overlays).toEqual(['fire_scorch', 'storm_debris', 'flood_stain', 'drought_ground', 'outbreak_sign', 'repair_scaffold']);
    const names = Object.keys(manifest.files);
    expect(names).toHaveLength(1356);
    expect(names.filter((name) => name.includes('overlay_'))).toHaveLength(360);
    for (const effect of manifest.overlays) {
      expect(names.filter((name) => name.includes('overlay_' + effect + '_'))).toHaveLength(60);
    }
  });

  it('ships pixel-ownership metadata for every overlay except fire scorch', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../art/expansion/assets/manifest.json', import.meta.url), 'utf8')) as {
      meta: Record<string, unknown>;
    };
    const names = Object.keys(manifest.meta);
    expect(names).toHaveLength(300);
    expect(names.some((name) => name.includes('fire_scorch'))).toBe(false);
    for (const effect of ['storm_debris', 'flood_stain', 'drought_ground', 'outbreak_sign', 'repair_scaffold']) {
      expect(names.filter((name) => name.includes('overlay_' + effect + '_'))).toHaveLength(60);
    }
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
