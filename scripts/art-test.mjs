#!/usr/bin/env node
/** Opt-in real-Aseprite tests. Kept out of npm verify so clean checkouts do not require purchased tools. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'tidehaven-art-'));
const aseprite = process.env.ASEPRITE_PATH ?? 'D:/Games/Steam/steamapps/common/Aseprite/Aseprite.exe';
const run = (exe, args) => {
  const r = spawnSync(exe, args, { cwd: root, encoding: 'utf8', timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw r.error ?? new Error(r.stderr + r.stdout);
  return r.stdout + r.stderr;
};
const build = (args) => run(process.execPath, ['scripts/art-build.mjs', '--out', out, ...args]);
try {
  const checks = run(aseprite, ['--batch', '--script-param', `root=${root.replaceAll('\\','/')}/art`,
    '--script-param', `out=${out.replaceAll('\\','/')}`, '--script', 'art/validate.lua']);
  assert.match(checks, /ART_TESTS_OK/);
  console.log(checks.trim());
  const starter = run(aseprite, ['--batch', '--script-param', `root=${root.replaceAll('\\','/')}/art`,
    '--script-param', `out=${out.replaceAll('\\','/')}`, '--script', 'art/templates/new_sprite.lua']);
  assert.match(starter, /OK custom_home/);
  console.log('PASS copyable custom-sprite starter');
  for (const biome of ['tropical','temperate','arid','northern']) {
    const args = ['--scenario', 'tidehaven', '--biome', biome, '--seed', 'repeatable-art-check'];
    build(args);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.equal(manifest.tileWidth,32); assert.equal(manifest.tileHeight,16);
    assert.equal(manifest.items.length,41);
    assert.equal(manifest.biome,biome);
    for (const scenario of ['eden','tidehaven']) {
      const definition = JSON.parse(readFileSync(join(root,'scenarios',`${scenario}.json`),'utf8'));
      for (const building of definition.town.buildings) {
        assert(manifest.items.some((item)=>item.kind===building.kind),`missing ${building.kind}`);
      }
      for (const kind of Object.keys(definition.growth?.workplaceTemplates ?? {})) {
        assert(manifest.items.some((item)=>item.kind===kind),`missing new workplace ${kind}`);
      }
    }
    const digest = () => createHash('sha256').update(readFileSync(join(out,`home_1_${biome}.png`))).digest('hex');
    const before = digest();
    build([...args, '--kind','home','--tier','1']);
    assert.equal(digest(),before,'same seed/recipe changed output');
    console.log(`PASS ${biome}: 41 assets, all scenario kinds covered, repeat pixels identical`);
  }
  // Even an explicit biome cannot make a saved Eden non-tropical.
  build(['--scenario','eden','--seed','tidehaven-founding-39146379','--biome','northern','--kind','home']);
  assert.equal(JSON.parse(readFileSync(join(out,'manifest.json'),'utf8')).biome,'tropical');
  assert(readdirSync(out).some((name)=>name.endsWith('.aseprite')));
  console.log('PASS current Eden scenario/seed override; 164 catalog assets rendered and validated');
} finally { rmSync(out,{recursive:true,force:true}); }
