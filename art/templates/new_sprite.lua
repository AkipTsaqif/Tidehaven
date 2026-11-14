-- Copy this FILE when designing a new sprite. Do not copy a Markdown-formatted catalog.
-- Supply ART_ROOT / OUT_DIR with real absolute paths; no change to simulation or save data.
local ART_ROOT = app.params.root or "D:/Projects/Tidehaven/art"
local OUT_DIR = assert(app.params.out, "pass an output directory")
local L = dofile(ART_ROOT .. "/iso_lib.lua")
local B = dofile(ART_ROOT .. "/biomes.lua")
local theme = B.apply(L, B.choose(app.params.scenario or "eden-growth-1", app.params.seed or "example"))
local C = L.C
local ID = "custom_home"
local A, Baxis, Hc = 48, 48, 104 -- three 32x16 base tiles per axis, not one 64x32 tile
local spr = L.new(OUT_DIR .. "/" .. ID .. ".aseprite", A+Baxis, Hc)
local gx, gy = Baxis, Hc-(A+Baxis)/2
local contexts = {}
for _, name in ipairs({"lot","shadow","props_back","building","details"}) do
  contexts[name] = L.ctx(spr, name, gx, gy)
  L.bounds(contexts[name], A, Baxis)
end
local lot, sh, bk, b, d = contexts.lot, contexts.shadow, contexts.props_back, contexts.building, contexts.details
L.lot(lot, A, Baxis, theme.ground, 11, 0.05)
L.flat(lot, 12, 24, 4, 20, C.DIRT[4])
L.shadow(sh, 8, 8, 16, 16, 4)
local h = L.box(b, 8, 8, 0, 16, 16, 12, theme.wall, {notop=true,base=true})
L.stripe(b,h.left,"dr",4,theme.wall[2])
L.stripe(b,h.right,"ur",4,theme.wall[1])
L.wallRect(b,h,"L",4,0,4,7,C.WOOD[2])
L.windows(b,h,"L",{u0=10,cols=1,w=2,h=3,v0=4,sill=theme.wall[5]})
L.windows(b,h,"R",{cols=2,w=2,h=3,gap=2,v0=4,sill=theme.wall[4]})
L.box(b,16,10,12,2,2,13,C.BRICK)
L.gable(b,8,8,12,16,16,8,"i",theme.roof,theme.wall,{o=2,rows=3})
B.plant(L,d,40,38,0,4,theme,21)
L.outline(bk); L.outline(b); L.outline(d)
for _, name in ipairs({"lot","shadow","props_back","building","details"}) do
  local ctx = contexts[name]
  assert(ctx.clipped == 0, name .. " was clipped")
  L.commit(ctx)
end
L.pivot(spr,A,Baxis)
L.save(spr)
L.png(spr,OUT_DIR .. "/" .. ID .. ".png")
print("OK " .. ID)
