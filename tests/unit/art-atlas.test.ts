import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('atlas v2 packer', () => {
  it('packs unequal rectangles with gutters, preserving every RGBA pixel deterministically', () => {
    const code = `
import importlib.util, tempfile, json, sys
sys.dont_write_bytecode=True
from pathlib import Path
from PIL import Image
spec=importlib.util.spec_from_file_location('packer','scripts/art-atlas.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=Path(d);items=[]
 for n,(w,h,fw,fd) in enumerate([(96,104,3,3),(168,96,8,2),(256,768,8,8)]):
  im=Image.new('RGBA',(w,h),(n*40+20,90,130,128+n*20));im.putpixel((0,0),(3,4,5,0));im.save(p/f'{n}.png')
  items.append(dict(kind=f'k{n}',tier=1,width=w,height=h,pivot=dict(x=fw*16,y=h),footprint=dict(i=fw,j=fd),png=f'{n}.png'))
 (p/'manifest.json').write_text(json.dumps(dict(items=items)))
 a=m.pack_set(p/'manifest.json',p/'atlas.png');b=m.pack_set(p/'manifest.json',p/'repeat.png')
 assert a==b and (p/'atlas.png').read_bytes()==(p/'repeat.png').read_bytes()
 sheet=Image.open(p/'atlas.png')
 for n,item in enumerate(items):
  r=a[f'k{n}_1']['rect'];assert sheet.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h'])).tobytes()==Image.open(p/f'{n}.png').tobytes()
  assert sheet.getpixel((r['x']-1,r['y']))[3]==0
 items.append(items[0]);(p/'manifest.json').write_text(json.dumps(dict(items=items)))
 try:m.pack_set(p/'manifest.json',p/'bad.png');raise AssertionError('accepted duplicate')
 except ValueError:pass
print('ATLAS_TEST_OK')
`;
    const r = spawnSync('python', ['-c', code], { encoding: 'utf8', timeout: 30_000 });
    expect(r.error).toBeUndefined();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('ATLAS_TEST_OK');
  });
});
