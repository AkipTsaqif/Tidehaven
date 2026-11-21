import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('atlas packer on unequal rectangles', () => {
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
 pages,a=m.pack_pages(m.read_assets(p/'manifest.json'))
 pages2,b=m.pack_pages(m.read_assets(p/'manifest.json'))
 assert a==b and [x.tobytes() for x in pages]==[x.tobytes() for x in pages2]
 for n,item in enumerate(items):
  f=a[f'k{n}_1'];r=f['rect'];sheet=pages[f['page']]
  assert sheet.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h'])).tobytes()==Image.open(p/f'{n}.png').convert('RGBA').tobytes()
  assert sheet.getpixel((r['x']-1,r['y']))[3]==0
 items.append(items[0]);(p/'manifest.json').write_text(json.dumps(dict(items=items)))
 try:m.read_assets(p/'manifest.json');raise AssertionError('accepted duplicate')
 except ValueError:pass
print('ATLAS_TEST_OK')
`;
    const r = spawnSync('python', ['-c', code], { encoding: 'utf8', timeout: 30_000 });
    expect(r.error).toBeUndefined();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('ATLAS_TEST_OK');
  });
});

describe('atlas v3 multi-page packer', () => {
  const run = (body: string) => {
    const code = `
import importlib.util, tempfile, json, sys
sys.dont_write_bytecode=True
from pathlib import Path
from PIL import Image
spec=importlib.util.spec_from_file_location('packer','scripts/art-atlas.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def asset(key,w,h,cls='building',paint=None,fp=(3,3)):
    im=Image.new('RGBA',(w,h),(0,0,0,0))
    for (x,y,c) in (paint if paint is not None else [(w//2,h//2,(9,8,7,255))]): im.putpixel((x,y),c)
    return {'key':key,'image':im,'pivot':{'x':w//2,'y':h},'footprint':{'w':fp[0],'d':fp[1]},'assetClass':cls,'status':'approved'}
${body}
`;
    const r = spawnSync('python', ['-c', code], { encoding: 'utf8', timeout: 60_000 });
    expect(r.error).toBeUndefined();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    return r.stdout;
  };

  it('splits art that does not fit one page, deterministically, and loses no pixel', () => {
    const out = run(`
assets=[asset('t%d'%n,256,768,paint=[(n+1,n+2,(n+1,50,60,255))]) for n in range(20)]
pages,frames=m.pack_pages(assets)
assert len(pages)>1,len(pages)
assert all(p.width==1024 and p.height<=4096 for p in pages)
for n,a in enumerate(assets):
    f=frames[a['key']];r=f['rect'];sheet=pages[f['page']]
    assert sheet.crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h'])).tobytes()==a['image'].tobytes()
again,frames2=m.pack_pages(assets)
assert frames==frames2 and [p.tobytes() for p in pages]==[p.tobytes() for p in again]
print('PAGES_OK',len(pages))`);
    expect(out).toContain('PAGES_OK');
  });

  it('trims overlays to their opaque box and rebuilds the exact canvas from the recorded offset', () => {
    const out = run(`
paint=[(20,30,(1,2,3,255)),(34,44,(4,5,6,128))]
ov=asset('overlay_x',104,104,cls='overlay',paint=paint)
pages,frames=m.pack_pages([ov])
f=frames['overlay_x'];assert f['rect']['w']==15 and f['rect']['h']==15,f['rect']
assert f['trim']=={'x':20,'y':30,'w':104,'h':104},f['trim']
assert f['pivot']=={'x':52,'y':104}
r=f['rect'];crop=pages[0].crop((r['x'],r['y'],r['x']+r['w'],r['y']+r['h']))
canvas=Image.new('RGBA',(104,104),(0,0,0,0));canvas.paste(crop,(f['trim']['x'],f['trim']['y']))
assert canvas.tobytes()==ov['image'].tobytes()
print('TRIM_OK')`);
    expect(out).toContain('TRIM_OK');
  });

  it('never trims buildings, and does not mark a full-canvas overlay as trimmed', () => {
    const out = run(`
b=asset('home_x',96,104,cls='building',paint=[(40,50,(1,2,3,255))])
full=asset('overlay_full',4,4,cls='overlay',paint=[(0,0,(1,1,1,255)),(3,3,(1,1,1,255))])
pages,frames=m.pack_pages([b,full])
assert 'trim' not in frames['home_x'] and frames['home_x']['rect']['w']==96
assert 'trim' not in frames['overlay_full']
print('NOTRIM_OK')`);
    expect(out).toContain('NOTRIM_OK');
  });

  it('rejects a fully transparent overlay, an oversized frame and a duplicate key', () => {
    const out = run(`
for bad in (lambda: m.pack_pages([asset('o',10,10,cls='overlay',paint=[])]),
            lambda: m.pack_pages([asset('big',1030,10)]),
            lambda: m.pack_pages([asset('tall',10,4200)])):
    try:
        bad();raise AssertionError('accepted bad input')
    except ValueError:pass
with tempfile.TemporaryDirectory() as d:
    p=Path(d);Image.new('RGBA',(4,4),(1,1,1,255)).save(p/'a.png')
    item=dict(kind='k',tier=1,width=4,height=4,pivot=dict(x=2,y=4),footprint=dict(i=1,j=1),png='a.png')
    (p/'manifest.json').write_text(json.dumps(dict(items=[item,item])))
    try:
        m.read_assets(p/'manifest.json');raise AssertionError('accepted duplicate')
    except ValueError:pass
print('REJECT_OK')`);
    expect(out).toContain('REJECT_OK');
  });

  it('writes page files with stable names and removes pages left over from a larger run', () => {
    const out = run(`
with tempfile.TemporaryDirectory() as d:
    p=Path(d)
    sheet=Image.new('RGBA',(1024,8),(0,0,0,0))
    described=m.write_pages([sheet,sheet,sheet],p,'atlas-tropical')
    assert [x['image'] for x in described]==['/map/atlas-tropical.png','/map/atlas-tropical-1.png','/map/atlas-tropical-2.png']
    (p/'atlas-tropical-notapage.png').write_bytes(b'x')
    m.remove_stale_pages(p,'atlas-tropical',2)
    names=sorted(x.name for x in p.iterdir())
    assert names==['atlas-tropical-1.png','atlas-tropical-notapage.png','atlas-tropical.png'],names
print('FILES_OK')`);
    expect(out).toContain('FILES_OK');
  });
});
