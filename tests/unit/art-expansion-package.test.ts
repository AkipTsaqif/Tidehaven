import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without declarations
import { checkPackage, pngSize } from '../../scripts/art-expansion-package.mjs';

describe('portable expansion art package', () => {
  it('matches the catalog, committed hashes and image sizes without Aseprite', () => {
    expect(checkPackage()).toEqual([]);
  });

  it('only packages reviewed families, never the starter damage overlays', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../art/expansion/assets/manifest.json', import.meta.url), 'utf8')) as {
      families: string[];
      files: Record<string, unknown>;
    };
    expect(manifest.families).toEqual(['bridges', 'boats', 'fishing', 'water', 'towers']);
    expect(Object.keys(manifest.files)).toHaveLength(996);
    expect(Object.keys(manifest.files).some((name) => name.includes('overlay_'))).toBe(false);
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
