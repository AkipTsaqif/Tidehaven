-- Original Tidehaven art recipes. 16 world units = one 32x16 tile; NOT a raster resize.
-- A fixed 3x3 lot per building kind keeps the anchor/footprint stable across capacity tiers.
local K = {}
K.kinds = {"home","farm","fishery","bakery","timber_camp","workshop","shop","clinic","guard_house","court","council","public_works"}
K.specials = {"camp","home_site","development_site","development_abandoned","destroyed"}
K.names = {
  home={"cottage","family house","courtyard house"}, farm={"garden farm","farmstead","large farm"},
  fishery={"fishing hut","fishing station","fishing harbour"}, bakery={"bread oven","bakery","large bakery"},
  timber_camp={"woodcutter hut","logging yard","large logging yard"}, workshop={"workshop","craft hall","factory"},
  shop={"stall shop","market shop","market hall"}, clinic={"dispensary","clinic","hospital"},
  guard_house={"watch hut","guard house","watch station"}, court={"court house","town hall","civic hall"},
  council={"council hut","council hall","assembly hall"}, public_works={"tool shed","town yard","works depot"},
}

-- Capacity thresholds are presentation, not a gameplay rule. No fake inhabitants or output.
-- Existing Eden cottage (6 beds) uses small; expansions 7..12 medium, 13+ large.
function K.tier(kind, capacity)
  local a, b = 6, 20
  if kind == "home" then a, b = 6, 12 end
  if capacity <= a then return 1 elseif capacity <= b then return 2 else return 3 end
end

function K.spec(kind, tier)
  assert(tier >= 1 and tier <= 3, "tier must be 1..3")
  assert(K.names[kind], "unknown catalog kind: " .. tostring(kind))
  return {kind=kind, tier=tier, A=48, B=48, Hc=104, tilesI=3, tilesJ=3, name=K.names[kind][tier]}
end

-- Drawing lives in art/families/<family>.lua, one file per redesign brief, so a family can be
-- reworked without touching the others. Shared starter helpers: art/families/common.lua.
local ROOT = (app and app.params and app.params.root) or "."
local U = dofile(ROOT .. "/families/common.lua")
K.families = {}
K.familyOf = {}
for _, name in ipairs({"production","civic","services","homes","specials"}) do
  local F = dofile(ROOT .. "/families/" .. name .. ".lua")
  K.families[name] = F
  for _, kind in ipairs(F.kinds) do
    assert(not K.familyOf[kind], "kind claimed by two families: " .. kind)
    K.familyOf[kind] = name
  end
end
for _, kind in ipairs(K.kinds) do assert(K.familyOf[kind], "no family draws " .. kind) end
for _, kind in ipairs(K.specials) do assert(K.familyOf[kind], "no family draws " .. kind) end

-- Kind-specific silhouettes, fixtures and ground dressing.
function K.draw(L,B,c,theme,spec)
  K.families[K.familyOf[spec.kind]].draw(L,B,c,theme,spec,U)
end

-- Construction / camps / ruins are real engine states, not pretend functioning businesses.
function K.drawSpecial(L,B,c,theme,kind,seed)
  K.families.specials.draw(L,B,c,theme,{kind=kind,tier=1,seed=seed,A=48,B=48,Hc=104},U)
end
return K
