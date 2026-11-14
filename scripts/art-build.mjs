#!/usr/bin/env node
/** Build original sprite recipes with Aseprite, outside the simulator. No network or saved-town writes. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? fallback : args[i + 1];
};
const scenario = option('scenario', 'eden');
if (!/^[a-zA-Z0-9_-]+$/.test(scenario)) throw new Error('Scenario must be a filename stem');
const definition = JSON.parse(readFileSync(join(root, 'scenarios', `${scenario}.json`), 'utf8'));
const seed = option('seed', 'tidehaven-founding');
const knownBiomes = ['tropical', 'temperate', 'arid', 'northern'];
const requestedBiome = option('biome', 'seed');
if (requestedBiome !== 'seed' && !knownBiomes.includes(requestedBiome)) throw new Error('Unknown biome');
const kind = option('kind', 'all');
const tier = option('tier', '1');
if (!/^[a-z_]+$/.test(kind) || !['1','2','3'].includes(tier)) throw new Error('Invalid kind or tier');
const out = resolve(option('out', join(root, 'art', 'generated', scenario)));
mkdirSync(out, { recursive: true });
const executable = process.env.ASEPRITE_PATH ?? 'D:/Games/Steam/steamapps/common/Aseprite/Aseprite.exe';
const params = { root: join(root, 'art').replaceAll('\\', '/'), out: out.replaceAll('\\', '/'), scenario: definition.version, seed, kind, tier };
if (requestedBiome !== 'seed') params.biome = requestedBiome;
if (kind === 'all') params.all = 'true';
const command = ['--batch'];
for (const [name, value] of Object.entries(params)) command.push('--script-param', `${name}=${value}`);
command.push('--script', join(root, 'art', 'build.lua'));
const result = spawnSync(executable, command, { encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.error) throw result.error;
// Aseprite may return zero after a Lua error: require explicit completion lines and no errors.
const output = result.stdout ?? '';
const matches = [...output.matchAll(/^OK ([a-z_]+)_(\d)_([a-z]+) (\d+)x(\d+) footprint=3x3 pivot=(\d+),(\d+)\r?$/gm)];
const expected = kind === 'all' ? 41 : 1; // 12 kinds x 3 tiers, plus five real engine special states
if (result.status !== 0 || matches.length !== expected || /error|\.lua:\d+:/i.test(output + (result.stderr ?? ''))) {
  throw new Error(`Art build failed: ${matches.length}/${expected} sprites completed; see Lua error above`);
}
const items = matches.map((m) => ({ id: m[1] + '_' + m[2] + '_' + m[3], kind: m[1], tier: Number(m[2]), biome: m[3],
  width: Number(m[4]), height: Number(m[5]), footprint: { i: 3, j: 3 }, pivot: { x: Number(m[6]), y: Number(m[7]) },
  png: `${m[1]}_${m[2]}_${m[3]}.png`, source: `${m[1]}_${m[2]}_${m[3]}.aseprite` }));
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ version: 1, tileWidth: 32, tileHeight: 16,
  scenario: definition.version, seed, biome: items[0].biome, items }, null, 2) + '\n');
console.log(`Validated ${items.length} sprites; manifest: ${join(out, 'manifest.json')}`);
