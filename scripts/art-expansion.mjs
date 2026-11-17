#!/usr/bin/env node
/** Isolated expansion art batch: no gameplay/save changes. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => { const n = args.indexOf(`--${key}`); return n < 0 ? fallback : args[n + 1]; };
const catalog = JSON.parse(readFileSync(join(root, 'art/expansion/catalog.json'), 'utf8'));
const family = option('family', 'all'), key = option('key', 'all');
const selected = catalog.entries.filter((e) => (family === 'all' || e.family === family) && (key === 'all' || e.key === key));
if (!selected.length) throw new Error('No matching assets');
if (args.includes('--list')) { for (const e of selected) console.log(e.key); process.exit(0); }
const requested = option('biome', 'tropical');
const biomes = requested === 'all' ? catalog.biomes : [requested];
if (!biomes.every((b) => catalog.biomes.includes(b))) throw new Error('Unknown biome');
const output = resolve(option('out', join(root, 'art/generated/expansion')));
const executable = process.env.ASEPRITE_PATH ?? 'D:/Games/Steam/steamapps/common/Aseprite/Aseprite.exe';
const seed = Number(option('seed', '39146379'));
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 1_000_000_000) throw new Error('Seed must be integer0..1e9');
const slash = (p) => p.replaceAll('\\', '/');
for (const biome of biomes) {
  const dir = join(output, biome);
  mkdirSync(dir, { recursive: true });
  const job = join(dir, '_job.json');
  const specs = selected.map((entry) => ({ ...entry, biome, seed }));
  writeFileSync(job, JSON.stringify(specs));
  const result = spawnSync(executable, ['--batch', '--script-param', `root=${slash(join(root, 'art'))}`,
    '--script-param', `out=${slash(dir)}`, '--script-param', `job=${slash(job)}`,
    '--script', join(root, 'art/expansion/build.lua')], { encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  const lines = result.stdout?.split(/\r?\n/) ?? [];
  if (result.error || result.status !== 0 || specs.some((s) => !lines.includes(`ASSET_OK ${s.key}_${biome}`))) {
    throw result.error ?? new Error(`${biome} failed: ${result.stdout}\n${result.stderr}`);
  }
  const items = specs.map((spec) => {
    const id = `${spec.key}_${biome}`;
    console.log(`OK ${id}`);
    return { ...spec, id, png: `${id}.png`, source: `${id}.aseprite` };
  });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ version: 2, tileWidth: 32, tileHeight: 16, biome, items }, null, 2) + '\n');
  console.log(`${biome}: ${items.length} assets (manifest contains only this selection)`);
}
