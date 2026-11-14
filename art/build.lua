-- Aseprite batch entrypoint, callable via CLI or MCP run_lua_script:
-- app.params are strings. Required: root, out. Optional: kind, tier, biome, seed, scenario, all.
local root = assert(app.params.root, "pass --script-param root=<project>/art")
local out = assert(app.params.out, "pass --script-param out=<output-directory>")
local L = dofile(root .. "/iso_lib.lua")
local B = dofile(root .. "/biomes.lua")
local K = dofile(root .. "/catalog.lua")
local seedText = app.params.seed or "tidehaven"
local scenario = app.params.scenario or "tidehaven"
local biome = app.params.biome or B.choose(scenario, seedText)
-- Eden is always tropical, including a saved world whose seed predates this art kit.
if scenario:lower():match("^eden") then biome = "tropical" end
local theme = B.apply(L, biome)
for key, value in pairs(theme) do
  if type(value) == "string" and L.C[value] then theme[key] = L.C[value] end
end
local seed = 0
for i=1,#seedText do seed=(seed*131+seedText:byte(i))%2147483647 end

local function alpha(pixel) return app.pixelColor.rgbaA(pixel) end
local function validate(spr, contexts, A, Baxis)
  assert(spr.width == A+Baxis, "wrong width for 32x16 tile projection")
  local expected={"lot","shadow","props_back","building","details"}
  assert(#spr.layers == #expected, "wrong layer count")
  local allowed = {[L.OUTLINE]=true,[L.SHADOW]=true,[L.LIT]=true,[L.BEACON]=true}
  for _,ramp in pairs(L.C) do for _,colour in ipairs(ramp) do allowed[colour]=true end end
  for _,colour in ipairs(L.FLOWERS) do allowed[colour]=true end
  for n,c in ipairs(contexts) do
    assert(spr.layers[n].name == expected[n], "wrong layer order")
    assert(c.clipped == 0, expected[n] .. ": pixels clipped by canvas (increase headroom or move prop)")
    for y=0,spr.height-1 do for x=0,spr.width-1 do
      local p=c.img:getPixel(x,y)
      assert(alpha(p)==0 or allowed[p], expected[n] .. ": colour outside approved source palette " .. tostring(p))
      if y==0 then assert(alpha(p)==0,"drawing touches top row: add headroom") end
    end end
  end
  -- Continuous anchor is at y=height, just outside the raster; last row has the two tip pixels.
  assert(alpha(contexts[1].img:getPixel(A-1,spr.height-1))>0,"missing left lot-tip pixel")
  assert(alpha(contexts[1].img:getPixel(A,spr.height-1))>0,"missing right lot-tip pixel")
  assert(#spr.slices==1 and spr.slices[1].pivot.x==A and spr.slices[1].pivot.y==spr.height,"wrong pivot")
end

local function render(kind,tier)
  local special = not K.names[kind]
  local spec=special and {A=48,B=48,Hc=104,kind=kind,tier=1} or K.spec(kind,tier)
  spec.seed=seed+tier*101
  local id=kind .. "_" .. tostring(tier) .. "_" .. biome
  local path=out .. "/" .. id
  local spr=L.new(path .. ".aseprite",spec.A+spec.B,spec.Hc)
  local gx,gy=spec.B,spec.Hc-(spec.A+spec.B)/2
  local contexts,c={},{}
  for _,name in ipairs({"lot","shadow","props_back","building","details"}) do
    local ctx=L.ctx(spr,name,gx,gy)
    L.bounds(ctx,spec.A,spec.B)
    c[name]=ctx; contexts[#contexts+1]=ctx
  end
  if special then
    local exists=false
    for _,name in ipairs(K.specials) do if name==kind then exists=true end end
    assert(exists,"unknown special sprite kind")
    K.drawSpecial(L,B,c,theme,kind,spec.seed)
  else K.draw(L,B,c,theme,spec) end
  for _,name in ipairs({"props_back","building","details"}) do L.outline(c[name]) end
  for _,ctx in ipairs(contexts) do L.commit(ctx) end
  L.pivot(spr,spec.A,spec.B)
  validate(spr,contexts,spec.A,spec.B)
  L.save(spr); L.png(spr,path .. ".png")
  -- Export separate ground and prop layers too, so a map can keep terrain, shadows and objects apart.
  print("OK "..id.." "..spr.width.."x"..spr.height.." footprint=3x3 pivot="..spec.A..","..spr.height)
  spr:close()
end

if app.params.all=="true" then
  for _,kind in ipairs(K.kinds) do for tier=1,3 do render(kind,tier) end end
  for _,kind in ipairs(K.specials) do render(kind,1) end
else
  render(app.params.kind or "home",tonumber(app.params.tier or "1"))
end
