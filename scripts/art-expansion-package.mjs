#!/usr/bin/env node
/**
 * Portable, reviewed expansion art. Needs no Aseprite: `--check` only reads committed PNGs.
 *
 *   node scripts/art-expansion-package.mjs --check
 *   node scripts/art-expansion-package.mjs --export     # authoring machine only; reads art/generated/expansion
 *
 * The package covers the reviewed families (bridges, boats, fishing, water, towers). Damage and repair
 * overlays are still starter drafts and are deliberately not packaged. Every entry stays `draft` in the
 * catalog: packaging is not gameplay activation and is not approval for the production atlas.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'art/expansion/catalog.json'), 'utf8'));
const packaged = ['bridges', 'boats', 'fishing', 'water', 'towers'];
const entries = catalog.entries.filter((entry) => packaged.includes(entry.family));
const packageDir = join(root, 'art/expansion/assets');
const manifestPath = join(packageDir, 'manifest.json');
const sourceDir = join(root, 'art/generated/expansion');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** PNG width/height from the IHDR chunk, so the check needs no image library. */
export function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error('not a PNG');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const assetName = (entry, biome) => `${entry.key}_${biome}.png`;

export function checkPackage() {
  const problems = [];
  if (!existsSync(manifestPath)) return ['manifest.json is missing'];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expected = new Map();
  for (const biome of catalog.biomes) {
    for (const entry of entries) expected.set(`${biome}/${assetName(entry, biome)}`, entry);
  }
  const listed = Object.keys(manifest.files);
  if (listed.length !== expected.size) problems.push(`manifest lists ${listed.length}, expected ${expected.size}`);
  for (const [path, entry] of expected) {
    const record = manifest.files[path];
    if (!record) { problems.push(`${path}: not in manifest`); continue; }
    const file = join(packageDir, path);
    if (!existsSync(file)) { problems.push(`${path}: file missing`); continue; }
    const bytes = readFileSync(file);
    if (sha256(bytes) !== record.sha256) problems.push(`${path}: hash differs from manifest`);
    const size = pngSize(bytes);
    if (size.width !== entry.width || size.height !== entry.height) {
      problems.push(`${path}: ${size.width}x${size.height}, catalog says ${entry.width}x${entry.height}`);
    }
  }
  for (const biome of catalog.biomes) {
    const dir = join(packageDir, biome);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!expected.has(`${biome}/${name}`)) problems.push(`${biome}/${name}: not a catalogued asset`);
    }
  }
  return problems;
}

function exportPackage() {
  if (!existsSync(sourceDir)) throw new Error('art/generated/expansion not found; build the art first');
  const files = {};
  for (const biome of catalog.biomes) {
    mkdirSync(join(packageDir, biome), { recursive: true });
    for (const entry of entries) {
      const name = assetName(entry, biome);
      const from = join(sourceDir, biome, name);
      if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`missing ${from}`);
      const bytes = readFileSync(from);
      const size = pngSize(bytes);
      if (size.width !== entry.width || size.height !== entry.height) throw new Error(`${name}: wrong size`);
      copyFileSync(from, join(packageDir, biome, name));
      files[`${biome}/${name}`] = { sha256: sha256(bytes) };
    }
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(manifestPath, `${JSON.stringify({ version: 1, families: packaged, files: sorted }, null, 1)}\n`);
  console.log(`exported ${Object.keys(sorted).length} PNGs`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--export')) exportPackage();
  const problems = checkPackage();
  if (problems.length) {
    for (const problem of problems.slice(0, 20)) console.error(problem);
    process.exit(1);
  }
  console.log(`PACKAGE_OK ${entries.length * catalog.biomes.length} PNGs`);
}
