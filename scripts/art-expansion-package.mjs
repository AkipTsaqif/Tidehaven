#!/usr/bin/env node
/**
 * Portable, reviewed expansion art. Needs no Aseprite: `--check` only reads committed files.
 *
 *   node scripts/art-expansion-package.mjs --check
 *   node scripts/art-expansion-package.mjs --export     # authoring machine only; reads art/generated/expansion
 *
 * The package covers the reviewed families (bridges, boats, fishing, water, towers) and the three
 * reviewed overlay effects (fire scorch, storm debris, flood stain). Storm and flood sprites also ship
 * their pixel-ownership metadata, which says which pixels are ground marks and which are wall marks.
 * Drought, outbreak and repair overlays are still starter drafts and are deliberately not packaged.
 * Every entry stays `draft` in the catalog: packaging is not gameplay activation, not approval for the
 * production atlas, and overlays still need a verified material mask before they may be drawn.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'art/expansion/catalog.json'), 'utf8'));
const packaged = ['bridges', 'boats', 'fishing', 'water', 'towers'];
const overlayKinds = ['fire_scorch', 'storm_debris', 'flood_stain'];
const metaKinds = ['storm_debris', 'flood_stain'];
const isPackaged = (entry) =>
  packaged.includes(entry.family) || (entry.family === 'damage' && overlayKinds.includes(entry.kind));
const entries = catalog.entries.filter(isPackaged);
const metaEntries = entries.filter((entry) => metaKinds.includes(entry.kind));
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
const metaName = (entry, biome) => `meta/${entry.key}_${biome}.json`;

function expectedSets() {
  const images = new Map();
  const metas = new Map();
  for (const biome of catalog.biomes) {
    for (const entry of entries) images.set(`${biome}/${assetName(entry, biome)}`, entry);
    for (const entry of metaEntries) metas.set(`${biome}/${metaName(entry, biome)}`, entry);
  }
  return { images, metas };
}

function checkImages(manifest, images, problems) {
  if (Object.keys(manifest.files).length !== images.size) {
    problems.push(`manifest lists ${Object.keys(manifest.files).length}, expected ${images.size}`);
  }
  for (const [path, entry] of images) {
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
}

function checkMetadata(manifest, metas, problems) {
  const listed = Object.keys(manifest.meta ?? {}).length;
  if (listed !== metas.size) problems.push(`manifest lists ${listed} metadata files, expected ${metas.size}`);
  for (const [path, entry] of metas) {
    const record = manifest.meta?.[path];
    if (!record) { problems.push(`${path}: not in manifest`); continue; }
    const file = join(packageDir, path);
    if (!existsSync(file)) { problems.push(`${path}: file missing`); continue; }
    const bytes = readFileSync(file);
    if (sha256(bytes) !== record.sha256) { problems.push(`${path}: hash differs from manifest`); continue; }
    let meta;
    try { meta = JSON.parse(bytes.toString('utf8')); } catch { problems.push(`${path}: not valid JSON`); continue; }
    const wrong = !Array.isArray(meta.size) || meta.size[0] !== entry.width || meta.size[1] !== entry.height
      || meta.key !== entry.key || !Array.isArray(meta.pieces) || meta.pieces.length === 0;
    if (wrong) problems.push(`${path}: does not describe ${entry.key} at ${entry.width}x${entry.height}`);
  }
}

function checkNoExtras(images, metas, problems) {
  for (const biome of catalog.biomes) {
    const dir = join(packageDir, biome);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name === 'meta') continue;
      if (!images.has(`${biome}/${name}`)) problems.push(`${biome}/${name}: not a catalogued asset`);
    }
    const metaDir = join(dir, 'meta');
    if (!existsSync(metaDir)) continue;
    for (const name of readdirSync(metaDir)) {
      if (!metas.has(`${biome}/meta/${name}`)) problems.push(`${biome}/meta/${name}: not a catalogued metadata file`);
    }
  }
}

export function checkPackage() {
  const problems = [];
  if (!existsSync(manifestPath)) return ['manifest.json is missing'];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const { images, metas } = expectedSets();
  checkImages(manifest, images, problems);
  checkMetadata(manifest, metas, problems);
  checkNoExtras(images, metas, problems);
  return problems;
}

function copyChecked(from, to) {
  if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`missing ${from}`);
  const bytes = readFileSync(from);
  copyFileSync(from, to);
  return bytes;
}

function exportPackage() {
  if (!existsSync(sourceDir)) throw new Error('art/generated/expansion not found; build the art first');
  const files = {};
  const meta = {};
  for (const biome of catalog.biomes) {
    mkdirSync(join(packageDir, biome, 'meta'), { recursive: true });
    for (const entry of entries) {
      const name = assetName(entry, biome);
      const bytes = copyChecked(join(sourceDir, biome, name), join(packageDir, biome, name));
      const size = pngSize(bytes);
      if (size.width !== entry.width || size.height !== entry.height) throw new Error(`${name}: wrong size`);
      files[`${biome}/${name}`] = { sha256: sha256(bytes) };
    }
    for (const entry of metaEntries) {
      const name = metaName(entry, biome);
      const bytes = copyChecked(join(sourceDir, biome, name), join(packageDir, biome, name));
      meta[`${biome}/${name}`] = { sha256: sha256(bytes) };
    }
  }
  const order = (table) => Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  const manifest = { version: 2, families: packaged, overlays: overlayKinds, files: order(files), meta: order(meta) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`exported ${Object.keys(files).length} PNGs and ${Object.keys(meta).length} metadata files`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--export')) exportPackage();
  const problems = checkPackage();
  if (problems.length) {
    for (const problem of problems.slice(0, 20)) console.error(problem);
    process.exit(1);
  }
  const { images, metas } = expectedSets();
  console.log(`PACKAGE_OK ${images.size} PNGs, ${metas.size} metadata files`);
}
