-- Tidehaven tropical Eden mockup (original art). Run headless:
--   Aseprite.exe --batch --script art/map/eden-mockup.lua
-- 2:1 isometric, base tile 32x16 (one map cell = 32 px wide, 16 px tall).
-- Drawn entirely from code so the scene is reproducible; every random choice is seeded.

local OUT = app.params["out"] or "D:/Projects/Tidehaven/art/map/eden-mockup.aseprite"
local W, H = 256, 176

local function hex(s)
  return Color{ r = tonumber(s:sub(2,3),16), g = tonumber(s:sub(4,5),16), b = tonumber(s:sub(6,7),16), a = 255 }
end

-- Tropical palette. Light comes from the top-left: left faces lit, right faces shaded.
local P = {
  deep   = hex("#1B5C7A"), sea    = hex("#2A8BA8"), shallow = hex("#4FC1C9"), foam  = hex("#C8F2EE"),
  sandD  = hex("#C9A15E"), sand   = hex("#E8CE8B"), sandL   = hex("#F6E7B8"),
  grassD = hex("#3E8B3A"), grass  = hex("#5DB045"), grassL  = hex("#8BD25A"),
  leafD  = hex("#1F6B3A"), leaf   = hex("#2F9447"), leafL   = hex("#5CC25B"),
  trunk  = hex("#8A5A33"), trunkD = hex("#5E3B22"),
  wallL  = hex("#F3E2C2"), wallR  = hex("#C9AE85"),
  roofL  = hex("#D9673B"), roofR  = hex("#9E4128"), roofT   = hex("#F09060"),
  thatchL= hex("#E0B25A"), thatchR= hex("#A9792F"), thatchT = hex("#F2CF7E"),
  dark   = hex("#2B1B17"), window = hex("#3A6F8F"), shadow  = hex("#2E5E33"),
  path   = hex("#C79A62"), pathD  = hex("#A87E4C"),
  soil   = hex("#8C6239"), soilD  = hex("#6E4A2B"), crop    = hex("#9BD84E"), cropD = hex("#6FA834"),
  canvas = hex("#EDE6D3"), canvasD= hex("#BFB59C"), wood    = hex("#B07A45"), woodD = hex("#7C5230"),
  rope   = hex("#D9C49A"),
}

local spr = Sprite(W, H, ColorMode.RGB)
local img = Image(W, H, ColorMode.RGB)
spr.layers[1].name = "scene"

local function px(x, y, c)
  x, y = math.floor(x), math.floor(y)
  if x >= 0 and y >= 0 and x < W and y < H then img:drawPixel(x, y, c) end
end
local function at(x, y) return img:getPixel(math.floor(x), math.floor(y)) end

-- Deterministic per-pixel noise, so texture is identical on every run.
local function hash(a, b) local n = (a * 73856093 ~ b * 19349663) & 0x7fffffff return (n % 1000) / 1000 end

-- Map cell (u, v) -> screen point of the tile's top (back) vertex, and the inverse.
local OX, OY = 128, 24
local function tileTop(u, v) return OX + (u - v) * 16, OY + (u + v) * 8 end
local function toMap(x, y)
  local a, b = (x - OX) / 16, (y - OY) / 8
  return (a + b) / 2, (b - a) / 2
end

---------------------------------------------------------------------------------------------
-- 1. Terrain: a wobbly island sampled in map space, so the coast follows the iso grid.
---------------------------------------------------------------------------------------------
local CX, CY = 3.5, 3.5
local function coast(u, v) -- > 0 inside the island, distance in cells
  local du, dv = u - CX, v - CY
  local ang = math.atan(dv, du)
  local radius = 3.1 + 0.35 * math.sin(ang * 3 + 0.7) + 0.2 * math.sin(ang * 5 + 2.1)
  return radius - math.sqrt(du * du + dv * dv)
end

for y = 0, H - 1 do
  for x = 0, W - 1 do
    local d = coast(toMap(x, y))
    local c
    if d < -0.9 then c = (hash(x // 4, y // 2) > 0.97) and P.sea or P.deep
    elseif d < -0.45 then c = P.sea
    elseif d < -0.08 then c = P.shallow
    elseif d < 0 then c = P.foam
    elseif d < 0.12 then c = P.sandD
    elseif d < 0.55 then
      local n = hash(x, y)
      c = (n < 0.04) and P.sandD or (n > 0.96) and P.sandL or P.sand
    else
      local m = hash(x // 2, y) -- 2x1 clumps read as grass tufts when zoomed out
      c = (m < 0.07) and P.grassD or (m > 0.96) and P.grassL or P.grass
    end
    px(x, y, c)
  end
end

---------------------------------------------------------------------------------------------
-- 2. Drawing primitives
---------------------------------------------------------------------------------------------

-- Filled polygon by scanline. Iso-aligned vertices give clean 2:1 staircase edges.
local function poly(pts, c)
  local minY, maxY = math.huge, -math.huge
  for _, p in ipairs(pts) do minY = math.min(minY, p[2]); maxY = math.max(maxY, p[2]) end
  for y = math.floor(minY), math.ceil(maxY) do
    local xs, n = {}, #pts
    for i = 1, n do
      local a, b = pts[i], pts[i % n + 1]
      local yc = y + 0.5
      if (a[2] <= yc and b[2] > yc) or (b[2] <= yc and a[2] > yc) then
        xs[#xs + 1] = a[1] + (yc - a[2]) * (b[1] - a[1]) / (b[2] - a[2])
      end
    end
    table.sort(xs)
    for i = 1, #xs - 1, 2 do
      for x = math.floor(xs[i] + 0.5), math.floor(xs[i + 1] + 0.5) - 1 do px(x, y, c) end
    end
  end
end

local function line(x1, y1, x2, y2, c)
  local n = math.max(math.abs(x2 - x1), math.abs(y2 - y1))
  for i = 0, n do px(x1 + (x2 - x1) * i / n + 0.5, y1 + (y2 - y1) * i / n + 0.5, c) end
end

-- Footprint corners of a w x d box on cell (u, v), raised by z px: back, right, front, left.
local function corners(u, v, w, d, z)
  local bx, by = tileTop(u, v)
  return { bx, by - z }, { bx + 16 * w, by + 8 * w - z },
         { bx + 16 * (w - d), by + 8 * (w + d) - z }, { bx - 16 * d, by + 8 * d - z }
end

-- Soft ground shadow toward the bottom-right of a footprint (light from the top-left):
-- a checkerboard of the dark grass tone over grass only, so it reads as shade, not a slab.
local function groundShadow(u, v, w, d)
  local B, R, F, L = corners(u, v, w, d, 0)
  local function off(p, k) return { p[1] + 2 * k, p[2] + k } end
  local pts = { off(B, 3), off(R, 3), off(F, 3), off(L, 3) }
  local minX, maxX, minY, maxY = math.huge, -math.huge, math.huge, -math.huge
  for _, p in ipairs(pts) do
    minX, maxX = math.min(minX, p[1]), math.max(maxX, p[1])
    minY, maxY = math.min(minY, p[2]), math.max(maxY, p[2])
  end
  local grass = { [P.grass.rgbaPixel] = true, [P.grassD.rgbaPixel] = true, [P.grassL.rgbaPixel] = true }
  local before = img:clone()
  poly(pts, P.shadow)
  for y = math.floor(minY), math.ceil(maxY) do
    for x = math.floor(minX), math.ceil(maxX) do
      if at(x, y) == P.shadow.rgbaPixel then
        local was = before:getPixel(x, y)
        img:drawPixel(x, y, (grass[was] and (x + y) % 2 == 0) and P.grassD or was)
      end
    end
  end
end

-- Walls: left face (lit) and right face (shaded) of a w x d box, h px tall.
local function walls(u, v, w, d, h, cl, cr)
  local _, R, F, L = corners(u, v, w, d, 0)
  local _, Rt, Ft, Lt = corners(u, v, w, d, h)
  poly({ L, F, Ft, Lt }, cl)
  poly({ F, R, Rt, Ft }, cr)
  line(F[1], F[2], Ft[1], Ft[2], cr)                -- crisp corner edge
end

-- Hip-less gable roof over a w x d box of height h. The ridge runs along the w axis
-- (left-to-right in screen terms), so we see the long front slope and the right gable.
local function gable(u, v, w, d, h, rise, overhang, cFront, cBack, cGable, cRidge)
  local B, R, F, L = corners(u, v, w, d, h)
  -- Overhang: push the eave line forward (down-left along the d axis) a few px.
  local oF = { F[1] - overhang * 2, F[2] + overhang }
  local oL = { L[1] - overhang * 2, L[2] + overhang }
  local M1 = { (L[1] + B[1]) / 2, (L[2] + B[2]) / 2 - rise } -- ridge, left end
  local M2 = { (F[1] + R[1]) / 2, (F[2] + R[2]) / 2 - rise } -- ridge, right end
  poly({ M1, M2, R, B }, cBack)       -- back slope (a sliver shows above the ridge)
  poly({ F, R, M2 }, cGable)          -- gable end wall, same colour as the shaded wall
  poly({ oL, oF, M2, M1 }, cFront)    -- front slope with overhang
  -- Shading bands across the front slope give it the read of tiles / thatch.
  for k = 1, 3 do
    local t = k / 4
    local ax, ay = oL[1] + (M1[1] - oL[1]) * t, oL[2] + (M1[2] - oL[2]) * t
    local bx, by = oF[1] + (M2[1] - oF[1]) * t, oF[2] + (M2[2] - oF[2]) * t
    for i = 0, math.floor(bx - ax), 2 do px(ax + i, ay + (by - ay) * i / (bx - ax), cBack) end
  end
  line(M1[1], M1[2], M2[1], M2[2], cRidge)           -- ridge highlight
  line(oL[1], oL[2] + 1, oF[1], oF[2] + 1, P.dark)   -- eave shadow
end

-- Rectangles on a wall face. `off` = px along the face from its left end, `above` = px up
-- from the floor. The left face rises 1 px per 2 px to the right... going down (+1/2),
-- the right face goes up (-1/2), so each column follows the face slope.
local function onLeft(u, v, w, d, off, above, ww, hh, c)
  local _, _, _, L = corners(u, v, w, d, 0)
  for i = 0, ww - 1 do
    local x = L[1] + off + i
    local floorY = L[2] + (off + i) / 2
    for j = 0, hh - 1 do px(x, floorY - above - j, c) end
  end
end
local function onRight(u, v, w, d, off, above, ww, hh, c)
  local _, _, F, _ = corners(u, v, w, d, 0)
  for i = 0, ww - 1 do
    local x = F[1] + off + i
    local floorY = F[2] - (off + i) / 2
    for j = 0, hh - 1 do px(x, floorY - above - j, c) end
  end
end

---------------------------------------------------------------------------------------------
-- 3. Scene layout (map cells). The cottage is the heart; paths radiate to each place of work.
---------------------------------------------------------------------------------------------
local COTTAGE = { u = 2.5, v = 2.7, w = 2, d = 1, h = 12 }
local FARM    = { u = 4.0, v = 1.5, w = 2, d = 1.8 }
local SITE    = { u = 1.0, v = 3.5, w = 1, d = 1 }
local HUT     = { u = 4.5, v = 4.6, w = 1, d = 1, h = 9 }
local TENT    = { u = 1.9, v = 4.7 }

-- Areas that must stay free of vegetation: footprints plus a margin, in continuous map space.
-- Trees stand in front of (south of) a footprint more than behind it, so the margin is uneven.
local taken = {}
local function take(u, v, w, d) taken[#taken + 1] = { u - 0.6, v - 0.6, u + w + 0.9, v + d + 0.9 } end
take(COTTAGE.u, COTTAGE.v, COTTAGE.w, COTTAGE.d); take(FARM.u, FARM.v, FARM.w, FARM.d)
take(SITE.u, SITE.v, SITE.w, SITE.d); take(HUT.u, HUT.v, HUT.w, HUT.d); take(TENT.u, TENT.v, 1, 1)
local function isTaken(u, v)
  for _, r in ipairs(taken) do if u >= r[1] and u <= r[3] and v >= r[2] and v <= r[4] then return true end end
  return false
end

-- Ground features --------------------------------------------------------------------------

-- Path ribbon between two map points: a small diamond brush stamped along the line.
local function path(u1, v1, u2, v2)
  local steps = math.floor(math.max(math.abs(u2 - u1), math.abs(v2 - v1)) * 16) + 1
  for i = 0, steps do
    local t = i / steps
    local x, y = tileTop(u1 + (u2 - u1) * t, v1 + (v2 - v1) * t)
    for dy = -2, 2 do
      local span = 5 - math.abs(dy) * 2
      for dx = -span, span - 1 do
        local xx, yy = x + dx, y + dy
        if coast(toMap(xx, yy)) > 0.15 then px(xx, yy, (hash(xx, yy) > 0.85) and P.pathD or P.path) end
      end
    end
  end
end

local function farmField(f)
  local B, R, F, L = corners(f.u, f.v, f.w, f.d, 0)
  poly({ B, R, F, L }, P.soil)
  for y = math.floor(B[2]), math.ceil(F[2]) do
    for x = math.floor(L[1]), math.ceil(R[1]) do
      if at(x, y) == P.soil.rgbaPixel then
        local mu = toMap(x, y)
        if math.floor((mu - f.u) * 5) % 2 == 0 then px(x, y, P.soilD)           -- furrows along v
        elseif hash(x, y) > 0.5 then px(x, y, (hash(y, x) > 0.45) and P.crop or P.cropD) end
      end
    end
  end
  -- Raised rim on the two front edges so the field reads as a plot, not a texture.
  line(L[1], L[2], F[1], F[2], P.soilD); line(F[1], F[2], R[1], R[2], P.soilD)
end

local function dirtPad(s)
  local B, R, F, L = corners(s.u, s.v, s.w, s.d, 0)
  poly({ B, R, F, L }, P.path)
  for y = math.floor(B[2]), math.ceil(F[2]) do
    for x = math.floor(L[1]), math.ceil(R[1]) do
      if at(x, y) == P.path.rgbaPixel and hash(x, y) > 0.8 then px(x, y, P.pathD) end
    end
  end
end

path(COTTAGE.u + 0.9, COTTAGE.v + 1.5, FARM.u + 0.2, FARM.v + 1.6)
path(COTTAGE.u + 0.9, COTTAGE.v + 1.5, HUT.u + 0.4, HUT.v)
path(COTTAGE.u + 0.1, COTTAGE.v + 0.4, SITE.u + 0.6, SITE.v + 1.1)
path(COTTAGE.u + 0.1, COTTAGE.v + 1.0, TENT.u + 0.7, TENT.v + 0.2)
farmField(FARM)
dirtPad(SITE)
groundShadow(COTTAGE.u, COTTAGE.v, COTTAGE.w, COTTAGE.d)
groundShadow(HUT.u, HUT.v, HUT.w, HUT.d)

-- Standing objects are queued and drawn back to front by the y of their front-most point.
local stand = {}
local function add(baseY, fn) stand[#stand + 1] = { y = baseY, fn = fn } end

-- Cottage: whitewashed walls, terracotta roof, door + windows on the lit face.
do
  local c = COTTAGE
  local _, _, F, _ = corners(c.u, c.v, c.w, c.d, 0)
  add(F[2], function()
    walls(c.u, c.v, c.w, c.d, c.h, P.wallL, P.wallR)
    onLeft(c.u, c.v, c.w, c.d, 23, 0, 4, 8, P.dark)     -- door
    onLeft(c.u, c.v, c.w, c.d, 23, 8, 4, 1, P.woodD)    -- lintel
    onLeft(c.u, c.v, c.w, c.d, 7, 4, 4, 4, P.window)    -- windows with sills
    onLeft(c.u, c.v, c.w, c.d, 7, 3, 4, 1, P.wood)
    onLeft(c.u, c.v, c.w, c.d, 35, 4, 4, 4, P.window)
    onLeft(c.u, c.v, c.w, c.d, 35, 3, 4, 1, P.wood)
    onRight(c.u, c.v, c.w, c.d, 6, 4, 3, 4, P.window)
    gable(c.u, c.v, c.w, c.d, c.h, 10, 1, P.roofL, P.roofR, P.wallR, P.roofT)
    -- Chimney near the back of the ridge, with a wisp of smoke.
    local _, _, Ft, Lt = corners(c.u, c.v, c.w, c.d, c.h)
    local cx, cy = math.floor(Lt[1] + (Ft[1] - Lt[1]) * 0.3 + 4), math.floor(Lt[2] + (Ft[2] - Lt[2]) * 0.3 - 7)
    for i = 0, 5 do px(cx, cy - i, P.wallR); px(cx + 1, cy - i, P.wallR); px(cx + 2, cy - i, P.trunkD) end
    px(cx, cy - 6, P.dark); px(cx + 1, cy - 6, P.dark); px(cx + 2, cy - 6, P.dark)
    for i, d in ipairs({ {0, -8}, {1, -10}, {0, -12}, {2, -13}, {1, -15} }) do px(cx + d[1], cy + d[2], P.foam) end
  end)
end

-- Fishery hut (thatch) and its jetty over the shallows.
do
  local c = HUT
  local _, _, F, _ = corners(c.u, c.v, c.w, c.d, 0)
  local jx, jy = tileTop(c.u + 1, c.v + 0.6)
  add(jy + 8, function()
    for i = 0, 28 do
      px(jx + i, jy + i / 2, P.wood); px(jx + i, jy + i / 2 + 1, P.woodD)
      if i % 7 == 0 then for k = 2, 6 do px(jx + i, jy + i / 2 + k, P.woodD) end end
    end
  end)
  add(F[2], function()
    walls(c.u, c.v, c.w, c.d, c.h, P.wallL, P.wallR)
    onLeft(c.u, c.v, c.w, c.d, 6, 0, 3, 6, P.dark)
    gable(c.u, c.v, c.w, c.d, c.h, 8, 1, P.thatchL, P.thatchR, P.wallR, P.thatchT)
    -- Drying net on two poles beside the hut.
    local nx, ny = F[1] - 22, F[2] - 2
    for i = 0, 8 do px(nx, ny - i, P.woodD); px(nx + 10, ny - 5 - i, P.woodD) end
    for i = 0, 10 do for j = 0, 5, 2 do px(nx + i, ny - 8 - i / 2 + j, P.rope) end end
  end)
end

-- Building site: a timber frame on the dirt pad, a log pile beside it.
do
  local s = SITE
  local B, R, F, L = corners(s.u, s.v, s.w, s.d, 0)
  local Bt, Rt, Ft, Lt = corners(s.u, s.v, s.w, s.d, 13)
  add(F[2], function()
    for _, p in ipairs({ { B, Bt }, { R, Rt }, { L, Lt }, { F, Ft } }) do line(p[1][1], p[1][2], p[2][1], p[2][2], P.wood) end
    line(Lt[1], Lt[2], Ft[1], Ft[2], P.woodD); line(Ft[1], Ft[2], Rt[1], Rt[2], P.woodD)
    line(Lt[1], Lt[2], Bt[1], Bt[2], P.woodD); line(Bt[1], Bt[2], Rt[1], Rt[2], P.woodD)
    line(L[1], L[2], Ft[1], Ft[2], P.wood) -- diagonal brace
    for r = 0, 2 do
      for i = 0, 8 - r * 2 do
        px(F[1] + 5 + r + i, F[2] - 1 - r * 2, P.wood); px(F[1] + 5 + r + i, F[2] - r * 2, P.woodD)
      end
    end
  end)
end

-- A newcomer's tent.
do
  local x, y = tileTop(TENT.u + 0.5, TENT.v + 0.5)
  add(y + 3, function()
    for i = 0, 9 do for j = -i, i do px(x + j, y - 8 + i, (j < 0) and P.canvas or P.canvasD) end end
    for i = 0, 4 do px(x, y - 3 + i, P.dark) end
    line(x - 9, y + 1, x - 13, y + 3, P.rope); line(x + 9, y + 1, x + 13, y + 3, P.rope)
  end)
end

-- Vegetation ---------------------------------------------------------------------------------
local function palm(x, y, lean, height)
  for i = 0, height do
    local tx = x + math.floor(lean * (i / height) ^ 2 * 5 + 0.5)
    px(tx, y - i, (i % 3 == 0) and P.trunkD or P.trunk); px(tx + 1, y - i, P.trunkD)
  end
  local cx, cy = x + math.floor(lean * 5 + 0.5), y - height - 1
  for _, f in ipairs({ {-8, 2}, {-6, -2}, {-1, -5}, {5, -3}, {8, 2}, {3, 4}, {-4, 4} }) do
    local steps = math.max(math.abs(f[1]), math.abs(f[2])) * 2
    for s = 0, steps do
      local t = s / steps
      local fx = cx + f[1] * t
      local fy = cy + f[2] * t + 2.5 * t * t
      px(fx + 0.5, fy + 0.5, P.leaf); px(fx + 0.5, fy + 1.5, P.leafD)
      if t < 0.55 then px(fx + 0.5, fy - 0.5, P.leafL) end
    end
  end
  px(cx, cy + 1, P.trunkD); px(cx + 1, cy + 2, P.trunkD)
end

local function bush(x, y)
  for _, p in ipairs({ {0,0},{1,0},{2,0},{-1,1},{0,1},{1,1},{2,1},{3,1},{0,2},{1,2},{2,2} }) do px(x + p[1], y + p[2] - 3, P.leaf) end
  px(x, y - 3, P.leafL); px(x + 1, y - 3, P.leafL)
  for i = -1, 3 do px(x + i, y - 1, P.leafD) end
end

-- Seeded scatter: palms on the beach band, bushes on open grass, spaced apart, never on
-- taken cells. A fixed seed means the same island every run.
local seed = 20260211
local function rnd() seed = (seed * 1103515245 + 12345) & 0x7fffffff return seed / 0x7fffffff end
local placed = {}
local function farEnough(x, y, minD)
  for _, q in ipairs(placed) do if (q[1] - x) ^ 2 + ((q[2] - y) * 2) ^ 2 < minD * minD then return false end end
  return true
end
local palms, bushes = 0, 0
for _ = 1, 4000 do
  local u, v = rnd() * 7, rnd() * 7
  local d = coast(u, v)
  if not isTaken(u, v) then
    local x, y = tileTop(u, v)
    if d > 0.14 and d < 0.52 and palms < 12 and farEnough(x, y, 24) then
      placed[#placed + 1] = { x, y }; palms = palms + 1
      local lean, height = (rnd() < 0.5) and -1 or 1, 15 + math.floor(rnd() * 6)
      add(y, function() palm(x, y, lean, height) end)
    elseif d > 0.9 and bushes < 7 and farEnough(x, y, 16) then
      placed[#placed + 1] = { x, y }; bushes = bushes + 1
      add(y, function() bush(x, y) end)
    end
  end
end

table.sort(stand, function(a, b) return a.y < b.y end)
for _, s in ipairs(stand) do s.fn() end

-- Attach the finished image as the layer's cel (a new sprite starts with an empty cel).
spr:newCel(spr.layers[1], spr.frames[1], img, Point(0, 0))
spr:saveAs(OUT)
print("OK " .. OUT .. " palms=" .. palms .. " bushes=" .. bushes)
