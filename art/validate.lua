-- Offline regression checks for the art kit. No simulation state and no saved-town access.
local root = assert(app.params.root, "root parameter required")
local out = assert(app.params.out, "out parameter required")
local L = dofile(root .. "/iso_lib.lua")
local B = dofile(root .. "/biomes.lua")
local K = dofile(root .. "/catalog.lua")
assert(L.TILE == 16 and L.TILE_WIDTH == 32 and L.TILE_HEIGHT == 16, "wrong classic tile size")
assert(B.choose("eden-growth-1", "tidehaven-founding-39146379") == "tropical", "saved Eden not tropical")
assert(B.choose("eden", "anything") == "tropical", "Eden override changed")
local choices={}
for i=1,100 do
  local chosen=B.choose("tidehaven-1","world-"..i)
  assert(chosen==B.choose("tidehaven-1","world-"..i),"biome not deterministic")
  choices[chosen]=true
end
for _,biome in ipairs(B.names) do assert(choices[biome],"seed selection never reaches "..biome) end

local before=B.apply(L,"tropical").ground[4]
B.apply(L,"arid"); B.apply(L,"northern"); B.apply(L,"temperate")
assert(B.apply(L,"tropical").ground[4]==before,"biome palette leaks between builds")
assert(K.tier("home",6)==1 and K.tier("home",7)==2 and K.tier("home",13)==3,"Eden housing tiers wrong")
assert(K.tier("farm",6)==1 and K.tier("farm",7)==2 and K.tier("farm",21)==3,"workplace tiers wrong")
for _,kind in ipairs(K.kinds) do
  local base=K.spec(kind,1)
  for tier=2,3 do
    local next=K.spec(kind,tier)
    assert(next.A==base.A and next.B==base.B and next.Hc==base.Hc,"tier moves footprint/pivot")
  end
end

-- A native base tile must occupy exactly a 32x16 bounding box.
local spr=L.new(out .. "/tile-check.aseprite",32,32)
local c=L.ctx(spr,"lot",16,16)
L.bounds(c,16,16)
L.lot(c,16,16,L.C.GRASS,11)
local x0,y0,x1,y1=32,32,-1,-1
for y=0,31 do for x=0,31 do
  if app.pixelColor.rgbaA(c.img:getPixel(x,y))>0 then
    x0=math.min(x0,x); x1=math.max(x1,x); y0=math.min(y0,y); y1=math.max(y1,y)
  end
end end
-- Pixel-centre filling leaves the two mathematical side vertices empty: actual opaque bounds are
-- 30x16, while the tile's continuous cell/spacing is exactly 32x16. Do not stretch it to fix this.
assert(x1-x0+1==30 and y1-y0+1==16,"native tile raster geometry wrong")
local right=L.P(c,16,0,0)
local left=L.P(c,0,16,0)
assert(right[1]-left[1]==32 and L.P(c,16,16,0)[2]-L.P(c,0,0,0)[2]==16,"tile spacing wrong")
local ok=pcall(function() L.box(c,2,2,0,16,16,4,L.C.WOOD) end)
assert(not ok,"out-of-lot mass accepted")
ok=pcall(function() L.box(c,3,2,0,4,4,4,L.C.WOOD) end)
assert(not ok,"odd planar coordinate accepted")
L.dot(c,100,100,0,L.OUTLINE)
assert(c.clipped>0,"clipping not detected")
spr:close()
print("ART_TESTS_OK tile-size, biome-seed, Eden, palette-reset, tiers, footprint, parity, clipping")
