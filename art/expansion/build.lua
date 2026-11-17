-- Expansion build runner. Parameters: root=<art>, out=<dir>, spec=<JSON in app.params.entry>.
local root = assert(app.params.root)
local out = assert(app.params.out)
local L = dofile(root .. '/iso_lib.lua')
local B = dofile(root .. '/biomes.lua')
local function render(s)
local theme = B.apply(L, s.biome)
local F = dofile(root .. '/expansion/families/' .. s.family .. '.lua')
local A, D = s.footprint.i * 16, s.footprint.j * 16
local spr = L.new(out .. '/' .. s.key .. '_' .. s.biome .. '.aseprite', s.width, s.height)
-- gx = pivotX - A + D; gy = pivotY - (A+D)/2 so the continuous bottom corner matches pivot.
local gx, gy = s.pivot.x - A + D, s.pivot.y - (A + D) / 2
local c = {}
local names = {'lot', 'shadow', 'props_back', 'building', 'details'}
for _, name in ipairs(names) do
  c[name] = L.ctx(spr, name, gx, gy)
  L.bounds(c[name], A, D)
end
s.A, s.B = A, D
F.draw(L, B, c, theme, s)
for _, name in ipairs({'props_back','building','details'}) do
  -- Overlays intentionally have no new outer outline: avoid dark boxes around smoke/stains.
  if s.assetClass ~= 'overlay' and s.assetClass ~= 'water_detail' then L.outline(c[name]) end
end
local allowed = {[L.OUTLINE]=true,[L.SHADOW]=true,[L.LIT]=true,[L.BEACON]=true}
for _, ramp in pairs(L.C) do for _, col in ipairs(ramp) do allowed[col]=true end end
for _, col in ipairs(L.FLOWERS) do allowed[col]=true end
local count = 0
for _, name in ipairs(names) do
  local ctx = c[name]
  assert(ctx.clipped == 0, name .. ': attempted canvas clipping')
  for y=0,s.height-1 do for x=0,s.width-1 do
    local p=ctx.img:getPixel(x,y)
    if app.pixelColor.rgbaA(p)>0 then
      assert(allowed[p],name .. ': off-palette colour')
      assert(y>0 and x>0 and x<s.width-1,name .. ': touches canvas top/side')
      count=count+1
    end
  end end
  L.commit(ctx)
end
assert(count>0,'empty sprite')
local slice = spr:newSlice(Rectangle(0,0,s.width,s.height))
slice.name='footprint'; slice.pivot=Point(s.pivot.x,s.pivot.y)
spr:saveAs(spr.filename)
spr:saveCopyAs(out .. '/' .. s.key .. '_' .. s.biome .. '.png')
spr:close()
print('ASSET_OK ' .. s.key .. '_' .. s.biome)

end
local file=assert(io.open(assert(app.params.job),'rb'))
local batch=json.decode(file:read('*a')); file:close()
for _,s in ipairs(batch) do render(s) end
