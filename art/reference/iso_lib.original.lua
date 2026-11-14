-- iso_lib.lua — 2:1 isometric pixel-art helpers for Aseprite (RGB sprites)
-- Load with:  local L = dofile("/path/to/iso_lib.lua")
--
-- WORLD COORDS (pixels): i -> screen down-right, j -> screen down-left, z -> up.
-- 1 tile = 32 units of i or j (= one 64x32 diamond). Screen = (gx + i - j, gy + (i+j)/2 - z).
-- RULE: i, j, A, B, u, w, gap, o, p must be EVEN.  z, H, v, h, R, d may be any integer.
-- Polygons are filled by pixel-centre sampling, so shared edges never gap or double up.

local L = {}
L.TILE = 32

---------------------------------------------------------------- palette
-- ramp index: [1] outline/deep  [2] shade = RIGHT faces  [3] base = LEFT faces
--             [4] lit = TOP faces  [5] highlight (edges, glints)
L.RAMPS = {
  GRASS      = {"#1e3b2a","#2f5a32","#4a7d3a","#6fa046","#9cc45a"},
  FOLIAGE    = {"#132a1f","#1f4429","#2f6433","#4c8a3c","#7ab452"},
  DIRT       = {"#3b2a22","#5c3f2c","#7f5a3a","#a47a4e","#c9a06a"},
  WHEAT      = {"#4a3a14","#7a5e1e","#b08c2e","#d8b84a","#f0dc7a"},
  WATER      = {"#12305a","#1c4a7c","#2b6aa0","#4a90c0","#86c0e0"},
  CONCRETE   = {"#3a3f4a","#5a606b","#7f858e","#a7abb1","#cfd2d4"},
  ASPHALT    = {"#1f2128","#2c2f38","#3d414b","#535864","#6c7280"},
  BRICK      = {"#3a1a1e","#6a2a26","#94402f","#b8603f","#d68a5c"},
  PLASTER    = {"#5e5048","#8f7f6c","#bfae8e","#ddd0ad","#f2ead0"},
  WHITE      = {"#5a6170","#8d94a0","#b9bec6","#dde0e3","#f6f6f2"},
  WOOD       = {"#2f1f1a","#523426","#7a4e32","#a06d43","#c4925a"},
  BARN       = {"#2e1214","#561c1e","#86282a","#b03a30","#d0604a"},
  ROOF_RED   = {"#3d1418","#6b1f22","#9a2f2a","#c24a35","#e0704a"},
  ROOF_SLATE = {"#1c2433","#2c3a4f","#415470","#5d7491","#8199b3"},
  ROOF_GREEN = {"#1f3a38","#2e5a52","#3f7c6c","#5ea38a","#8cc7a6"},
  GLASS      = {"#14243a","#1f3d5c","#2f5f86","#4f8bb0","#8cc4dd"},
  GLASS_TEAL = {"#0f2a2e","#1a4a4c","#2a6e6a","#4a9c8e","#86cbb4"},
  STEEL      = {"#22262e","#3a404b","#5b6370","#848c98","#b4bac2"},
  RUST       = {"#2e1610","#522a18","#7a3f22","#a35c32","#c8834a"},
  IND_YELLOW = {"#4a3010","#7a5214","#b07e1c","#d9a72e","#f2d064"},
}

function L.hex(s)
  s = s:gsub("#", "")
  local r = tonumber(s:sub(1, 2), 16)
  local g = tonumber(s:sub(3, 4), 16)
  local b = tonumber(s:sub(5, 6), 16)
  local a = (#s >= 8) and tonumber(s:sub(7, 8), 16) or 255
  return app.pixelColor.rgba(r, g, b, a)
end

L.C = {}
for name, list in pairs(L.RAMPS) do
  local t = {}
  for k, h in ipairs(list) do t[k] = L.hex(h) end
  L.C[name] = t
end
L.OUTLINE = L.hex("#14161c")
L.SHADOW  = L.hex("#0000004c")
L.LIT     = L.hex("#f8d878")
L.BEACON  = L.hex("#ff3b30")
L.FLOWERS = { L.hex("#c8506a"), L.hex("#e8c84a"), L.hex("#f2f2f2"), L.hex("#8a5ac8") }

---------------------------------------------------------------- sprite & layers
-- New sprite with the standard layer stack (bottom -> top). Overwrites the file.
function L.new(path, w, h)
  local spr = Sprite(w, h, ColorMode.RGB)
  spr.layers[1].name = "lot"
  for _, n in ipairs({"shadow", "props_back", "building", "details"}) do
    local l = spr:newLayer()
    l.name = n
  end
  spr:saveAs(path)
  return spr
end

function L.open(path)
  local spr = app.activeSprite
  if spr and spr.filename == path then return spr end
  return app.open(path)
end

function L.layer(spr, name)
  for _, l in ipairs(spr.layers) do
    if l.name == name then return l end
  end
  local l = spr:newLayer()
  l.name = name
  return l
end

-- Drawing context for one layer. Draw into it, then call L.commit(c).
function L.ctx(spr, layerName, gx, gy, frameNo)
  local layer = L.layer(spr, layerName)
  local frame = spr.frames[frameNo or 1]
  local img = Image(spr.width, spr.height, ColorMode.RGB)
  local cel = layer:cel(frame)
  if cel then
    img:drawImage(cel.image, cel.position)
  else
    cel = spr:newCel(layer, frame)
  end
  return { spr = spr, cel = cel, img = img, gx = gx, gy = gy, w = spr.width, h = spr.height }
end

function L.commit(c)
  c.cel.image = c.img
  c.cel.position = Point(0, 0)
end

function L.save(spr) spr:saveAs(spr.filename) end
function L.png(spr, path) spr:saveCopyAs(path) end   -- flattened PNG of visible layers

-- Slice "footprint" whose pivot is the bottom vertex of the lot diamond (for game engines).
function L.pivot(spr, A, B)
  local s = spr:newSlice(Rectangle(0, 0, spr.width, spr.height))
  s.name = "footprint"
  s.pivot = Point(A, spr.height)
end

---------------------------------------------------------------- raster core
function L.P(c, i, j, z)
  return { c.gx + i - j, c.gy + (i + j) / 2 - (z or 0) }
end

function L.px(c, x, y, col)
  x, y = math.floor(x), math.floor(y)
  if x >= 0 and y >= 0 and x < c.w and y < c.h then c.img:drawPixel(x, y, col) end
end

function L.dot(c, i, j, z, col)
  local p = L.P(c, i, j, z)
  L.px(c, p[1], p[2], col)
end

local function inPoly(pts, px, py)
  local inside = false
  local n = #pts
  local k = n
  for i = 1, n do
    local xi, yi = pts[i][1], pts[i][2]
    local xk, yk = pts[k][1], pts[k][2]
    if (yi > py) ~= (yk > py) then
      local xc = (xk - xi) * (py - yi) / (yk - yi) + xi
      if px < xc then inside = not inside end
    end
    k = i
  end
  return inside
end

-- Fill a SCREEN polygon {{x,y},...}. col may be nil (mask only). Returns mask[y][x] = true.
function L.poly(c, pts, col)
  local x0, x1, y0, y1 = math.huge, -math.huge, math.huge, -math.huge
  for _, p in ipairs(pts) do
    x0 = math.min(x0, p[1]); x1 = math.max(x1, p[1])
    y0 = math.min(y0, p[2]); y1 = math.max(y1, p[2])
  end
  local mask = {}
  for y = math.floor(y0), math.ceil(y1) - 1 do
    for x = math.floor(x0), math.ceil(x1) - 1 do
      if inPoly(pts, x + 0.5, y + 0.5) then
        mask[y] = mask[y] or {}
        mask[y][x] = true
        if col then L.px(c, x, y, col) end
      end
    end
  end
  return mask
end

-- Fill a WORLD polygon {{i,j,z},...}. Returns mask.
function L.quad(c, wpts, col)
  local s = {}
  for k, w in ipairs(wpts) do s[k] = L.P(c, w[1], w[2], w[3]) end
  return L.poly(c, s, col)
end

local function has(m, x, y) return m[y] ~= nil and m[y][x] == true end
L.has = has

function L.fill(c, m, col)
  for y, row in pairs(m) do for x in pairs(row) do L.px(c, x, y, col) end end
end

function L.union(...)
  local out = {}
  for _, m in ipairs({...}) do
    for y, row in pairs(m) do
      out[y] = out[y] or {}
      for x in pairs(row) do out[y][x] = true end
    end
  end
  return out
end

-- Paint the boundary pixels of a mask on one side: "bottom","top","left","right","all".
function L.edge(c, m, side, col)
  local list = {}
  for y, row in pairs(m) do
    for x in pairs(row) do
      local e
      if side == "bottom" then e = not has(m, x, y + 1)
      elseif side == "top" then e = not has(m, x, y - 1)
      elseif side == "left" then e = not has(m, x - 1, y)
      elseif side == "right" then e = not has(m, x + 1, y)
      else e = not (has(m, x, y + 1) and has(m, x, y - 1) and has(m, x - 1, y) and has(m, x + 1, y)) end
      if e then list[#list + 1] = {x, y} end
    end
  end
  for _, p in ipairs(list) do L.px(c, p[1], p[2], col) end
end

-- Line texture inside a mask. dir: "dr" (down-right 2:1 lines, left-wall courses / ridge along i),
-- "ur" (up-right 2:1 lines, right-wall courses / ridge along j), "h" rows, "v" columns.
function L.stripe(c, m, dir, period, col, phase)
  phase = phase or 0
  for y, row in pairs(m) do
    for x in pairs(row) do
      local hit
      if dir == "dr" then hit = (2 * y - x + phase) % (2 * period) < 2
      elseif dir == "ur" then hit = (2 * y + x + phase) % (2 * period) < 2
      elseif dir == "h" then hit = (y + phase) % period == 0
      else hit = (x + phase) % period == 0 end
      if hit then L.px(c, x, y, col) end
    end
  end
end

-- Deterministic random dots inside a mask (grass, gravel, flowers, wear).
function L.speckle(c, m, density, col, seed)
  math.randomseed(seed or 1)
  local ys = {}
  for y in pairs(m) do ys[#ys + 1] = y end
  table.sort(ys)
  for _, y in ipairs(ys) do
    local xs = {}
    for x in pairs(m[y]) do xs[#xs + 1] = x end
    table.sort(xs)
    for _, x in ipairs(xs) do
      if math.random() < density then L.px(c, x, y, col) end
    end
  end
end

function L.ellipse(c, cx, cy, rx, ry, col)
  local m = {}
  if rx <= 0 or ry <= 0 then return m end
  for y = math.floor(cy - ry), math.ceil(cy + ry) - 1 do
    for x = math.floor(cx - rx), math.ceil(cx + rx) - 1 do
      local dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
      if dx * dx + dy * dy <= 1 then
        L.px(c, x, y, col)
        m[y] = m[y] or {}
        m[y][x] = true
      end
    end
  end
  return m
end

---------------------------------------------------------------- ground
function L.flat(c, i0, j0, A, B, col, z)
  z = z or 0
  return L.quad(c, {{i0, j0, z}, {i0 + A, j0, z}, {i0 + A, j0 + B, z}, {i0, j0 + B, z}}, col)
end

-- Whole-lot ground with texture. density default 0.10 (use 0.05 for paved lots).
function L.lot(c, A, B, ramp, seed, density)
  density = density or 0.10
  local m = L.flat(c, 0, 0, A, B, ramp[4])
  L.speckle(c, m, density, ramp[3], seed or 1)
  L.speckle(c, m, density * 0.4, ramp[5], (seed or 1) + 7)
  return m
end

-- Box ground shadow, cast toward -j (screen up-right). Keep s <= j0 so it stays on the lot.
function L.shadow(c, i0, j0, A, B, s, col)
  return L.quad(c, {{i0, j0 - s, 0}, {i0 + A, j0 - s, 0}, {i0 + A, j0 + B, 0}, {i0, j0 + B, 0}}, col or L.SHADOW)
end

function L.treeShadow(c, i, j, size, col)
  local p = L.P(c, i, j - size, 0)
  return L.ellipse(c, p[1], p[2], size, size / 2, col or L.SHADOW)
end

---------------------------------------------------------------- volumes
-- Solid box. (i0,j0,z0) = back corner of its footprint; A along i, B along j, H tall.
-- Faces: left (j = j0+B) = wall[3], right (i = i0+A) = wall[2], top = wall[4].
-- opt: notop=true (a roof goes on top), base=true (dark foot line), edge=false, corner=false,
--      parapet={p=2, d=2, floor=RAMP} (flat roof with a raised rim; roof floor is at z0+H-d).
-- Returns {left, right, top, roof, i0, j0, z0, A, B, H}.
function L.box(c, i0, j0, z0, A, B, H, wall, opt)
  opt = opt or {}
  local z1 = z0 + H
  local m = { i0 = i0, j0 = j0, z0 = z0, A = A, B = B, H = H }
  local pp = opt.parapet
  if pp then
    local p, d = pp.p or 2, pp.d or 2
    local fl = pp.floor or L.C.CONCRETE
    m.roof = L.quad(c, {{i0 + p, j0 + p, z1 - d}, {i0 + A - p, j0 + p, z1 - d},
                        {i0 + A - p, j0 + B - p, z1 - d}, {i0 + p, j0 + B - p, z1 - d}}, fl[3])
    L.quad(c, {{i0 + p, j0 + p, z1 - d}, {i0 + p, j0 + B - p, z1 - d}, {i0 + p, j0 + B - p, z1}, {i0 + p, j0 + p, z1}}, wall[2])
    L.quad(c, {{i0 + p, j0 + p, z1 - d}, {i0 + A - p, j0 + p, z1 - d}, {i0 + A - p, j0 + p, z1}, {i0 + p, j0 + p, z1}}, wall[3])
  end
  m.left  = L.quad(c, {{i0, j0 + B, z0}, {i0 + A, j0 + B, z0}, {i0 + A, j0 + B, z1}, {i0, j0 + B, z1}}, wall[3])
  m.right = L.quad(c, {{i0 + A, j0, z0}, {i0 + A, j0 + B, z0}, {i0 + A, j0 + B, z1}, {i0 + A, j0, z1}}, wall[2])
  if opt.base then
    L.edge(c, m.left, "bottom", wall[1])
    L.edge(c, m.right, "bottom", wall[1])
  end
  if opt.corner ~= false then L.edge(c, m.left, "right", wall[4]) end
  if pp then
    local p, t = pp.p or 2, wall[4]
    L.quad(c, {{i0, j0, z1}, {i0 + p, j0, z1}, {i0 + p, j0 + B, z1}, {i0, j0 + B, z1}}, t)
    L.quad(c, {{i0, j0, z1}, {i0 + A, j0, z1}, {i0 + A, j0 + p, z1}, {i0, j0 + p, z1}}, t)
    local f1 = L.quad(c, {{i0, j0 + B - p, z1}, {i0 + A, j0 + B - p, z1}, {i0 + A, j0 + B, z1}, {i0, j0 + B, z1}}, t)
    local f2 = L.quad(c, {{i0 + A - p, j0, z1}, {i0 + A, j0, z1}, {i0 + A, j0 + B, z1}, {i0 + A - p, j0 + B, z1}}, t)
    if opt.edge ~= false then L.edge(c, L.union(f1, f2), "bottom", wall[5]) end
  elseif not opt.notop then
    m.top = L.quad(c, {{i0, j0, z1}, {i0 + A, j0, z1}, {i0 + A, j0 + B, z1}, {i0, j0 + B, z1}}, wall[4])
    if opt.edge ~= false then L.edge(c, m.top, "bottom", wall[5]) end
  end
  return m
end

-- Vertical cylinder at world centre (ic, jc), base z0, screen radius r (px), height H.
-- opt: dome=true, matte=true (no specular stripe), cap=colour, hole=colour (dark opening).
function L.cyl(c, ic, jc, z0, r, H, ramp, opt)
  opt = opt or {}
  local p = L.P(c, ic, jc, z0)
  local cx, cy = p[1], p[2]
  local ry = r / 2
  local ty = cy - H
  local m = {}
  for x = math.floor(cx - r), math.ceil(cx + r) - 1 do
    local dx = (x + 0.5 - cx) / r
    if dx > -1 and dx < 1 then
      local e = ry * math.sqrt(1 - dx * dx)
      local t = (dx + 1) / 2
      local col
      if t < 0.12 then col = ramp[3]
      elseif t < 0.38 then col = ramp[4]
      elseif t < 0.46 and not opt.matte then col = ramp[5]
      elseif t < 0.68 then col = ramp[3]
      elseif t < 0.9 then col = ramp[2]
      else col = ramp[1] end
      for y = math.floor(ty), math.ceil(cy + e) - 1 do
        local yc = y + 0.5
        if yc >= ty and yc <= cy + e then
          L.px(c, x, y, col)
          m[y] = m[y] or {}
          m[y][x] = true
        end
      end
    end
  end
  L.ellipse(c, cx, ty, r, ry, opt.cap or ramp[4])
  if opt.hole and r >= 3 then L.ellipse(c, cx, ty, r - 2, math.max(1, ry - 1), opt.hole) end
  if opt.dome then
    local hd = r * 0.8
    for y = math.floor(ty - hd), math.ceil(ty) - 1 do
      for x = math.floor(cx - r), math.ceil(cx + r) - 1 do
        local dx, dy = (x + 0.5 - cx) / r, (y + 0.5 - ty) / hd
        if dx * dx + dy * dy <= 1 then
          local l = -dx * 0.7 - dy * 0.5
          local col = ramp[2]
          if l > 0.55 then col = ramp[5] elseif l > 0.15 then col = ramp[4] elseif l > -0.3 then col = ramp[3] end
          L.px(c, x, y, col)
        end
      end
    end
  end
  return m
end

---------------------------------------------------------------- roofs
-- All roofs sit on a box whose walls end at z0. o = overhang (even, default 2).
-- Gable: axis "i" = ridge along i (B must be a multiple of 4), gable triangle on the RIGHT face.
--        axis "j" = ridge along j (A must be a multiple of 4), gable triangle on the LEFT face.
-- opt: {o=2, rows=3}  rows = tile/seam line spacing (nil = none). Returns {front, gable, back}.
function L.gable(c, i0, j0, z0, A, B, R, axis, roof, wall, opt)
  opt = opt or {}
  local o = opt.o or 2
  local a0, a1, b0, b1 = i0 - o, i0 + A + o, j0 - o, j0 + B + o
  local ze = z0 - ((o > 0) and 1 or 0)
  local zr = z0 + R
  local m = {}
  if axis == "i" then
    local jm = j0 + B / 2
    m.back  = L.quad(c, {{a0, b0, ze}, {a1, b0, ze}, {a1, jm, zr}, {a0, jm, zr}}, roof[2])
    m.gable = L.quad(c, {{i0 + A, j0, z0}, {i0 + A, j0 + B, z0}, {i0 + A, jm, zr}}, wall[2])
    m.front = L.quad(c, {{a0, b1, ze}, {a1, b1, ze}, {a1, jm, zr}, {a0, jm, zr}}, roof[4])
    if opt.rows then L.stripe(c, m.front, "dr", opt.rows, roof[3]) end
  else
    local im = i0 + A / 2
    m.back  = L.quad(c, {{a0, b0, ze}, {a0, b1, ze}, {im, b1, zr}, {im, b0, zr}}, roof[2])
    m.gable = L.quad(c, {{i0, j0 + B, z0}, {i0 + A, j0 + B, z0}, {im, j0 + B, zr}}, wall[3])
    m.front = L.quad(c, {{a1, b0, ze}, {a1, b1, ze}, {im, b1, zr}, {im, b0, zr}}, roof[3])
    if opt.rows then L.stripe(c, m.front, "ur", opt.rows, roof[2]) end
  end
  L.edge(c, m.front, "bottom", roof[1])
  L.edge(c, m.front, "top", roof[5])
  return m
end

-- Hip roof (pyramid when A == B). min(A, B) must be a multiple of 4. opt: {o=2, rows=3}
function L.hip(c, i0, j0, z0, A, B, R, roof, opt)
  opt = opt or {}
  local o = opt.o or 2
  local a0, a1, b0, b1 = i0 - o, i0 + A + o, j0 - o, j0 + B + o
  local ze = z0 - ((o > 0) and 1 or 0)
  local zr = z0 + R
  local m = {}
  if A >= B then
    local jm, h = j0 + B / 2, B / 2
    local r0, r1 = i0 + h, i0 + A - h
    L.quad(c, {{a0, b0, ze}, {a1, b0, ze}, {r1, jm, zr}, {r0, jm, zr}}, roof[2])
    L.quad(c, {{a0, b0, ze}, {a0, b1, ze}, {r0, jm, zr}}, roof[2])
    m.side  = L.quad(c, {{a1, b0, ze}, {a1, b1, ze}, {r1, jm, zr}}, roof[2])
    m.front = L.quad(c, {{a0, b1, ze}, {a1, b1, ze}, {r1, jm, zr}, {r0, jm, zr}}, roof[4])
    if opt.rows then L.stripe(c, m.front, "dr", opt.rows, roof[3]); L.stripe(c, m.side, "ur", opt.rows, roof[1]) end
  else
    local im, h = i0 + A / 2, A / 2
    local r0, r1 = j0 + h, j0 + B - h
    L.quad(c, {{a0, b0, ze}, {a0, b1, ze}, {im, r1, zr}, {im, r0, zr}}, roof[2])
    L.quad(c, {{a0, b0, ze}, {a1, b0, ze}, {im, r0, zr}}, roof[2])
    m.side  = L.quad(c, {{a0, b1, ze}, {a1, b1, ze}, {im, r1, zr}}, roof[4])
    m.front = L.quad(c, {{a1, b0, ze}, {a1, b1, ze}, {im, r1, zr}, {im, r0, zr}}, roof[3])
    if opt.rows then L.stripe(c, m.front, "ur", opt.rows, roof[2]); L.stripe(c, m.side, "dr", opt.rows, roof[3]) end
  end
  L.edge(c, m.front, "bottom", roof[1])
  L.edge(c, m.side, "bottom", roof[1])
  L.edge(c, m.front, "top", roof[5])
  return m
end

-- Mono-pitch roof: high at the back (j0), low at the front (j0+B). opt: {o=2, rows=3}
function L.shed(c, i0, j0, z0, A, B, R, roof, wall, opt)
  opt = opt or {}
  local o = opt.o or 2
  local a0, a1, b0, b1 = i0 - o, i0 + A + o, j0 - o, j0 + B + o
  local ze = z0 - ((o > 0) and 1 or 0)
  local m = {}
  m.side  = L.quad(c, {{i0 + A, j0, z0}, {i0 + A, j0 + B, z0}, {i0 + A, j0, z0 + R}}, wall[2])
  m.front = L.quad(c, {{a0, b0, z0 + R}, {a1, b0, z0 + R}, {a1, b1, ze}, {a0, b1, ze}}, roof[4])
  if opt.rows then L.stripe(c, m.front, "dr", opt.rows, roof[3]) end
  L.edge(c, m.front, "bottom", roof[1])
  L.edge(c, m.front, "top", roof[5])
  return m
end

---------------------------------------------------------------- facade
-- Rectangle on a wall face of a box. side "L" (face j = j0+B) or "R" (face i = i0+A).
-- u = offset from the wall's screen-left end (even), v = height above box z0, w (even) x h.
function L.wallRect(c, box, side, u, v, w, h, col)
  local z = box.z0 + v
  if side == "L" then
    local j, i = box.j0 + box.B, box.i0 + u
    return L.quad(c, {{i, j, z}, {i + w, j, z}, {i + w, j, z + h}, {i, j, z + h}}, col)
  else
    local i, ja = box.i0 + box.A, box.j0 + box.B - u
    return L.quad(c, {{i, ja, z}, {i, ja - w, z}, {i, ja - w, z + h}, {i, ja, z + h}}, col)
  end
end

-- Window grid. o = {cols, rows=1, w, h, gap=2, v0, dv=0, glass=RAMP, sill=colour,
--                   lit=colour, litChance=0.2, seed=1, u0=nil (nil = auto-centre)}
-- Symmetric centring needs (wall length - (cols*w + (cols-1)*gap)) divisible by 4.
function L.windows(c, box, side, o)
  local len = (side == "L") and box.A or box.B
  local gap, dv = o.gap or 2, o.dv or 0
  local total = o.cols * o.w + (o.cols - 1) * gap
  local u0 = o.u0 or (math.floor((len - total) / 4) * 2)
  local g = o.glass or L.C.GLASS
  math.randomseed(o.seed or 1)
  for r = 0, (o.rows or 1) - 1 do
    for k = 0, o.cols - 1 do
      local u, v = u0 + k * (o.w + gap), o.v0 + r * dv
      local lit = o.lit and (math.random() < (o.litChance or 0.2))
      local m = L.wallRect(c, box, side, u, v, o.w, o.h, lit and o.lit or g[3])
      if not lit then
        L.edge(c, m, "top", g[4])
        if side == "L" then L.edge(c, m, "left", g[5]) else L.edge(c, m, "right", g[1]) end
      end
      if o.sill then L.wallRect(c, box, side, u, v - 1, o.w, 1, o.sill) end
    end
  end
end

-- Sloped awning sticking out of a wall. depth even; drop = how far the front edge hangs down.
function L.awning(c, box, side, u, v, w, depth, drop, ramp, stripeCol)
  local z = box.z0 + v
  local m
  if side == "L" then
    local j, i = box.j0 + box.B, box.i0 + u
    m = L.quad(c, {{i, j, z}, {i + w, j, z}, {i + w, j + depth, z - drop}, {i, j + depth, z - drop}}, ramp[4])
  else
    local i, ja = box.i0 + box.A, box.j0 + box.B - u
    m = L.quad(c, {{i, ja, z}, {i, ja - w, z}, {i + depth, ja - w, z - drop}, {i + depth, ja, z - drop}}, ramp[3])
  end
  if stripeCol then
    L.stripe(c, m, "v", 4, stripeCol, 0)
    L.stripe(c, m, "v", 4, stripeCol, 1)
  end
  L.edge(c, m, "bottom", ramp[1])
  return m
end

---------------------------------------------------------------- plants
local function canopy(c, cx, cy, r, leaf, seed)
  math.randomseed(seed or 1)
  for y = math.floor(cy - r) - 1, math.ceil(cy + r) do
    for x = math.floor(cx - r) - 1, math.ceil(cx + r) do
      local dx, dy = (x + 0.5 - cx) / r, (y + 0.5 - cy) / r
      if dx * dx + dy * dy <= 1 + (math.random() - 0.5) * 0.3 then
        local l = -dx * 0.6 - dy * 0.8 + (math.random() - 0.5) * 0.35
        local col = leaf[2]
        if l > 0.6 then col = leaf[5] elseif l > 0.15 then col = leaf[4] elseif l > -0.35 then col = leaf[3] end
        L.px(c, x, y, col)
      end
    end
  end
end

function L.tree(c, i, j, z0, size, leaf, trunk, seed)
  local p = L.P(c, i, j, z0 or 0)
  local x, y = math.floor(p[1]), math.floor(p[2])
  local th = math.max(2, math.floor(size * 0.6))
  for k = 1, th do
    L.px(c, x - 1, y - k, trunk[3])
    L.px(c, x, y - k, trunk[2])
  end
  canopy(c, x, y - th - size + 1, size, leaf, seed)
end

function L.bush(c, i, j, size, leaf, seed)
  local p = L.P(c, i, j, 0)
  canopy(c, math.floor(p[1]), math.floor(p[2]) - size + 1, size, leaf, seed)
end

---------------------------------------------------------------- finishing
-- 1px outline around every opaque region of the layer.
function L.outline(c, col)
  col = col or L.OUTLINE
  local img, W, H = c.img, c.w, c.h
  local alpha = app.pixelColor.rgbaA
  local function solid(x, y)
    return x >= 0 and y >= 0 and x < W and y < H and alpha(img:getPixel(x, y)) > 0
  end
  local pts = {}
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if not solid(x, y) and (solid(x - 1, y) or solid(x + 1, y) or solid(x, y - 1) or solid(x, y + 1)) then
        pts[#pts + 1] = {x, y}
      end
    end
  end
  for _, p in ipairs(pts) do img:drawPixel(p[1], p[2], col) end
end

return L