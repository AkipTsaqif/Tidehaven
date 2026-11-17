-- art/expansion/families/towers.lua
-- Vertical buildings.  This task owns the HOME tiers 4..8 only; every other function still runs the
-- untouched starter geometry (kept verbatim as otherTower below) so shop / clinic / court / council
-- outputs stay byte-identical.
--
-- Housing identity (must survive greyscale): masonry plinth and buttresses, timber balconies and
-- galleries, tiled or parapet rooflets, domestic windows with shutters and sills, laundry, shared
-- garden terraces and a courtyard, human-scale entrances.  No glass curtain walls, no single slab:
-- every tier is a different composition of podium, shafts, wings, setbacks and crown.
--
-- Biome shape differences (not recolours):
--   tropical  : wide ventilated verandas under shade roofs, open galleries, palm terraces
--   temperate : timber-framed balconies, pitched tiled rooflets, broadleaf roof gardens
--   arid      : recessed windows, adobe mass, flat parapet roofs, shaded courts, cactus
--   northern  : steep rooflets, sheltered galleries, narrow windows, pine terraces
--
-- Geometry stays inside the catalog lot (L.box/L.flat assert the footprint) and inside the bitmap
-- (build.lua rejects canvas-edge contact), so every mass is inset from the lot's side vertices.

local F = {}

-- ------------------------------------------------------------------ untouched starter branch
-- Verbatim starter geometry. Any non-home function is drawn exactly as before this task.
local function otherTower(L, B, c, theme, s)
  local A, D = s.A, s.B
  L.flat(c.lot, 2, 2, A - 4, D - 4, theme.ground[4])
  local baseH = ({ [4] = 42, [5] = 84, [6] = 144, [7] = 244, [8] = 424 })[s.tier]
  local tiers = s.tier - 1
  for n = 0, tiers - 1 do
    local inset = 6 + n * 4
    local w, d = A - inset * 2, D - inset * 2
    if w >= 8 and d >= 8 then
      local z = math.floor(baseH * n / tiers)
      local h = math.floor(baseH / tiers) + 2
      local wall = s.kind == 'clinic' and L.C.WHITE or theme.wall
      local box = L.box(c.building, inset, inset, z, w, d, h, wall,
        { base = true, parapet = { p = 2, d = 2, floor = theme.roof } })
      local cols = math.max(1, math.floor((w - 4) / 6))
      for v = 4, h - 5, 9 do
        L.windows(c.building, box, 'L', { cols = cols, w = 2, h = 3, gap = 4, v0 = v, sill = wall[4] })
      end
      cols = math.max(1, math.floor((d - 4) / 6))
      for v = 4, h - 5, 9 do
        L.windows(c.building, box, 'R', { cols = cols, w = 2, h = 3, gap = 4, v0 = v, sill = wall[3] })
      end
    end
  end
  L.box(c.details, A / 2 - 4, D - 12, 0, 8, 8, 10, L.C.WOOD, { base = true })
end

-- ------------------------------------------------------------------ housing styles
-- storey   : implied floor height in world units (heights guide proportion, not capacity)
-- winW/winH: domestic window size; northern/arid are deliberately narrower
-- veranda  : balcony projection depth (0 = none)
-- pitch    : rooflet rise (0 = flat parapet roof)
-- recess   : draw a shadowed reveal around each window (arid)
local STYLE = {
  tropical = {
    storey = 15, winW = 2, winH = 3, veranda = 3, pitch = 5, recess = false, shutters = true,
    balcony = true, balconyEvery = 2, gallerySide = 'R', galleryEvery = 3, shade = true,
  },
  temperate = {
    storey = 14, winW = 2, winH = 3, veranda = 2, pitch = 6, recess = false, shutters = true,
    balcony = true, balconyEvery = 3, gallerySide = nil, galleryEvery = 0,
  },
  arid = {
    storey = 15, winW = 1, winH = 2, veranda = 0, pitch = 0, recess = true, shutters = false,
    balcony = false, balconyEvery = 0, gallerySide = nil, galleryEvery = 0,
  },
  northern = {
    storey = 14, winW = 1, winH = 3, veranda = 1, pitch = 7, recess = false, shutters = false,
    balcony = false, balconyEvery = 0, gallerySide = 'L', galleryEvery = 2,
  },
}

-- ------------------------------------------------------------------ face helpers
-- Rectangle on a wall face. Same geometry as L.wallRect but without the even-value assertion, so
-- 1 px shutters, rails and reveals are possible.
local function faceRect(L, c, box, side, u, v, w, h, col)
  local z = box.z0 + v
  if side == 'L' then
    local j, i = box.j0 + box.B, box.i0 + u
    return L.quad(c, { { i, j, z }, { i + w, j, z }, { i + w, j, z + h }, { i, j, z + h } }, col)
  end
  local i, ja = box.i0 + box.A, box.j0 + box.B - u
  return L.quad(c, { { i, ja, z }, { i, ja - w, z }, { i, ja - w, z + h }, { i, ja, z + h } }, col)
end

-- One domestic window: reveal (arid), glass, lit head, sill, shutters.
local function win(L, c, box, side, u, v, w, h, st, theme, opt)
  opt = opt or {}
  local wall = opt.wall or theme.wall
  local glass = opt.glass or L.C.GLASS
  if st.recess then faceRect(L, c, box, side, u - 1, v - 1, w + 2, h + 2, wall[1]) end
  faceRect(L, c, box, side, u, v, w, h, opt.lit and L.LIT or glass[3])
  faceRect(L, c, box, side, u, v + h - 1, w, 1, opt.lit and L.LIT or glass[4])
  faceRect(L, c, box, side, u, v - 1, w, 1, theme.wall[5])
  if st.shutters and not opt.noShut then
    faceRect(L, c, box, side, u - 1, v, 1, h, theme.roof[3])
    faceRect(L, c, box, side, u + w, v, 1, h, theme.roof[2])
  end
end

-- Laundry / awning cloth hanging under a rail: 1-2 px strips in domestic colours.
local function laundry(L, c, box, side, u, v, n, seed, theme)
  local cloths = { L.C.WHITE[4], theme.roof[4], L.FLOWERS[1], L.C.WHITE[3], L.FLOWERS[2] }
  for k = 1, n do
    local off = u + ((k * 3 + seed) % 7)
    local col = cloths[(k + seed) % #cloths + 1]
    local hgt = 2 + ((k + seed) % 2)
    faceRect(L, c, box, side, off, v - hgt, 1, hgt, col)
  end
end

-- Projecting timber balcony.
-- HEIGHT CONTRACT: `v` here is a floor-LOCAL height above the mass base, exactly like faceRect.
-- Every world-space quad below therefore uses zw = box.z0 + v, so a balcony on an elevated block
-- sits at its own floor instead of falling back to the lower storeys.  Laundry is drawn through
-- faceRect, which adds box.z0 itself, so it is given the LOCAL height and never double-adds.
local function balcony(L, c, box, side, u, v, w, depth, st, theme, seed, hangLaundry)
  local wood = L.C.WOOD
  local d = math.max(1, depth)
  local zw = box.z0 + v
  if side == 'L' then
    local J, i = box.j0 + box.B, box.i0 + u
    L.quad(c, { { i, J, zw }, { i + w, J, zw }, { i + w, J + d, zw }, { i, J + d, zw } }, wood[4])
    L.quad(c, { { i, J + d, zw - 1 }, { i + w, J + d, zw - 1 }, { i + w, J + d, zw }, { i, J + d, zw } }, wood[3])
    L.quad(c, { { i, J, zw - 1 }, { i + w, J, zw - 1 }, { i + w, J, zw }, { i, J, zw } }, wood[2])
    for k = 0, w - 1, 3 do
      L.quad(c, { { i + k, J + d, zw }, { i + k + 1, J + d, zw }, { i + k + 1, J + d, zw + 3 },
        { i + k, J + d, zw + 3 } }, wood[3])
    end
    L.quad(c, { { i, J + d, zw + 3 }, { i + w, J + d, zw + 3 }, { i + w, J + d, zw + 4 },
      { i, J + d, zw + 4 } }, wood[5])
    if st.shade then
      L.quad(c, { { i - 1, J - 1, zw + 6 }, { i + w + 1, J - 1, zw + 6 },
        { i + w + 1, J + d + 1, zw + 5 }, { i - 1, J + d + 1, zw + 5 } }, theme.roof[3])
    end
    if hangLaundry then laundry(L, c, box, side, u, v + 3, math.max(1, math.floor(w / 5)), seed, theme) end
  else
    local I, ja = box.i0 + box.A, box.j0 + box.B - u
    L.quad(c, { { I, ja, zw }, { I, ja - w, zw }, { I + d, ja - w, zw }, { I + d, ja, zw } }, wood[4])
    L.quad(c, { { I + d, ja, zw - 1 }, { I + d, ja - w, zw - 1 }, { I + d, ja - w, zw }, { I + d, ja, zw } }, wood[3])
    L.quad(c, { { I, ja, zw - 1 }, { I, ja - w, zw - 1 }, { I, ja - w, zw }, { I, ja, zw } }, wood[2])
    for k = 0, w - 1, 3 do
      L.quad(c, { { I + d, ja - k, zw }, { I + d, ja - k - 1, zw }, { I + d, ja - k - 1, zw + 3 },
        { I + d, ja - k, zw + 3 } }, wood[3])
    end
    L.quad(c, { { I + d, ja, zw + 3 }, { I + d, ja - w, zw + 3 }, { I + d, ja - w, zw + 4 },
      { I + d, ja, zw + 4 } }, wood[5])
    if st.shade then
      L.quad(c, { { I + 1, ja + 1, zw + 6 }, { I + 1, ja - w - 1, zw + 6 },
        { I - 1, ja - w - 1, zw + 5 }, { I - 1, ja + 1, zw + 5 } }, theme.roof[3])
    end
    if hangLaundry then laundry(L, c, box, side, u, v + 3, math.max(1, math.floor(w / 5)), seed + 3, theme) end
  end
end

-- A recessed open gallery: a darker arcade band with posts, used instead of a balcony on some rows.
local function galleryBand(L, c, box, side, u, v, w, st, theme)
  local ctx, wall = c.building or c, theme.wall
  faceRect(L, ctx, box, side, u, v, w, 6, wall[1])
  for k = 0, w - 1, 3 do
    faceRect(L, ctx, box, side, u + k, v, 1, 6, wall[3])
  end
  faceRect(L, ctx, box, side, u, v + 5, w, 1, L.C.WOOD[4])
end

-- Domestic facade: floor bands, window rows, balconies or galleries. Both visible faces are dressed.
local function dress(L, c, box, side, st, theme, opt)
  opt = opt or {}
  local len = (side == 'L') and box.A or box.B
  local wall = opt.wall or theme.wall
  local storey = st.storey
  local rows = math.max(1, math.floor((box.H - 6) / storey))
  local pitch = st.winW + 4
  local cols = math.max(1, math.floor((len - 6) / pitch))
  local total = cols * st.winW + (cols - 1) * 4
  local u0 = math.max(2, math.floor((len - total) / 4) * 2)
  for r = 0, rows - 1 do
    local v = 5 + r * storey
    if v + st.winH + 2 <= box.H then
      -- string course every other storey only: a band on every floor turns the facade to stripes
      if r % 2 == 0 then faceRect(L, c, box, side, 0, v - 3, len, 1, wall[5]) end
      for k = 0, cols - 1 do
        local u = u0 + k * pitch
        if u + st.winW + 1 <= len then
          -- every third bay is a taller French window: domestic bay rhythm, not a uniform grid
          local tall = (k % 3 == 1)
          win(L, c, box, side, u, v, st.winW, st.winH + (tall and 2 or 0), st, theme,
            { wall = wall, glass = opt.glass, lit = opt.lit and ((r + k) % 5 == 0) })
        end
      end
      -- per-biome balcony / gallery rhythm: these are the strongest shape cues at 1x
      local gw = math.min(len - u0 - 1, total + 2)
      if st.balcony and st.balconyEvery > 0 and r % st.balconyEvery == 1 and side == 'L' then
        balcony(L, c, box, side, u0 - 1, v - 1, math.min(len - u0, total + 2), st.veranda, st, theme,
          (opt.seed or 1) + r, (r % 4 == 1))
      elseif st.gallerySide == side and st.galleryEvery > 0 and r % st.galleryEvery == 1 then
        galleryBand(L, c, box, side, u0, v - 2, gw, st, theme)
      end
    end
  end
end

-- ------------------------------------------------------------------ structure helpers
-- One residential mass. opt: top = 'flat' | 'parapet' | nil, wall, seed, glass, dressL/dressR.
local function even(n) return n - (n % 2) end

local function block(L, c, x, y, z, w, d, h, st, theme, opt)
  opt = opt or {}
  x, y, w, d = even(x), even(y), even(w), even(d)
  local wall = opt.wall or theme.wall
  local boxOpt = { base = (z <= 0) }
  if opt.top == 'parapet' then
    boxOpt.parapet = { p = 2, d = 2, floor = opt.roofFloor or theme.roof }
  elseif opt.top == 'none' then
    boxOpt.notop = true
  end
  local box = L.box(c.building, x, y, z, w, d, h, wall, boxOpt)
  local ctx = c.building
  if opt.dressL ~= false then dress(L, ctx, box, 'L', st, theme, opt) end
  if opt.dressR ~= false then dress(L, ctx, box, 'R', st, theme, opt) end
  return box
end

-- Tiled / thatched / slated rooflet. Arid uses a parapet instead (pitch 0). The library roof
-- helpers require a span divisible by four, so the cap picks whichever form fits the footprint and
-- falls back to a closed parapet rather than mis-sizing the mass.
local function cap(L, c, x, y, z, w, d, st, theme)
  x, y, w, d = even(x), even(y), even(w), even(d)
  if st.pitch <= 0 then
    L.box(c.building, x, y, z, w, d, 2, theme.wall,
      { base = false, parapet = { p = 2, d = 2, floor = theme.roof } })
    return
  end
  local R = st.pitch + (theme.biome == 'northern' and 2 or 0)
  if math.min(w, d) % 4 == 0 then
    L.hip(c.building, x, y, z, w, d, R, theme.roof, { o = 2, rows = 3 })
  elseif w % 4 == 0 then
    L.gable(c.building, x, y, z, w, d, R, 'j', theme.roof, theme.wall, { o = 2, rows = 3 })
  elseif d % 4 == 0 then
    L.gable(c.building, x, y, z, w, d, R, 'i', theme.roof, theme.wall, { o = 2, rows = 3 })
  else
    L.box(c.building, x, y, z, w, d, 2, theme.wall,
      { base = false, parapet = { p = 2, d = 2, floor = theme.roof } })
  end
end

-- Structural buttress against a wall: a tapering stone fin, always founded on the plinth.
local function buttress(L, c, x, y, z, w, d, h, theme)
  x, y, w, d = even(x), even(y), even(w), even(d)
  local stone = L.C.CONCRETE
  local b = L.box(c.building, x, y, z, w, d, h, stone, { base = z <= 0 })
  L.edge(c.building, b.top, 'bottom', stone[5])
  return b
end

-- Garden terrace: planter strip plus a few palette-appropriate plants (B.plant picks palm / broadleaf
-- / cactus / pine from the theme biome).
local function garden(L, c, B, x, y, z, w, d, theme, seed, n)
  x, y, w, d = even(x), even(y), even(w), even(d)
  w, d = math.max(8, w), math.max(8, d)
  local soil = theme.ground[3]
  L.flat(c.building, x + 2, y + 2, w - 4, d - 4, soil, z)
  for k = 1, n do
    local i = x + 3 + ((k * 7 + seed) % math.max(2, w - 7))
    local j = y + 3 + ((k * 5 + seed * 3) % math.max(2, d - 7))
    B.plant(L, c.building, i, j, z, 3, theme, seed + k)
  end
  -- low planted kerb so the terrace does not read as a bare slab
  for k = 0, w - 4, 4 do
    L.dot(c.building, x + 2 + k, y + d - 2, z, theme.leaf[3])
  end
end

-- Human-scale entrance: door, frame, lamp and, where the lot leaves room, a porch whose shed roof
-- projects OUTWARD over its own posts and steps.
-- Outward direction: 'L' is the j = j0+B face, so it projects towards +j; 'R' is the i = i0+A face,
-- so it projects towards +i.  `room` is the free lot left outside that face; the porch depth is
-- chosen to fit it, and every porch coordinate stays inside the footprint.
local function entrance(L, c, box, side, u, st, theme, A, D)
  local ctx = c.building or c
  local wood, stone = L.C.WOOD, L.C.CONCRETE
  u = u - (u % 2)
  faceRect(L, ctx, box, side, u, 0, 5, 8, wood[2])
  faceRect(L, ctx, box, side, u, 7, 5, 1, wood[4])
  faceRect(L, ctx, box, side, u + 2, 1, 1, 6, wood[1])            -- door split
  faceRect(L, ctx, box, side, u - 1, 8, 7, 1, theme.wall[5])      -- lintel
  local room, I, J
  if side == 'L' then
    I, J = box.i0 + u, box.j0 + box.B
    room = D - J
  else
    I, J = box.i0 + box.A, box.j0 + box.B - u
    room = A - I
  end
  local depth = math.min(5, math.max(2, room - 1))
  local postOff = (room >= 8) and 3 or 2
  if side == 'L' then
    L.quad(ctx, { { I - 2, J, 13 }, { I + 8, J, 13 }, { I + 8, J + depth, 11 }, { I - 2, J + depth, 11 } }, theme.roof[3])
    L.quad(ctx, { { I - 2, J + depth, 11 }, { I + 8, J + depth, 11 }, { I + 8, J + depth, 10 },
      { I - 2, J + depth, 10 } }, theme.roof[2])
    if room >= 6 then
      L.box(ctx, I, J + postOff, 0, 2, 2, 11, wood, { base = true })
      L.box(ctx, I + 6, J + postOff, 0, 2, 2, 11, wood, { base = true })
      -- steps sized to the remaining lot so nothing crosses the footprint
      local d1 = (room >= 10) and 6 or 4
      L.flat(ctx, I - 2, J + 2, 12, d1, stone[4], 0)
      L.flat(ctx, I - 4, J + 4, 14, 2, stone[5], 1)
    end
  else
    L.quad(ctx, { { I, J + 2, 13 }, { I, J - 8, 13 }, { I + depth, J - 8, 11 }, { I + depth, J + 2, 11 } }, theme.roof[3])
    L.quad(ctx, { { I + depth, J + 2, 11 }, { I + depth, J - 8, 11 }, { I + depth, J - 8, 10 },
      { I + depth, J + 2, 10 } }, theme.roof[2])
    if room >= 6 then
      L.box(ctx, I + postOff, J - 2, 0, 2, 2, 11, wood, { base = true })
      L.box(ctx, I + postOff, J - 8, 0, 2, 2, 11, wood, { base = true })
      local d1 = (room >= 10) and 6 or 4
      L.flat(ctx, I + 2, J - 10, d1, 10, stone[4], 0)
      L.flat(ctx, I + 4, J - 12, 2, 12, stone[5], 1)
    end
  end
  L.dot(c.details, box.i0 + u + 1, (side == 'L') and (box.j0 + box.B) or (box.i0 + box.A), 9, L.LIT)
end

-- A laundry line slung between two masses: both ends land on a wall, never in mid air.
local function laundryLine(L, c, i0, j0, z0, i1, j1, z1, theme, seed)
  local n = math.max(2, math.floor(math.abs(i1 - i0) + math.abs(j1 - j0)))
  local cloths = { L.C.WHITE[4], theme.roof[4], L.FLOWERS[1], L.C.WHITE[3], theme.roof[3] }
  for k = 0, n do
    local t = k / n
    local i = i0 + (i1 - i0) * t
    local j = j0 + (j1 - j0) * t
    local z = z0 + (z1 - z0) * t - math.floor(math.sin(t * math.pi) * 2)
    L.dot(c.building, math.floor(i + 0.5), math.floor(j + 0.5), math.floor(z + 0.5), L.C.WOOD[3])
    if k > 1 and k < n - 1 and (k + seed) % 3 == 0 then
      local col = cloths[(k + seed) % #cloths + 1]
      for d = 1, 3 do
        L.dot(c.building, math.floor(i + 0.5), math.floor(j + 0.5), math.floor(z + 0.5) - d, col)
      end
    end
  end
end

-- Set the site: paved lot, garden edges, courtyard paving.
local function site(L, c, A, D, theme)
  L.flat(c.lot, 2, 2, A - 4, D - 4, theme.ground[4])
  L.speckle(c.lot, L.flat(c.lot, 2, 2, A - 4, D - 4, theme.ground[4]), 0.05, theme.ground[3], 7)
  local pave = L.C.CONCRETE[4]
  L.flat(c.lot, 4, D - 12, A - 8, 8, pave, 0)
end

-- ------------------------------------------------------------------ home_4  mid-rise courtyard block
local function home4(L, B, c, theme, s, st)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local wall = theme.wall
  -- street wing along the front (high j) and a return wing along the high i side; courtyard between
  local front = block(L, c, 2, D - 22, 0, A - 4, 16, 60, st, theme,
    { top = 'parapet', seed = 11 })
  local side = block(L, c, A - 24, 2, 0, 18, D - 28, 46, st, theme,
    { top = 'parapet', seed = 23 })
  -- stair turret + rooflet: the crown of the block
  block(L, c, 4, D - 20, 60, 12, 12, 20, st, theme, { top = 'none', seed = 5, dressR = false })
  cap(L, c, 4, D - 20, 80, 12, 12, st, theme)
  -- upper storey set back on the front wing
  block(L, c, 8, D - 20, 60, A - 22, 12, 12, st, theme, { top = 'parapet', seed = 31, dressR = false })
  -- courtyard: paved, low garden wall and planting, reached through the front wing
  L.flat(c.lot, 6, 6, A - 28, D - 28, L.C.CONCRETE[4], 0)
  for k = 1, 3 do
    B.plant(L, c.lot, 10 + k * 4, 8 + k * 5, 0, 3, theme, 40 + k)
  end
  L.box(c.lot, 6, 6, 0, A - 28, 2, 3, L.C.CONCRETE, { base = true })
  L.box(c.lot, 6, 6, 0, 2, D - 28, 3, L.C.CONCRETE, { base = true })
  -- entrance on the street face, and two stone buttresses at the corners
  entrance(L, c, front, 'L', math.floor((front.A - 8) / 4) * 2, st, theme, A, D)
  buttress(L, c, 2, D - 22, 0, 4, 4, 26, theme)
  buttress(L, c, A - 8, D - 22, 0, 4, 4, 26, theme)
  -- rooftop garden on the return wing
  local sideTop = 46
  garden(L, c, B, A - 24, 2, sideTop + 2, 16, D - 30, theme, 3, 2)
  -- laundry between the two wings, both ends on a wall
  laundryLine(L, c, A - 24, D - 24, 34, A - 24, 10, 34, theme, 2)
end

-- ------------------------------------------------------------------ home_5  stepped complex
local function home5(L, B, c, theme, s, st)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- arcaded podium, a taller central block, TWO receiving wings that reach the sky galleries
  local podium = block(L, c, 6, 6, 0, A - 12, D - 12, 28, st, theme, { top = 'parapet', seed = 41 })
  for k = 0, 3 do
    galleryBand(L, c, podium, 'L', 4 + k * 9, 2, 6, st, theme)
    galleryBand(L, c, podium, 'R', 4 + k * 9, 2, 6, st, theme)
  end
  -- west wing rises to z68 so the west gallery is carried at both ends; east wing to z64
  local west = block(L, c, 2, 12, 0, 10, D - 30, 68, st, theme, { top = 'parapet', seed = 43 })
  local east = block(L, c, A - 12, 10, 0, 10, D - 26, 64, st, theme, { top = 'parapet', seed = 47 })
  local core = block(L, c, 14, 14, 28, A - 28, D - 28, 84, st, theme, { top = 'parapet', seed = 53 })
  block(L, c, 18, 18, 112, A - 36, D - 36, 24, st, theme, { top = 'parapet', seed = 59 })
  block(L, c, 22, 22, 136, 8, 8, 8, st, theme, { top = 'none', seed = 61, dressL = false, dressR = false })
  cap(L, c, 22, 22, 144, 8, 8, st, theme)
  -- gallery WEST: z 60..68, spans i10..16 -> overlaps the west wing (i 2..12, z 0..68) and the
  -- central block (i 14..34, z 28..112). Both ends are inside a solid mass.
  L.box(c.building, 10, 18, 60, 8, 10, 8, L.C.WOOD, { base = true })
  L.quad(c.building, { { 9, 16, 69 }, { 19, 16, 69 }, { 19, 30, 69 }, { 9, 30, 69 } }, theme.roof[3])
  for k = 0, 4, 2 do
    L.box(c.building, 10 + k, 18, 60, 2, 2, 4, L.C.WOOD, { base = false })
  end
  -- gallery EAST: z 56..64, spans i32..38 -> overlaps the central block (ends i34) and the east
  -- wing (i 36..46, z 0..64). Both ends are inside a solid mass.
  L.box(c.building, 32, 16, 56, 8, 10, 8, L.C.WOOD, { base = true })
  L.quad(c.building, { { 31, 14, 65 }, { 41, 14, 65 }, { 41, 28, 65 }, { 31, 28, 65 } }, theme.roof[3])
  -- terraces and planting at the real tops
  garden(L, c, B, 2, 12, 70, 8, D - 32, theme, 12, 2)
  garden(L, c, B, A - 12, 10, 66, 8, D - 28, theme, 14, 2)
  garden(L, c, B, 14, 14, 30, A - 28, D - 28, theme, 8, 3)
  garden(L, c, B, 18, 18, 114, A - 36, D - 36, theme, 16, 3)
  entrance(L, c, podium, 'L', 12, st, theme, A, D)
  buttress(L, c, 6, 6, 0, 4, 4, 34, theme)
  buttress(L, c, A - 10, 6, 0, 4, 4, 34, theme)
  laundryLine(L, c, 12, 22, 76, 14, 22, 76, theme, 5)
  local _ = { west, east, core }
end

-- ------------------------------------------------------------------ home_6  clustered tower
local function home6(L, B, c, theme, s, st)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- substantial podium with arcades, three wings, clustered tower with two setbacks and a roof crown
  local podium = block(L, c, 6, 6, 0, A - 12, D - 12, 34, st, theme, { top = 'parapet', seed = 71 })
  for k = 0, 5 do
    galleryBand(L, c, podium, 'L', 5 + k * 9, 2, 7, st, theme)
    galleryBand(L, c, podium, 'R', 5 + k * 9, 2, 7, st, theme)
  end
  block(L, c, 2, 20, 0, 12, D - 34, 62, st, theme, { top = 'parapet', seed = 73 })
  block(L, c, 2, 2, 0, D - 34, 12, 50, st, theme, { top = 'parapet', seed = 77 })
  block(L, c, A - 14, D - 34, 0, 12, 30, 56, st, theme, { top = 'parapet', seed = 79 })
  block(L, c, 18, 18, 34, A - 36, D - 36, 92, st, theme, { top = 'parapet', seed = 83 })
  block(L, c, 22, 22, 126, A - 44, D - 44, 54, st, theme, { top = 'parapet', seed = 89 })
  block(L, c, 26, 26, 180, A - 52, D - 52, 54, st, theme, { top = 'parapet', seed = 97 })
  -- crown: turret + three rooflets, a readable cluster rather than one cap
  block(L, c, 28, 28, 234, 8, 8, 12, st, theme, { top = 'none', seed = 101, dressL = false, dressR = false })
  cap(L, c, 28, 28, 246, 8, 8, st, theme)
  L.box(c.building, 30, 30, 246, 2, 2, 18, L.C.STEEL, { base = true })
  L.dot(c.details, 31, 31, 262, L.LIT)
  -- setbacks as planted terraces
  garden(L, c, B, 22, 22, 128, A - 44, D - 44, theme, 21, 3)
  garden(L, c, B, 26, 26, 182, A - 52, D - 52, theme, 25, 2)
  garden(L, c, B, 8, 8, 36, 16, 16, theme, 29, 2)
  entrance(L, c, podium, 'L', 14, st, theme, A, D)
  entrance(L, c, podium, 'R', 40, st, theme, A, D)   -- exposed part of the right wall only
  buttress(L, c, 6, 6, 0, 5, 5, 44, theme)
  buttress(L, c, A - 11, 6, 0, 5, 5, 44, theme)
  buttress(L, c, 6, D - 11, 0, 5, 5, 40, theme)
  laundryLine(L, c, 18, 20, 60, 14, 20, 40, theme, 9)
end

-- ------------------------------------------------------------------ home_7  multi-wing citadel
local function home7(L, B, c, theme, s, st)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- base ring around a real courtyard, three shafts at different heights, sky galleries, twin crown
  local front7 = block(L, c, 4, D - 30, 0, A - 8, 26, 52, st, theme, { top = 'parapet', seed = 111 })
  block(L, c, 4, 8, 0, A - 8, 20, 44, st, theme, { top = 'parapet', seed = 113 })
  block(L, c, 4, 8, 0, 24, D - 16, 48, st, theme, { top = 'parapet', seed = 117 })
  block(L, c, A - 28, 8, 0, 24, D - 16, 40, st, theme, { top = 'parapet', seed = 119 })
  -- courtyard between the wings
  L.flat(c.lot, 30, 30, A - 60, D - 60, L.C.CONCRETE[4], 0)
  for k = 1, 4 do B.plant(L, c.lot, 34 + k * 5, 34 + k * 5, 0, 3, theme, 130 + k) end
  L.box(c.lot, 28, 28, 0, 2, D - 56, 4, L.C.CONCRETE, { base = true })
  L.box(c.lot, A - 30, 28, 0, 2, D - 56, 4, L.C.CONCRETE, { base = true })

  -- shaft A (west): four stepped segments, gardens on every setback
  block(L, c, 22, 30, 52, 22, 24, 90, st, theme, { top = 'parapet', seed = 121 })
  block(L, c, 24, 32, 142, 18, 20, 80, st, theme, { top = 'parapet', seed = 123 })
  block(L, c, 26, 34, 222, 14, 16, 70, st, theme, { top = 'parapet', seed = 127 })
  block(L, c, 28, 36, 292, 10, 12, 60, st, theme, { top = 'parapet', seed = 129 })
  block(L, c, 29, 37, 352, 8, 8, 10, st, theme, { top = 'none', seed = 131, dressL = false, dressR = false })
  cap(L, c, 28, 36, 362, 10, 12, st, theme)
  -- shaft B (east): same rhythm, taller
  block(L, c, A - 46, 30, 52, 22, 24, 100, st, theme, { top = 'parapet', seed = 133 })
  block(L, c, A - 44, 32, 152, 18, 20, 90, st, theme, { top = 'parapet', seed = 137 })
  block(L, c, A - 42, 34, 242, 14, 16, 80, st, theme, { top = 'parapet', seed = 139 })
  block(L, c, A - 40, 36, 322, 10, 12, 70, st, theme, { top = 'parapet', seed = 141 })
  block(L, c, A - 39, 37, 392, 8, 8, 12, st, theme, { top = 'none', seed = 143, dressL = false, dressR = false })
  cap(L, c, A - 40, 36, 404, 10, 12, st, theme)
  -- central service core, shorter, tying the pair together
  block(L, c, 42, 44, 52, 12, 12, 130, st, theme, { top = 'parapet', seed = 147 })
  cap(L, c, 42, 44, 182, 12, 12, st, theme)
  -- sky galleries bridging the shafts (inside the reservation)
  L.box(c.building, 40, 34, 126, A - 80, 8, 8, L.C.WOOD, { base = true })
  L.box(c.building, 38, 44, 236, A - 76, 8, 8, L.C.WOOD, { base = true })
  L.quad(c.building, { { 40, 42, 134 }, { A - 40, 42, 134 }, { A - 40, 50, 134 }, { 40, 50, 134 } }, theme.roof[3])
  L.quad(c.building, { { 38, 52, 244 }, { A - 38, 52, 244 }, { A - 38, 60, 244 }, { 38, 60, 244 } }, theme.roof[3])
  -- planted setbacks
  garden(L, c, B, 24, 32, 144, 18, 20, theme, 33, 2)
  garden(L, c, B, A - 44, 32, 154, 18, 20, theme, 37, 2)
  garden(L, c, B, 26, 34, 224, 14, 16, theme, 41, 2)
  garden(L, c, B, A - 42, 34, 244, 14, 16, theme, 45, 2)
  garden(L, c, B, 28, 36, 294, 10, 12, theme, 49, 1)
  garden(L, c, B, A - 40, 36, 324, 10, 12, theme, 51, 1)
  garden(L, c, B, 6, 8, 46, 20, D - 20, theme, 53, 3)
  -- buttresses along the base walls
  for _, x in ipairs({ 6, 30, A - 34, A - 10 }) do buttress(L, c, x, D - 30, 0, 5, 5, 40, theme) end
  buttress(L, c, 6, 10, 0, 5, 5, 34, theme)
  buttress(L, c, A - 11, 10, 0, 5, 5, 34, theme)
  entrance(L, c, front7, 'L', 24, st, theme, A, D)
  laundryLine(L, c, 44, 40, 120, A - 46, 40, 120, theme, 13)
end

-- ------------------------------------------------------------------ home_8  vertical district
local function home8(L, B, c, theme, s, st)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- two-step monumental plinth with a plaza, then five shafts of different heights, connecting
  -- galleries and a tall central crown: a district, not one slab
  local plinth = block(L, c, 6, 6, 0, A - 12, D - 12, 26, st, theme, { top = 'parapet', seed = 151 })
  block(L, c, 10, 10, 26, A - 20, D - 20, 22, st, theme, { top = 'parapet', seed = 153 })
  for k = 0, 8 do
    galleryBand(L, c, plinth, 'L', 8 + k * 12, 3, 9, st, theme)
    galleryBand(L, c, plinth, 'R', 8 + k * 12, 3, 9, st, theme)
  end
  -- five district shafts (corners + centre), each stepped twice
  local shafts = {
    { x = 24, y = 24, h = 300, seed = 161 },
    { x = A - 52, y = 24, h = 360, seed = 167 },
    { x = 24, y = D - 52, h = 330, seed = 173 },
    { x = A - 52, y = D - 52, h = 390, seed = 179 },
    { x = A / 2 - 16, y = D / 2 - 16, h = 430, seed = 181 },
  }
  for _, sh in ipairs(shafts) do
    local x, y, hh = sh.x, sh.y, sh.h
    block(L, c, x, y, 48, 28, 28, 120, st, theme, { top = 'parapet', seed = sh.seed })
    block(L, c, x + 3, y + 3, 168, 22, 22, 110, st, theme, { top = 'parapet', seed = sh.seed + 1 })
    block(L, c, x + 6, y + 6, 278, 16, 16, hh - 278, st, theme, { top = 'parapet', seed = sh.seed + 2 })
    garden(L, c, B, x + 3, y + 3, 170, 22, 22, theme, sh.seed + 5, 2)
    garden(L, c, B, x + 6, y + 6, 280, 16, 16, theme, sh.seed + 7, 1)
  end
  -- crowns: a rooflet per shaft, the centre one taller with a lantern
  cap(L, c, 30, 30, shafts[1].h, 16, 16, st, theme)
  cap(L, c, A - 46, 30, shafts[2].h, 16, 16, st, theme)
  cap(L, c, 30, D - 46, shafts[3].h, 16, 16, st, theme)
  cap(L, c, A - 46, D - 46, shafts[4].h, 16, 16, st, theme)
  -- CROWN: four inhabited, stepped residential tiers with a gallery and a rooflet, instead of the
  -- old 120-unit blank shaft. Each tier is dressed (windows, balconies, laundry) and carries a
  -- planted parapet terrace at its setback, so the top reads as stacked housing.
  local crown = {
    { x = A / 2 - 16, y = D / 2 - 16, z = 430, w = 16, h = 36, seed = 191 },
    { x = A / 2 - 12, y = D / 2 - 12, z = 466, w = 12, h = 36, seed = 193 },
    { x = A / 2 - 10, y = D / 2 - 10, z = 502, w = 10, h = 32, seed = 197 },
    { x = A / 2 - 8, y = D / 2 - 8, z = 534, w = 8, h = 28, seed = 199 },
  }
  for _, cw in ipairs(crown) do
    block(L, c, cw.x, cw.y, cw.z, cw.w, cw.w, cw.h, st, theme, { top = 'parapet', seed = cw.seed })
  end
  -- planted terrace ring on each crown setback, and a gallery band under the tallest tier
  garden(L, c, B, crown[1].x, crown[1].y, crown[2].z + 2, crown[1].w, crown[1].w, theme, 201, 2)
  garden(L, c, B, crown[2].x, crown[2].y, crown[3].z + 2, crown[2].w, crown[2].w, theme, 203, 1)
  galleryBand(L, c, L.box(c.building, crown[3].x, crown[3].y, crown[3].z, crown[3].w, crown[3].w,
    crown[3].h, theme.wall, { base = false, notop = true, parapet = { p = 2, d = 2, floor = theme.roof } }),
    'L', 2, 6, crown[3].w - 4, st, theme)
  -- crown: rooflet, then an open lookout belfry (posts, deck, small cap) instead of a bare mast,
  -- so the silhouette ends in a piece of architecture rather than a chimney
  local top = crown[4].z + crown[4].h
  cap(L, c, crown[4].x, crown[4].y, top, crown[4].w, crown[4].w, st, theme)
  for _, p2 in ipairs({ { -4, -4 }, { 2, -4 }, { -4, 2 }, { 2, 2 } }) do
    L.box(c.building, A / 2 + p2[1], D / 2 + p2[2], top, 2, 2, 26, L.C.WOOD, { base = true })
  end
  local bx0, bd = A / 2 - 6, 12
  L.flat(c.building, bx0, bx0, bd, bd, L.C.WOOD[4], top + 26)
  L.flat(c.building, bx0 + 2, bx0 + 2, bd - 4, bd - 4, theme.roof[3], top + 27)
  L.box(c.building, bx0, bx0, top + 26, bd, bd, 2, L.C.WOOD, { base = false })
  cap(L, c, bx0, bx0, top + 28, bd, bd, st, theme)
  L.dot(c.details, A / 2, D / 2, top + 30 + (st.pitch > 0 and st.pitch or 2), L.LIT)
  -- connecting galleries between shafts, inside the reservation
  L.box(c.building, 46, 30, 150, A - 92, 10, 10, L.C.WOOD, { base = true })
  L.box(c.building, 30, 46, 240, 10, D - 92, 10, L.C.WOOD, { base = true })
  L.quad(c.building, { { 46, 34, 158 }, { A - 46, 34, 158 }, { A - 46, 44, 158 }, { 46, 44, 158 } }, theme.roof[3])
  L.quad(c.building, { { 34, 46, 248 }, { 44, 46, 248 }, { 44, D - 46, 248 }, { 34, D - 46, 248 } }, theme.roof[3])
  -- plaza and monumental entrance on the street face
  L.flat(c.lot, 20, D - 26, 44, 18, L.C.CONCRETE[4], 0)
  entrance(L, c, plinth, 'L', 34, st, theme, A, D)
  entrance(L, c, plinth, 'R', 26, st, theme, A, D)
  -- buttresses along the plinth
  for _, x in ipairs({ 10, 34, 58, A - 30, A - 6 }) do buttress(L, c, x, D - 20, 0, 5, 5, 60, theme) end
  for _, y in ipairs({ 10, 34, 58 }) do buttress(L, c, A - 16, y, 0, 5, 5, 44, theme) end
  -- plaza planting, kept small so it is not terrain scale
  for k = 1, 3 do B.plant(L, c.lot, 24 + k * 6, D - 20, 0, 3, theme, 200 + k) end
  laundryLine(L, c, 52, 34, 150, 52, D - 34, 150, theme, 17)
end

-- ------------------------------------------------------------------ COMMERCE (shop) section
-- Shop-specific helpers and tiers. Everything in this section is separate from the housing helpers
-- above: no shared function is edited, so home_4..home_8 output cannot change from this code.
--
-- HEIGHT CONTRACT (the lesson from the housing revision): every helper below is handed a floor-LOCAL
-- height `v` above the mass base and adds box.z0 exactly once, via `local zw = box.z0 + v`, before
-- writing any world-space quad (gallery slab, balustrade, awning, hoist beam, sign bracket). Nothing
-- draws at raw `v` and nothing adds the base twice.

local SHOP = {
  tropical = { storey = 12, shopW = 4, shopH = 5, awn = 4, galEvery = 2, pitch = 5, shade = true },
  temperate = { storey = 12, shopW = 4, shopH = 5, awn = 3, galEvery = 2, pitch = 6 },
  arid = { storey = 13, shopW = 3, shopH = 4, awn = 3, galEvery = 3, pitch = 0, enclosed = true },
  northern = { storey = 12, shopW = 3, shopH = 4, awn = 2, galEvery = 2, pitch = 7, enclosed = true },
}

-- forward declarations: the gallery hangs a sign (defined below) and every tier builds the small
-- `st`-shaped table the shared entrance helper expects
local shopSign
local function st4(ss) return { veranda = ss.awn } end

-- Shopfront: wide opening in a deep reveal, lit head, threshold and a fascia band above.
local function shopFront(L, ctx, box, side, u, v, w, h, ss, theme)
  local wood = L.C.WOOD
  faceRect(L, ctx, box, side, u - 1, v - 1, w + 2, h + 2, theme.wall[2])   -- reveal
  faceRect(L, ctx, box, side, u, v, w, h, L.C.GLASS[2])
  faceRect(L, ctx, box, side, u, v + h - 1, w, 1, L.C.GLASS[4])
  faceRect(L, ctx, box, side, u, v - 1, w, 1, wood[4])                     -- threshold
  faceRect(L, ctx, box, side, u, v + h, w, 2, theme.roof[3])               -- fascia sign band
  faceRect(L, ctx, box, side, u, v + h + 1, w, 1, theme.roof[5])
end

-- Hanging trade sign: a bracket arm out of the wall, then a board with a simple ICON. Icons only,
-- never readable text. icon 0 = ring (round loaf), 1 = filled square (goods bale), 2 = bar (bottle).
shopSign = function(L, ctx, box, side, u, v, theme, icon)
  local wood, board = L.C.WOOD, theme.roof
  local zw = box.z0 + v
  if side == 'L' then
    local J, i = box.j0 + box.B, box.i0 + u
    L.quad(ctx, { { i, J, zw + 4 }, { i + 4, J, zw + 4 }, { i + 4, J, zw + 5 }, { i, J, zw + 5 } }, wood[3])
    L.quad(ctx, { { i + 3, J, zw }, { i + 4, J, zw }, { i + 4, J, zw + 5 }, { i + 3, J, zw + 5 } }, wood[4])
    L.quad(ctx, { { i + 1, J, zw - 3 }, { i + 4, J, zw - 3 }, { i + 4, J, zw + 3 }, { i + 1, J, zw + 3 } }, board[4])
    L.quad(ctx, { { i + 1, J + 1, zw - 3 }, { i + 4, J + 1, zw - 3 }, { i + 4, J + 1, zw + 3 }, { i + 1, J + 1, zw + 3 } }, board[3])
    local dark = board[1]
    if icon == 0 then
      faceRect(L, ctx, box, side, u + 2, v + 1, 1, 1, dark)
      faceRect(L, ctx, box, side, u + 2, v - 1, 1, 1, dark)
    elseif icon == 1 then
      faceRect(L, ctx, box, side, u + 2, v, 1, 1, dark)
      faceRect(L, ctx, box, side, u + 3, v, 1, 1, dark)
    else
      faceRect(L, ctx, box, side, u + 2, v - 2, 1, 3, dark)
    end
  else
    local I, ja = box.i0 + box.A, box.j0 + box.B - u
    L.quad(ctx, { { I, ja, zw + 4 }, { I, ja - 4, zw + 4 }, { I, ja - 4, zw + 5 }, { I, ja, zw + 5 } }, wood[3])
    L.quad(ctx, { { I, ja - 3, zw }, { I, ja - 4, zw }, { I, ja - 4, zw + 5 }, { I, ja - 3, zw + 5 } }, wood[4])
    L.quad(ctx, { { I, ja - 1, zw - 3 }, { I, ja - 4, zw - 3 }, { I, ja - 4, zw + 3 }, { I, ja - 1, zw + 3 } }, board[4])
    L.quad(ctx, { { I + 1, ja - 1, zw - 3 }, { I + 1, ja - 4, zw - 3 }, { I + 1, ja - 4, zw + 3 }, { I + 1, ja - 1, zw + 3 } }, board[3])
    local dark = board[1]
    if icon == 0 then
      faceRect(L, ctx, box, side, u + 2, v + 1, 1, 1, dark)
      faceRect(L, ctx, box, side, u + 2, v - 1, 1, 1, dark)
    elseif icon == 1 then
      faceRect(L, ctx, box, side, u + 2, v, 1, 1, dark)
    else
      faceRect(L, ctx, box, side, u + 2, v - 2, 1, 3, dark)
    end
  end
end

-- Merchant gallery: an OPEN projecting walkway with a stone-coped balustrade. Not a domestic
-- balcony: no laundry, a solid coping, and an optional hanging trade sign.
local function shopGallery(L, ctx, box, side, u, v, w, depth, ss, theme, seed, withSign)
  local wood, stone = L.C.WOOD, L.C.CONCRETE
  local zw = box.z0 + v
  local d = math.max(2, depth)
  if side == 'L' then
    local J, i = box.j0 + box.B, box.i0 + u
    L.quad(ctx, { { i, J, zw }, { i + w, J, zw }, { i + w, J + d, zw }, { i, J + d, zw } }, wood[4])
    L.quad(ctx, { { i, J + d, zw - 1 }, { i + w, J + d, zw - 1 }, { i + w, J + d, zw }, { i, J + d, zw } }, wood[3])
    L.quad(ctx, { { i, J, zw - 1 }, { i + w, J, zw - 1 }, { i + w, J, zw }, { i, J, zw } }, wood[2])
    for k = 0, math.max(1, math.floor(w / 4)) do
      local uu = i + math.min(w - 1, k * 4)
      L.quad(ctx, { { uu, J + d, zw }, { uu + 1, J + d, zw }, { uu + 1, J + d, zw + 3 }, { uu, J + d, zw + 3 } }, stone[3])
    end
    L.quad(ctx, { { i, J + d, zw + 3 }, { i + w, J + d, zw + 3 }, { i + w, J + d, zw + 4 }, { i, J + d, zw + 4 } }, stone[5])
    if ss.shade then
      L.quad(ctx, { { i - 1, J - 1, zw + 7 }, { i + w + 1, J - 1, zw + 7 },
        { i + w + 1, J + d + 1, zw + 6 }, { i - 1, J + d + 1, zw + 6 } }, theme.roof[3])
    end
    if withSign then shopSign(L, ctx, box, side, u + 1, v + 4, theme, seed % 3) end
  else
    local I, ja = box.i0 + box.A, box.j0 + box.B - u
    L.quad(ctx, { { I, ja, zw }, { I, ja - w, zw }, { I + d, ja - w, zw }, { I + d, ja, zw } }, wood[4])
    L.quad(ctx, { { I + d, ja, zw - 1 }, { I + d, ja - w, zw - 1 }, { I + d, ja - w, zw }, { I + d, ja, zw } }, wood[3])
    L.quad(ctx, { { I, ja, zw - 1 }, { I, ja - w, zw - 1 }, { I, ja - w, zw }, { I, ja, zw } }, wood[2])
    for k = 0, math.max(1, math.floor(w / 4)) do
      local jj = ja - math.min(w - 1, k * 4)
      L.quad(ctx, { { I + d, jj, zw }, { I + d, jj - 1, zw }, { I + d, jj - 1, zw + 3 }, { I + d, jj, zw + 3 } }, stone[3])
    end
    L.quad(ctx, { { I + d, ja, zw + 3 }, { I + d, ja - w, zw + 3 }, { I + d, ja - w, zw + 4 }, { I + d, ja, zw + 4 } }, stone[5])
    if ss.shade then
      -- the canopy projects OUTWARD along +i, one pixel past the slab's outer edge, exactly like the
      -- L-side canopy below (J-1 .. J+d+1): the shade must cover the walkway it is over, not run
      -- back towards the wall.
      L.quad(ctx, { { I - 1, ja + 1, zw + 7 }, { I - 1, ja - w - 1, zw + 7 },
        { I + d + 1, ja - w - 1, zw + 6 }, { I + d + 1, ja + 1, zw + 6 } }, theme.roof[3])
    end
    if withSign then shopSign(L, ctx, box, side, u + 1, v + 4, theme, seed % 3) end
  end
end

-- Cloth awning over a shopfront or stall, carried on two posts at its outer edge (never floating).
-- v and zbase are both LOCAL heights on the same mass.
local function shopAwning(L, ctx, box, side, u, v, w, depth, zbase, ss, theme)
  local wood = L.C.WOOD
  local zw = box.z0 + v
  local zb = box.z0 + zbase
  local d = even(math.max(2, depth))
  local ph = math.max(1, zw - 2 - zb)
  if side == 'L' then
    local J, i = box.j0 + box.B, box.i0 + u
    L.quad(ctx, { { i, J, zw }, { i + w, J, zw }, { i + w, J + d, zw - 2 }, { i, J + d, zw - 2 } }, theme.roof[4])
    L.quad(ctx, { { i, J + d, zw - 3 }, { i + w, J + d, zw - 3 }, { i + w, J + d, zw - 2 }, { i, J + d, zw - 2 } }, theme.roof[2])
    L.box(ctx, i + 2, J + d - 2, zb, 2, 2, ph, wood, { base = true })
    if w >= 8 then L.box(ctx, i + w - 4, J + d - 2, zb, 2, 2, ph, wood, { base = true }) end
  else
    local I, ja = box.i0 + box.A, box.j0 + box.B - u
    L.quad(ctx, { { I, ja, zw }, { I, ja - w, zw }, { I + d, ja - w, zw - 2 }, { I + d, ja, zw - 2 } }, theme.roof[4])
    L.quad(ctx, { { I + d, ja, zw - 3 }, { I + d, ja - w, zw - 3 }, { I + d, ja - w, zw - 2 }, { I + d, ja, zw - 2 } }, theme.roof[2])
    L.box(ctx, I + d - 2, ja - 2, zb, 2, 2, ph, wood, { base = true })
    if w >= 8 then L.box(ctx, I + d - 2, ja - w, zb, 2, 2, ph, wood, { base = true }) end
  end
end

-- Ground arcade: square piers with dark market openings between them and a lit lintel band. This is
-- the commerce silhouette cue at street level — housing uses a small door, shops use a colonnade.
local function shopArcade(L, ctx, box, side, ss, theme, opt)
  opt = opt or {}
  local len = (side == 'L') and box.A or box.B
  local hgt = opt.h or 11
  local v0 = opt.v or 0
  faceRect(L, ctx, box, side, 0, v0, len, hgt, theme.wall[1])
  for u = 0, len - 2, 5 do
    faceRect(L, ctx, box, side, u, v0, 2, hgt, theme.wall[3])
  end
  faceRect(L, ctx, box, side, 0, v0 + hgt - 1, len, 1, L.C.WOOD[4])
  faceRect(L, ctx, box, side, 0, v0 + hgt, len, 1, theme.wall[5])
end

-- Warehouse loading bay: wide door, projecting dock platform with a step, and a timber hoist above
-- whose beam starts at the wall and whose rope hangs from the beam tip.
local function shopDock(L, ctx, box, side, u, ss, theme, A, D)
  local wood, stone = L.C.WOOD, L.C.CONCRETE
  u = u - (u % 2)
  faceRect(L, ctx, box, side, u, 0, 8, 9, wood[2])
  faceRect(L, ctx, box, side, u + 3, 0, 2, 9, wood[1])
  faceRect(L, ctx, box, side, u - 1, 9, 10, 1, wood[4])
  local I, J, room
  if side == 'L' then
    I, J = box.i0 + u, box.j0 + box.B
    room = D - J
  else
    I, J = box.i0 + box.A, box.j0 + box.B - u
    room = A - I
  end
  local depth = even(math.min(4, math.max(2, room - 2)))
  if side == 'L' then
    L.flat(ctx, I, J + 2, 8, depth, stone[4], 3)
    if room >= depth + 4 then L.flat(ctx, I, J + 2 + depth, 6, 2, stone[5], 1) end
    L.quad(ctx, { { I, J, 15 }, { I + 8, J, 15 }, { I + 8, J + 5, 14 }, { I, J + 5, 14 } }, wood[3])
    L.quad(ctx, { { I, J + 5, 14 }, { I + 8, J + 5, 14 }, { I + 8, J + 5, 13 }, { I, J + 5, 13 } }, wood[2])
    for z = 14, 7, -1 do L.dot(ctx, I + 7, J + 4, z, wood[2]) end
    L.dot(ctx, I + 7, J + 4, 6, L.C.STEEL[4])
  else
    L.flat(ctx, I + 2, J - 10, depth, 8, stone[4], 3)
    if room >= depth + 4 then L.flat(ctx, I + 2 + depth, J - 8, 2, 6, stone[5], 1) end
    L.quad(ctx, { { I, J, 15 }, { I, J - 8, 15 }, { I + 5, J - 8, 14 }, { I + 5, J, 14 } }, wood[3])
    L.quad(ctx, { { I + 5, J, 14 }, { I + 5, J - 8, 14 }, { I + 5, J - 8, 13 }, { I + 5, J, 13 } }, wood[2])
    for z = 14, 7, -1 do L.dot(ctx, I + 4, J - 7, z, wood[2]) end
    L.dot(ctx, I + 4, J - 7, 6, L.C.STEEL[4])
  end
end

-- Market stall for a court or terrace: counter, two posts, a cloth canopy and a little display.
local function shopStall(L, ctx, x, y, z, w, d, theme)
  local wood = L.C.WOOD
  x, y, w, d = even(x), even(y), even(w), even(d)
  L.box(ctx, x, y, z, w, d, 2, wood, { base = true })
  L.box(ctx, x, y, z + 2, 2, 2, 3, wood, { base = false })
  L.box(ctx, x + w - 2, y, z + 2, 2, 2, 3, wood, { base = false })
  L.quad(ctx, { { x - 1, y - 1, z + 5 }, { x + w + 1, y - 1, z + 5 },
    { x + w + 1, y + d + 1, z + 4 }, { x - 1, y + d + 1, z + 4 } }, theme.roof[4])
  L.quad(ctx, { { x - 1, y + d + 1, z + 3 }, { x + w + 1, y + d + 1, z + 3 },
    { x + w + 1, y + d + 1, z + 4 }, { x - 1, y + d + 1, z + 4 } }, theme.roof[2])
  L.box(ctx, x + 2, y + 2, z + 2, 2, 2, 2, wood, { base = false })
  L.box(ctx, x + w - 4, y + 2, z + 2, 2, 2, 1, L.C.ADOBE, { base = false })
end

-- Commerce facade: taller floors, wide shopfront bays, merchant galleries. No laundry, no domestic
-- shutters; the fascia bands and gallery copings carry the identity.
local function shopDress(L, ctx, box, side, ss, theme, opt)
  opt = opt or {}
  local len = (side == 'L') and box.A or box.B
  local wall = opt.wall or theme.wall
  local storey = ss.storey
  local rows = math.max(1, math.floor((box.H - 8) / storey))
  local pitch = ss.shopW + 4
  local cols = math.max(1, math.floor((len - 6) / pitch))
  local total = cols * ss.shopW + (cols - 1) * 4
  local u0 = math.max(2, math.floor((len - total) / 4) * 2)
  local v0 = opt.v0 or 6
  rows = math.max(1, math.floor((box.H - v0 - 2) / storey))
  for r = 0, rows - 1 do
    local v = v0 + r * storey
    if v + ss.shopH + 3 <= box.H then
      if r % 2 == 0 then faceRect(L, ctx, box, side, 0, v - 3, len, 2, wall[5]) end
      for k = 0, cols - 1 do
        local u = u0 + k * pitch
        if u + ss.shopW + 1 <= len then
          shopFront(L, ctx, box, side, u, v, ss.shopW, ss.shopH, ss, theme)
        end
      end
      if ss.galEvery > 0 and r % ss.galEvery == 1 then
        local gw = math.min(len - u0, total + 2)
        shopGallery(L, ctx, box, side, u0 - 1, v - 2, gw, opt.galDepth or 3, ss, theme,
          (opt.seed or 1) + r, (opt.signs and side == 'L') or false)
      end
    end
  end
end

-- Covered terrace walkway for a market terrace: a row of posts carrying a shade/tile strip. Every
-- post stands on the terrace it belongs to (z is the terrace floor), so nothing floats.
local function shopWalkway(L, ctx, i0, j0, w, d, z, theme, along)
  local wood = L.C.WOOD
  i0, j0, w, d = even(i0), even(j0), even(w), even(d)
  local n = (along == 'j') and math.max(1, math.floor(d / 8)) or math.max(1, math.floor(w / 8))
  for k = 0, n do
    if along == 'j' then
      local j = j0 + math.min(d - 2, k * 8)
      L.box(ctx, i0, j, z, 2, 2, 5, wood, { base = true })
      L.box(ctx, i0 + w - 2, j, z, 2, 2, 5, wood, { base = true })
    else
      local i = i0 + math.min(w - 2, k * 8)
      L.box(ctx, i, j0, z, 2, 2, 5, wood, { base = true })
      L.box(ctx, i, j0 + d - 2, z, 2, 2, 5, wood, { base = true })
    end
  end
  if along == 'j' then
    L.quad(ctx, { { i0 - 1, j0 - 1, z + 6 }, { i0 + w + 1, j0 - 1, z + 6 },
      { i0 + w + 1, j0 + d + 1, z + 5 }, { i0 - 1, j0 + d + 1, z + 5 } }, theme.roof[3])
  else
    L.quad(ctx, { { i0 - 1, j0 - 1, z + 6 }, { i0 - 1, j0 + d + 1, z + 6 },
      { i0 + w + 1, j0 + d + 1, z + 5 }, { i0 + w + 1, j0 - 1, z + 5 } }, theme.roof[3])
  end
end

-- Masonry drum / pedestal: a solid square mass with a base band and a projecting cornice, used to
-- carry a lantern or a banner pole on a flat roof DECK. The checker binds `-- @deck` and `-- @crown`
-- markers to these calls, so the load path is declared once, next to the geometry.
local function shopDrum(L, ctx, x, y, z, w, d, h, theme)
  local stone = L.C.CONCRETE
  x, y, w, d = even(x), even(y), even(w), even(d)
  L.box(ctx, x, y, z, w, d, h, stone, { base = (z <= 0) })
  L.box(ctx, x - 2, y - 2, z, w + 4, d + 4, 3, stone, { base = false })          -- base band
  L.box(ctx, x - 2, y - 2, z + h - 2, w + 4, d + 4, 2, stone, { base = false })  -- cornice
  L.flat(ctx, x, y, w, d, stone[5], z + h)                                       -- the deck it carries
end

-- Commerce mass: same idea as `block`, but dressed by shopDress and topped by a shop roof.
local function shopBlock(L, c, x, y, z, w, d, h, ss, theme, opt)
  opt = opt or {}
  x, y, w, d = even(x), even(y), even(w), even(d)
  local wall = opt.wall or theme.wall
  local boxOpt = { base = (z <= 0) }
  if opt.top == 'parapet' then
    boxOpt.parapet = { p = 2, d = 2, floor = opt.roofFloor or theme.roof }
  elseif opt.top == 'none' then
    boxOpt.notop = true
  end
  local box = L.box(c.building, x, y, z, w, d, h, wall, boxOpt)
  local ctx = c.building
  if opt.dressL ~= false then shopDress(L, ctx, box, 'L', ss, theme, opt) end
  if opt.dressR ~= false then shopDress(L, ctx, box, 'R', ss, theme, opt) end
  return box
end
-- ------------------------------------------------------------------ shop tiers 4..8
-- Commerce silhouettes are deliberately NOT the housing ladder: a market hall with a roofed court,
-- a gallery slab plus warehouse wing, a podium with two unequal towers, three parallel trading halls,
-- and a stepped bazaar ziggurat. Heights follow the catalog canvases, but each tier differs in
-- massing, not merely in height.

-- shop_4: compact multi-storey market hall around a COVERED shopping court (a raised market lantern
-- over the court, carried on all four surrounding ranges).
local function shop4(L, B, c, theme, s, ss)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local wood = L.C.WOOD
  -- front market hall: deep ground arcade, two shopfront storeys, gallery above
  local front = shopBlock(L, c, 4, D - 26, 0, A - 8, 22, 50, ss, theme, { top = 'parapet', seed = 11, signs = true, v0 = 14 })
  shopArcade(L, c.building, front, 'L', ss, theme, { h = 11 })
  shopAwning(L, c.building, front, 'L', 6, 12, 20, ss.awn, 0, ss, theme)
  -- rear range and the two side ranges that enclose the shopping court
  shopBlock(L, c, 4, 4, 0, A - 8, 14, 26, ss, theme, { top = 'parapet', seed = 13 })
  shopBlock(L, c, 4, 18, 0, 8, 10, 34, ss, theme, { top = 'parapet', seed = 19, dressR = false })
  shopBlock(L, c, A - 12, 18, 0, 8, 10, 34, ss, theme, { top = 'parapet', seed = 23, dressL = false })
  -- upper trading storey set back over the front hall
  shopBlock(L, c, 8, D - 24, 50, A - 16, 18, 28, ss, theme, { top = 'none', seed = 17, signs = true })
  -- the lantern that roofs the court, standing on all four surrounding ranges (z 34)
  shopBlock(L, c, 12, 18, 34, A - 24, 10, 8, ss, theme,
    { top = 'none', seed = 29, dressL = false, dressR = false })
  -- three lantern posts, written out so each is a literal mass
  L.box(c.building, 12, 18, 34, 2, 10, 8, wood, { base = false })
  L.box(c.building, 18, 18, 34, 2, 10, 8, wood, { base = false })
  L.box(c.building, 24, 18, 34, 2, 10, 8, wood, { base = false })
  cap(L, c, 11, 17, 42, A - 22, 12, ss, theme)
  -- pitched roof over the front hall and the set-back trading storey
  cap(L, c, 7, D - 23, 78, A - 14, 18, ss, theme)
  -- court paving, a stall and planting
  L.flat(c.lot, 12, 18, A - 24, 10, L.C.CONCRETE[4], 0)
  shopStall(L, c.building, 14, 20, 0, 8, 6, theme)
  B.plant(L, c.lot, A - 20, 22, 0, 3, theme, 41)
  -- street portal: a wide shop entrance with an awning and steps
  local portal = shopBlock(L, c, A / 2 - 8, D - 26, 0, 16, 22, 50, ss, theme, { top = 'parapet', seed = 31, v0 = 14 })
  shopArcade(L, c.building, portal, 'L', ss, theme, { h = 11 })
  shopSign(L, c.building, portal, 'L', 4, 18, theme, 1)
  entrance(L, c, portal, 'L', 6, st4(ss), theme, A, D)
  buttress(L, c, 4, D - 26, 0, 4, 4, 30, theme)
  buttress(L, c, A - 8, D - 26, 0, 4, 4, 30, theme)
end

-- shop_5: larger merchant complex — a stacked open-gallery slab plus a long warehouse wing whose
-- loading bays and timber hoists face a goods yard.
local function shop5(L, B, c, theme, s, ss)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- gallery slab: open merchant galleries stepping up its street face
  local slab = shopBlock(L, c, 8, 12, 0, A - 16, D - 26, 120, ss, theme,
    { top = 'parapet', seed = 43, signs = true, v0 = 14 })
  shopArcade(L, c.building, slab, 'L', ss, theme, { h = 12 })
  shopAwning(L, c.building, slab, 'L', 4, 13, 20, ss.awn, 0, ss, theme)
  -- warehouse wing along the right side: lower, longer, with two loading bays and hoists
  local wh = shopBlock(L, c, A - 24, 8, 0, 12, 30, 52, ss, theme,
    { top = 'parapet', seed = 47, galDepth = 2 })
  shopDock(L, c.building, wh, 'R', 8, ss, theme, A, D)
  shopDock(L, c.building, wh, 'R', 22, ss, theme, A, D)
  -- upper setback over the slab, one more gallery, then a hipped market roof
  shopBlock(L, c, 12, 16, 120, A - 24, D - 34, 30, ss, theme, { top = 'none', seed = 53, signs = true })
  cap(L, c, 11, 15, 150, A - 22, D - 32, ss, theme)
  -- seller terrace on the slab top with two stalls and a planted edge
  shopStall(L, c.building, 14, 20, 122, 8, 6, theme)
  shopStall(L, c.building, 26, 22, 122, 8, 6, theme)
  B.plant(L, c.lot, 10, 10, 0, 3, theme, 57)
  -- goods yard paving at the back right, beside the warehouse
  L.flat(c.lot, A - 14, 8, 10, 16, L.C.CONCRETE[3], 0)
  -- street portal through the slab
  local portal = shopBlock(L, c, A / 2 - 8, D - 26, 0, 16, 22, 120, ss, theme,
    { top = 'parapet', seed = 59, v0 = 14 })
  shopArcade(L, c.building, portal, 'L', ss, theme, { h = 12 })
  entrance(L, c, portal, 'L', 6, st4(ss), theme, A, D)
  buttress(L, c, 8, D - 26, 0, 4, 4, 34, theme)
  buttress(L, c, A - 12, D - 26, 0, 4, 4, 34, theme)
end

-- shop_6: commercial tower over a substantial market podium, two unequal towers joined by an
-- enclosed bridge, and a separate service lane with a warehouse dock at the back.
local function shop6(L, B, c, theme, s, ss)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- market podium with a deep arcade on both street faces and awning rows
  local pod = shopBlock(L, c, 4, 4, 0, A - 8, D - 8, 44, ss, theme, { top = 'parapet', seed = 61, signs = true, v0 = 14 })
  shopArcade(L, c.building, pod, 'L', ss, theme, { h = 12 })
  shopArcade(L, c.building, pod, 'R', ss, theme, { h = 12 })
  shopAwning(L, c.building, pod, 'L', 6, 13, 24, ss.awn, 0, ss, theme)
  shopAwning(L, c.building, pod, 'R', 6, 13, 24, ss.awn, 0, ss, theme)
  -- market court on the podium roof, with stalls (decorative only)
  shopStall(L, c.building, 14, 14, 46, 8, 6, theme)
  shopStall(L, c.building, 26, 16, 46, 8, 6, theme)
  -- two unequal towers on the podium, joined by an enclosed bridge
  local t1 = shopBlock(L, c, 10, 10, 44, 24, 24, 176, ss, theme, { top = 'none', seed = 67, signs = true })
  local t2 = shopBlock(L, c, 40, 34, 44, 18, 18, 128, ss, theme, { top = 'none', seed = 71, signs = true })
  -- bridge: its ends are drawn well INSIDE both towers, so each end is carried by a mass
  -- @connector bridge towerA towerB: 14 x 16 x 10 spanning the gap; each end is 4 units inside a tower
  L.box(c.building, 30, 20, 148, 14, 16, 10, L.C.WOOD, { base = true })
  L.quad(c.building, { { 29, 18, 159 }, { 44, 18, 159 }, { 44, 36, 159 }, { 29, 36, 159 } }, theme.roof[3])
  -- crowns.  towerA tops out at z220 with a FLAT parapet deck (a rooftop trading terrace): a pitched
  -- cap there would give the lantern nothing but a ridge to perch on.  The load path is
  --   towerA deck z220  ->  drum 16x16 z220..244  ->  loggia 12x12 z244..260  ->  lantern cap
  -- so the loggia is founded on a real mass over its WHOLE footprint (12x12 inside 16x16 inside the
  -- 24x24 tower) in every biome, arid included (arid has pitch 0, so no roof rise to hide behind).
  -- @deck towerA: the flat deck the drum stands on
  cap(L, c, 10, 10, 220, 24, 24, { storey = ss.storey, pitch = 0 }, theme)
  shopDrum(L, c.building, 14, 14, 220, 16, 16, 24, theme)
  local loggiaZ = 244                                  -- = top of the drum, not the roof ridge
  -- @crown loggia on drum
  shopBlock(L, c, 16, 16, loggiaZ, 12, 12, 16, ss, theme, { top = 'none', seed = 79, signs = true })
  cap(L, c, 14, 14, loggiaZ + 16, 16, 16, ss, theme)   -- 16 wide so the lantern gets a real hip
  cap(L, c, 40, 34, 172, 18, 18, ss, theme)
  -- service lane at the back right with a warehouse dock, separate from the market frontage
  local wh = shopBlock(L, c, A - 26, 6, 0, 16, 16, 28, ss, theme, { top = 'parapet', seed = 73, dressL = false })
  shopDock(L, c.building, wh, 'L', 4, ss, theme, A, D)
  L.flat(c.lot, A - 34, 4, 22, 10, L.C.CONCRETE[3], 0)
  -- monumental market entrance on the street face, with a sign
  entrance(L, c, pod, 'L', 24, st4(ss), theme, A, D)
  shopSign(L, c.building, pod, 'L', 34, 14, theme, 0)
  buttress(L, c, 4, 4, 0, 5, 5, 46, theme)
  buttress(L, c, A - 9, 4, 0, 5, 5, 46, theme)
  local _ = { t1, t2 }
end

-- shop_7: multi-wing trading citadel — three parallel trading halls joined by two enclosed merchant
-- galleries, with a terrace market on every hall roof.
local function shop7(L, B, c, theme, s, ss)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local wood = L.C.WOOD
  -- halls are 24 deep with 8-unit service gaps between them, so the bridges below really span air
  -- The three halls are written out one by one (not built in a loop) so every mass is a literal
  -- call the structural checker can read straight out of this file.
  -- hall 1: street hall, j 70..94
  local h1 = shopBlock(L, c, 6, D - 26, 0, A - 12, 24, 300, ss, theme,
    { top = 'parapet', seed = 81, signs = true, v0 = 14 })
  shopArcade(L, c.building, h1, 'L', ss, theme, { h = 12 })
  -- the street face of hall 1 is the lot edge, so the awning goes on its sheltered rear face,
  -- over the service gap where the posts have room to stand
  shopAwning(L, c.building, h1, 'R', 6, 13, 30, ss.awn, 0, ss, theme)
  entrance(L, c, h1, 'R', 20, st4(ss), theme, A, D)
  shopStall(L, c.building, 12, D - 22, 302, 8, 6, theme)
  shopStall(L, c.building, 32, D - 22, 302, 8, 6, theme)
  shopWalkway(L, c.building, 46, D - 24, A - 56, 20, 302, theme, 'j')
  B.plant(L, c.lot, 10, D - 24, 302, 3, theme, 82)
  -- hall 2: the tallest hall, j 38..62
  local h2 = shopBlock(L, c, 6, D - 58, 0, A - 12, 24, 370, ss, theme,
    { top = 'parapet', seed = 83, signs = true, v0 = 14 })
  shopArcade(L, c.building, h2, 'L', ss, theme, { h = 12 })
  shopStall(L, c.building, 12, D - 54, 372, 8, 6, theme)
  shopStall(L, c.building, 32, D - 54, 372, 8, 6, theme)
  shopWalkway(L, c.building, 46, D - 56, A - 56, 20, 372, theme, 'j')
  B.plant(L, c.lot, 10, D - 56, 372, 3, theme, 84)
  -- hall 3: rear hall, j 4..28
  local h3 = shopBlock(L, c, 6, 4, 0, A - 12, 24, 276, ss, theme,
    { top = 'parapet', seed = 87, signs = true, v0 = 14 })
  shopArcade(L, c.building, h3, 'L', ss, theme, { h = 12 })
  shopStall(L, c.building, 12, 8, 278, 8, 6, theme)
  shopStall(L, c.building, 32, 8, 278, 8, 6, theme)
  shopWalkway(L, c.building, 46, 6, A - 56, 20, 278, theme, 'j')
  B.plant(L, c.lot, 10, 6, 278, 3, theme, 88)
  local _ = { h1, h2, h3 }
  -- enclosed merchant galleries spanning the gaps: each box reaches 4 units INTO both halls and
  -- its z sits inside both halls' height ranges (see the connections table in the report)
  -- Each gallery box reaches 4 units INTO both halls it joins and its z sits inside both halls'
  -- height ranges, so both ends are carried by a mass.  Written out one by one (not in a loop) so
  -- the structural checker can bind each connector to its two named hosts.
  -- @connector galleryA hall1 hall2
  L.box(c.building, 8, D - 38, 200, 24, 16, 10, wood, { base = true })   -- j 58..74: hall1 70..94, hall2 38..62
  L.quad(c.building, { { 7, D - 38, 211 }, { 33, D - 38, 211 }, { 33, D - 22, 211 }, { 7, D - 22, 211 } }, theme.roof[3])
  -- @connector galleryB hall2 hall3
  L.box(c.building, 8, 24, 240, 24, 18, 10, wood, { base = true })       -- j 24..42: hall3 4..28, hall2 38..62
  L.quad(c.building, { { 7, 24, 251 }, { 33, 24, 251 }, { 33, 42, 251 }, { 7, 42, 251 } }, theme.roof[3])
  -- @connector galleryC hall1 hall2
  L.box(c.building, 50, D - 38, 290, 24, 16, 10, wood, { base = true })  -- second gallery, j 58..74, south end
  L.quad(c.building, { { 49, D - 38, 301 }, { 75, D - 38, 301 }, { 75, D - 22, 301 }, { 49, D - 22, 301 } }, theme.roof[3])
  -- commercial crown on the tallest hall: wide hipped roof, then a drum punching THROUGH the ridge
  -- so the inhabited loggia stands on masonry rather than emerging out of a pitched roof surface.
  -- Load path: hall2 deck z370 -> drum 18x18 z370..382 (above every biome's ridge) -> loggia 12x12
  -- z382..404 -> lantern cap.  Arid's cap is a parapet at 372, so the drum clears it there too.
  cap(L, c, 6, 38, 370, A - 12, 24, ss, theme)
  shopDrum(L, c.building, 38, 42, 370, 18, 18, 12, theme)
  local topz = 382                                   -- = top of the crown drum
  -- @crown crownLoggia on hall2 drum
  shopBlock(L, c, 40, 44, topz, 12, 12, 22, ss, theme,
    { top = 'none', seed = 91, signs = true })
  cap(L, c, 39, 43, topz + 22, 14, 14, ss, theme)
  -- service lane between halls 2 and 3
  L.flat(c.lot, 6, D - 34, A - 12, 4, L.C.CONCRETE[3], 0)
  buttress(L, c, 6, D - 30, 0, 5, 5, 60, theme)
  buttress(L, c, A - 11, D - 30, 0, 5, 5, 60, theme)
  buttress(L, c, 6, 8, 0, 5, 5, 50, theme)
  buttress(L, c, A - 11, 8, 0, 5, 5, 50, theme)
end

-- shop_8: monumental vertical bazaar — a stepped ziggurat of connected market terraces with public
-- courts at three levels, corner turrets and a wide commercial crown.
local function shop8(L, B, c, theme, s, ss)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local wood = L.C.WOOD
  -- step 1: the public bazaar level, a broad plinth with a grand arcade and open market court
  local base = shopBlock(L, c, 6, 6, 0, A - 12, D - 12, 40, ss, theme, { top = 'parapet', seed = 101, signs = true, v0 = 14 })
  shopArcade(L, c.building, base, 'L', ss, theme, { h = 12 })
  shopArcade(L, c.building, base, 'R', ss, theme, { h = 12 })
  shopAwning(L, c.building, base, 'L', 10, 13, 40, ss.awn, 0, ss, theme)
  shopAwning(L, c.building, base, 'R', 10, 13, 40, ss.awn, 0, ss, theme)
  -- public court on the plinth roof: market stalls and planting
  L.flat(c.lot, 20, D - 30, 40, 18, L.C.CONCRETE[4], 0)
  for k = 0, 3 do shopStall(L, c.building, 22 + k * 10, D - 27, 42, 8, 6, theme) end
  for k = 1, 3 do B.plant(L, c.lot, 12 + k * 6, D - 18, 0, 3, theme, 110 + k) end
  entrance(L, c, base, 'L', 40, st4(ss), theme, A, D)
  entrance(L, c, base, 'R', 30, st4(ss), theme, A, D)
  -- step 2: trading terrace level with an arcade and four corner turrets
  local s2 = shopBlock(L, c, 14, 14, 40, A - 28, D - 28, 130, ss, theme, { top = 'parapet', seed = 103, signs = true, v0 = 14 })
  shopArcade(L, c.building, s2, 'L', ss, theme, { h = 10 })
  -- four corner turrets, written out so each is a literal mass
  shopBlock(L, c, 18, 18, 170, 12, 12, 70, ss, theme, { top = 'none', seed = 107 })
  cap(L, c, 18, 18, 240, 12, 12, ss, theme)
  shopBlock(L, c, A - 30, 18, 170, 12, 12, 70, ss, theme, { top = 'none', seed = 107 })
  cap(L, c, A - 30, 18, 240, 12, 12, ss, theme)
  shopBlock(L, c, 18, D - 30, 170, 12, 12, 70, ss, theme, { top = 'none', seed = 107 })
  cap(L, c, 18, D - 30, 240, 12, 12, ss, theme)
  shopBlock(L, c, A - 30, D - 30, 170, 12, 12, 70, ss, theme, { top = 'none', seed = 107 })
  cap(L, c, A - 30, D - 30, 240, 12, 12, ss, theme)
  shopStall(L, c.building, 22, D - 34, 172, 8, 6, theme)
  shopStall(L, c.building, 36, D - 30, 172, 8, 6, theme)
  -- step 3: market hall tier
  shopBlock(L, c, 26, 26, 170, A - 52, D - 52, 170, ss, theme, { top = 'parapet', seed = 109, signs = true })
  shopStall(L, c.building, 32, D - 44, 342, 8, 6, theme)
  B.plant(L, c.lot, 30, 30, 342, 3, theme, 113)
  -- step 4: upper trading block with an open loggia gallery
  shopBlock(L, c, 40, 40, 340, A - 80, D - 80, 150, ss, theme, { top = 'parapet', seed = 127, signs = true })
  shopStall(L, c.building, 46, D - 60, 492, 8, 6, theme)
  -- step 5 + crown: the step-5 block is capped by a parapet so it really IS a roof deck, and the
  -- crown loggia stands on that deck inside its footprint.  The two banners stand on the SAME deck,
  -- flanking the loggia (i52..54 and i74..76 against its faces at i54 and i74), so their poles are
  -- founded on step 5's deck (z550) rather than starting in mid air at the loggia's roof level.
  shopBlock(L, c, A / 2 - 14, D / 2 - 14, 490, 28, 28, 60, ss, theme, { top = 'parapet', seed = 131, signs = true })
  -- @deck step5: the crown deck at z550
  local crownZ = 550                                  -- = top of step 5, so the loggia is founded
  -- @crown crownLoggia on step5
  shopBlock(L, c, A / 2 - 10, D / 2 - 10, crownZ, 20, 20, 50, ss, theme,
    { top = 'none', seed = 139, signs = true })
  cap(L, c, A / 2 - 9, D / 2 - 9, crownZ + 50, 18, 18, ss, theme)
  -- two hanging banners flanking the crown loggia: 2x2 poles standing on step 5's deck, cloth hung
  -- from the pole head and projecting outward, clear of the loggia walls (i54..74)
  -- @banner westPole on step5
  L.box(c.building, A / 2 - 12, D / 2 - 2, crownZ, 2, 2, 20, wood, { base = true })
  L.quad(c.building, { { A / 2 - 12, D / 2 - 2, crownZ + 18 },
    { A / 2 - 18, D / 2 - 2, crownZ + 16 },
    { A / 2 - 18, D / 2 - 2, crownZ + 8 },
    { A / 2 - 12, D / 2 - 2, crownZ + 10 } }, theme.roof[4])
  -- @banner eastPole on step5
  L.box(c.building, A / 2 + 10, D / 2 - 2, crownZ, 2, 2, 20, wood, { base = true })
  L.quad(c.building, { { A / 2 + 10, D / 2 - 2, crownZ + 18 },
    { A / 2 + 16, D / 2 - 2, crownZ + 16 },
    { A / 2 + 16, D / 2 - 2, crownZ + 8 },
    { A / 2 + 10, D / 2 - 2, crownZ + 10 } }, theme.roof[4])
  -- covered merchant walkways along the setback terraces, each founded on that terrace's floor:
  -- step3's top (130) and step4's top (250) are the two roof terraces; step5's deck is 390.
  shopWalkway(L, c.building, 40, 40, A - 80, 18, 340, theme, 'i')
  shopWalkway(L, c.building, 40, D - 58, A - 80, 18, 340, theme, 'i')
  shopWalkway(L, c.building, 54, 54, A - 108, 14, 490, theme, 'i')
  shopStall(L, c.building, 60, 60, 340, 8, 6, theme)
  -- service access at the back, distinct from the public courts
  local wh = shopBlock(L, c, A - 40, 6, 0, 24, 14, 24, ss, theme, { top = 'parapet', seed = 137, dressL = false })
  shopDock(L, c.building, wh, 'L', 6, ss, theme, A, D)
  L.flat(c.lot, A - 48, 4, 34, 8, L.C.CONCRETE[3], 0)
  for _, x in ipairs({ 6, 30, 54, A - 30, A - 6 }) do buttress(L, c, x, D - 18, 0, 5, 5, 44, theme) end
end

-- ------------------------------------------------------------------ CLINIC (hospital) section
-- Clinic-specific helpers and tiers. Everything here is separate from the housing and commerce
-- helpers above: no shared function is edited, so home_4..8 and shop_4..8 output cannot change.
--
-- Identity (must survive greyscale): PALE masonry as the primary material, a green health cross on a
-- pale plaque, orderly ward wings with tall patient windows, sheltered patient galleries with a
-- solid parapet (not a domestic railing), covered walks around healing courtyards, planted terraces,
-- a main entrance with a canopy and a discreet service door. No stalls, no merchant banners, no
-- laundry, no helipad, no glass curtain wall.
--
-- HEIGHT CONTRACT: helpers that take a floor-LOCAL height add box.z0 exactly once. Helpers that take
-- a WORLD height (clinicGallery, clinicWalk, clinicGarden, clinicBench) say so and never add z0.

local CLINIC = {
  tropical = { storey = 12, pitch = 5, open = true, shade = true, awn = 4, recess = false },
  temperate = { storey = 12, pitch = 6, open = true, shade = false, awn = 3, recess = false },
  arid = { storey = 13, pitch = 0, open = false, shade = true, awn = 3, recess = true },
  northern = { storey = 12, pitch = 7, open = false, shade = false, awn = 2, recess = false },
}

-- Health emblem: a pale plaque with a green cross, painted on a wall face.
-- Drawn in SCREEN space so the cross keeps crisp 1 px arms, but every horizontal run follows the
-- wall's 2:1 isometric shear (1 px down per 2 px of run), so the plaque reads as painted on the wall
-- rather than pasted over it.  `v` is a floor-LOCAL height; box.z0 is added exactly once.
local function clinicEmblem(L, c, box, side, u, v, size, theme)
  local z = box.z0 + v
  local i, j
  if side == 'L' then
    i, j = box.i0 + u, box.j0 + box.B
  else
    i, j = box.i0 + box.A, box.j0 + box.B - u
  end
  local p = L.P(c.building, i, j, z)
  local x0, y0 = math.floor(p[1] + 0.5), math.floor(p[2] + 0.5)
  local sy = (side == 'L') and 1 or -1
  local plaque, rim, cross = L.C.WHITE[5], L.C.WHITE[2], L.C.ROOF_GREEN[4]
  local n = math.max(13, size)
  if n % 2 == 0 then n = n + 1 end
  local function run(x, y, len, col)
    for k = 0, len - 1 do L.px(c.building, x + k, y + sy * math.floor(k / 2), col) end
  end
  -- sheared plaque: a wall panel, so its horizontal edges follow the wall's 2:1 step
  for r = 0, n - 1 do
    run(x0, y0 - r, n, (r == 0 or r == n - 1) and rim or plaque)
  end
  for r = 0, n - 1 do
    L.px(c.building, x0, y0 - r, rim)
    L.px(c.building, x0 + n - 1, y0 - r + sy * math.floor((n - 1) / 2), rim)
  end
  -- The cross itself is drawn UPRIGHT in screen space: a medical cross is a symbol, not a wall
  -- texture, and shearing it turns it into a diagonal blob at 1x.
  --
  -- PLACEMENT IS DERIVED FROM THE PLAQUE'S ACTUAL SHEARED INTERIOR, per column, not from a guessed
  -- offset.  The plaque's interior at column k spans rows
  --     [y0 - (n-2) + sy*f(k),  y0 - 1 + sy*f(k)],   f(k) = floor(k/2)
  -- so a cross of `span` rows starting at cy is fully inside only when, for EVERY column k the
  -- cross uses,
  --     cy >= y0 - (n-2) + sy*f(k)        and        cy + span - 1 <= y0 - 1 + sy*f(k).
  -- Intersect those over k and take the middle of the surviving band.  On the L face (sy = +1) the
  -- plaque steps DOWN to the right, so the binding constraint is the top of the rightmost column;
  -- on the R face (sy = -1) it is the top of the leftmost.  Iterating k covers both directions.
  local function place(arm)
    local span = arm * 3
    local kc = math.floor((n - span) / 2)
    local kmin, kmax = kc, kc + span - 1
    local top, bot = -math.huge, math.huge
    for k = kmin, kmax do
      local f = sy * math.floor(k / 2)
      top = math.max(top, -(n - 2) + f)          -- highest legal cy, relative to y0
      bot = math.min(bot, -1 + f - span + 1)     -- lowest legal cy, relative to y0
    end
    return span, arm, kmin, kmax, top, bot
  end
  local span, arm, kmin, kmax, top, bot = place(2)
  if bot < top then span, arm, kmin, kmax, top, bot = place(1) end
  if bot < top then return end                   -- plaque too small to hold any cross
  local cx = x0 + kmin
  local cy = y0 + top + math.floor((bot - top) / 2)
  for r = 0, span - 1 do
    for k = 0, span - 1 do
      local in_v = (k >= arm and k < arm * 2)
      local in_h = (r >= arm and r < arm * 2)
      if in_v or in_h then L.px(c.building, cx + k, cy + r, cross) end
    end
  end
  local _ = kmax
end

-- Pale ward mass: tall patient windows, a sill under each, a string course every other storey and
-- every third bay a wider window.  opt: top = 'parapet' | 'none', dressL/dressR, v0.
local function clinicWard(L, c, x, y, z, w, d, h, cs, theme, opt)
  opt = opt or {}
  x, y, w, d = even(x), even(y), even(w), even(d)
  local wall = L.C.WHITE
  local boxOpt = { base = (z <= 0) }
  if opt.top == 'parapet' then
    boxOpt.parapet = { p = 2, d = 2, floor = theme.roof }
  elseif opt.top == 'none' then
    boxOpt.notop = true
  end
  local box = L.box(c.building, x, y, z, w, d, h, wall, boxOpt)
  local ctx = c.building
  local v0 = opt.v0 or 6
  for _, side in ipairs({ 'L', 'R' }) do
    local on = (side == 'L') and (opt.dressL ~= false) or (side == 'R' and opt.dressR ~= false)
    if on then
      local len = (side == 'L') and w or d
      local cols = math.max(1, math.floor((len - 6) / 8))
      local rows = math.max(1, math.floor((h - v0 - 4) / cs.storey))
      for r = 0, rows - 1 do
        local v = v0 + r * cs.storey
        for k = 0, cols - 1 do
          local u = 4 + k * 8
          local ww = (k % 3 == 2) and 4 or 2
          if cs.recess then faceRect(L, ctx, box, side, u - 1, v, ww + 2, 6, wall[2]) end
          faceRect(L, ctx, box, side, u, v, ww, 5, L.C.GLASS[2])
          faceRect(L, ctx, box, side, u, v + 4, ww, 1, L.C.GLASS[4])
          faceRect(L, ctx, box, side, u - 1, v - 1, ww + 2, 1, wall[4])
        end
        if r % 2 == 1 then
          faceRect(L, ctx, box, side, 0, v + cs.storey - 3, len, 1, wall[4])
        end
      end
    end
  end
  return box
end

-- Patient gallery: a projecting sheltered walkway with a SOLID parapet (patient safety rail, not a
-- domestic railing).  `z` is a WORLD height.  side 'L' runs along +i and projects +j; side 'R' runs
-- along -j and projects +i.  Open biomes get posts + a shade canopy; enclosed biomes get a glazed
-- strip, so the walk is protected from wind and cold.
local function clinicGallery(L, c, side, i0, j0, z, w, depth, cs, theme, seed)
  local ctx, wall, stone = c.building, L.C.WHITE, L.C.CONCRETE
  local d = math.max(2, even(depth))
  i0, j0, w = even(i0), even(j0), even(w)
  local function slab(a0, b0, a1, b1)
    L.quad(ctx, { { a0, b0, z }, { a1, b0, z }, { a1, b1, z }, { a0, b1, z } }, stone[4])
    L.quad(ctx, { { a0, b1, z - 1 }, { a1, b1, z - 1 }, { a1, b1, z }, { a0, b1, z } }, stone[3])
  end
  if side == 'L' then
    slab(i0, j0, i0 + w, j0 + d)
    L.quad(ctx, { { i0, j0 + d, z }, { i0 + w, j0 + d, z }, { i0 + w, j0 + d, z + 4 }, { i0, j0 + d, z + 4 } }, wall[4])
    L.quad(ctx, { { i0, j0 + d, z + 4 }, { i0 + w, j0 + d, z + 4 }, { i0 + w, j0 + d, z + 5 }, { i0, j0 + d, z + 5 } }, wall[5])
    if cs.open then
      for k = 0, math.max(1, math.floor(w / 8)) do
        local uu = i0 + math.min(w - 1, k * 8)
        L.quad(ctx, { { uu, j0 + d, z + 5 }, { uu + 1, j0 + d, z + 5 }, { uu + 1, j0 + d, z + 11 }, { uu, j0 + d, z + 11 } }, wall[3])
      end
      if cs.shade then
        L.quad(ctx, { { i0 - 1, j0 - 1, z + 12 }, { i0 + w + 1, j0 - 1, z + 12 },
          { i0 + w + 1, j0 + d + 1, z + 11 }, { i0 - 1, j0 + d + 1, z + 11 } }, theme.roof[3])
      end
    else
      L.quad(ctx, { { i0, j0 + d, z + 5 }, { i0 + w, j0 + d, z + 5 }, { i0 + w, j0 + d, z + 11 }, { i0, j0 + d, z + 11 } }, L.C.GLASS[2])
      for k = 0, math.max(1, math.floor(w / 6)) do
        local uu = i0 + math.min(w - 1, k * 6)
        L.quad(ctx, { { uu, j0 + d, z + 5 }, { uu + 1, j0 + d, z + 5 }, { uu + 1, j0 + d, z + 11 }, { uu, j0 + d, z + 11 } }, wall[4])
      end
      L.quad(ctx, { { i0 - 1, j0 - 1, z + 12 }, { i0 + w + 1, j0 - 1, z + 12 },
        { i0 + w + 1, j0 + d + 1, z + 11 }, { i0 - 1, j0 + d + 1, z + 11 } }, theme.roof[3])
    end
  else
    slab(i0, j0 - w, i0 + d, j0)
    L.quad(ctx, { { i0 + d, j0, z }, { i0 + d, j0 - w, z }, { i0 + d, j0 - w, z + 4 }, { i0 + d, j0, z + 4 } }, wall[4])
    L.quad(ctx, { { i0 + d, j0, z + 4 }, { i0 + d, j0 - w, z + 4 }, { i0 + d, j0 - w, z + 5 }, { i0 + d, j0, z + 5 } }, wall[5])
    if cs.open then
      for k = 0, math.max(1, math.floor(w / 8)) do
        local jj = j0 - math.min(w - 1, k * 8)
        L.quad(ctx, { { i0 + d, jj, z + 5 }, { i0 + d, jj - 1, z + 5 }, { i0 + d, jj - 1, z + 11 }, { i0 + d, jj, z + 11 } }, wall[3])
      end
      if cs.shade then
        L.quad(ctx, { { i0 - 1, j0 + 1, z + 12 }, { i0 - 1, j0 - w - 1, z + 12 },
          { i0 + d + 1, j0 - w - 1, z + 11 }, { i0 + d + 1, j0 + 1, z + 11 } }, theme.roof[3])
      end
    else
      L.quad(ctx, { { i0 + d, j0, z + 5 }, { i0 + d, j0 - w, z + 5 }, { i0 + d, j0 - w, z + 11 }, { i0 + d, j0, z + 11 } }, L.C.GLASS[2])
      for k = 0, math.max(1, math.floor(w / 6)) do
        local jj = j0 - math.min(w - 1, k * 6)
        L.quad(ctx, { { i0 + d, jj, z + 5 }, { i0 + d, jj - 1, z + 5 }, { i0 + d, jj - 1, z + 11 }, { i0 + d, jj, z + 11 } }, wall[4])
      end
      L.quad(ctx, { { i0 - 1, j0 + 1, z + 12 }, { i0 - 1, j0 - w - 1, z + 12 },
        { i0 + d + 1, j0 - w - 1, z + 11 }, { i0 + d + 1, j0 + 1, z + 11 } }, theme.roof[3])
    end
  end
  local _ = seed
end

-- Covered ground walk around a healing courtyard: pale posts carrying a tile/shade strip.  Every
-- post stands on `z` (a WORLD height), so nothing floats.
local function clinicWalk(L, c, i0, j0, w, d, z, theme, along)
  local wall = L.C.WHITE
  i0, j0, w, d = even(i0), even(j0), even(w), even(d)
  if along == 'i' then
    for k = 0, math.max(1, math.floor(w / 8)) do
      local uu = i0 + math.min(w - 2, k * 8)
      L.box(c.building, uu, j0 + d - 2, z, 2, 2, 10, wall, { base = (z <= 0) })
    end
  else
    for k = 0, math.max(1, math.floor(d / 8)) do
      local jj = j0 + math.min(d - 2, k * 8)
      L.box(c.building, i0 + w - 2, jj, z, 2, 2, 10, wall, { base = (z <= 0) })
    end
  end
  L.quad(c.building, { { i0 - 1, j0 - 1, z + 11 }, { i0 + w + 1, j0 - 1, z + 11 },
    { i0 + w + 1, j0 + d + 1, z + 10 }, { i0 - 1, j0 + d + 1, z + 10 } }, theme.roof[3])
end

-- Bench: a 2 px seat on two legs.  `z` is a WORLD height.
local function clinicBench(L, c, x, y, z, theme)
  local wood = L.C.WOOD
  x, y = even(x), even(y)
  -- z is a WORLD height (the terrace floor).  Every part below is stacked with NO gap: two legs
  -- from the terrace to the underside of the seat, the seat directly on the legs, the backrest
  -- directly on the seat.  cliniccheck.py's `bench` test re-parses these boxes and fails if any
  -- part stops short of the one it should carry.
  L.box(c.building, x, y, z, 2, 2, 4, wood, { base = (z <= 0) })          -- leg, z..z+4
  L.box(c.building, x + 4, y, z, 2, 2, 4, wood, { base = false })        -- leg, z..z+4
  L.box(c.building, x, y, z + 4, 6, 2, 2, wood, { base = false })        -- seat, z+4..z+6
  L.box(c.building, x, y, z + 6, 6, 2, 2, wood, { base = false })        -- backrest, z+6..z+8
end

-- Healing garden terrace: planted beds, a bench and a low kerb.  `z` is a WORLD height.
local function clinicGarden(L, c, B, x, y, z, w, d, theme, seed, n)
  x, y, w, d = even(x), even(y), even(w), even(d)
  w, d = math.max(8, w), math.max(8, d)
  L.flat(c.building, x + 2, y + 2, w - 4, d - 4, theme.ground[3], z)
  for k = 1, n do
    local i = x + 3 + ((k * 7 + seed) % math.max(2, w - 7))
    local j = y + 3 + ((k * 5 + seed * 3) % math.max(2, d - 7))
    B.plant(L, c.building, i, j, z, 3, theme, seed + k)
  end
  for k = 0, w - 4, 4 do
    L.dot(c.building, x + 2 + k, y + d - 2, z, theme.leaf[3])
  end
  if w >= 12 and d >= 8 then clinicBench(L, c, x + 4, y + 3, z, theme) end
end

-- Main entrance: wide double door in a pale frame, steps, and a canopy that projects OUTWARD over
-- its own posts.  `v` is a floor-LOCAL height.
local function clinicEntrance(L, c, box, side, u, cs, theme, A, D)
  local ctx, wall, wood = c.building, L.C.WHITE, L.C.WOOD
  local room = (side == 'L') and (D - (box.j0 + box.B)) or (A - (box.i0 + box.A))
  local depth = math.max(2, even(math.min(cs.awn, room - 1)))
  faceRect(L, ctx, box, side, u - 1, 0, 10, 12, wall[2])
  faceRect(L, ctx, box, side, u, 0, 8, 10, L.C.GLASS[2])
  faceRect(L, ctx, box, side, u + 3, 0, 1, 10, wall[4])
  faceRect(L, ctx, box, side, u, 9, 8, 1, L.C.GLASS[4])
  faceRect(L, ctx, box, side, u - 1, 10, 10, 1, wall[5])
  local zw = box.z0 + 12
  if side == 'L' then
    local J, i = box.j0 + box.B, box.i0 + u
    L.quad(ctx, { { i - 2, J, zw }, { i + 10, J, zw }, { i + 10, J + depth, zw - 2 }, { i - 2, J + depth, zw - 2 } }, theme.roof[4])
    L.quad(ctx, { { i - 2, J + depth, zw - 3 }, { i + 10, J + depth, zw - 3 }, { i + 10, J + depth, zw - 2 }, { i - 2, J + depth, zw - 2 } }, theme.roof[2])
    L.box(ctx, i, J + depth - 2, box.z0, 2, 2, 12, wood, { base = true })
    L.box(ctx, i + 8, J + depth - 2, box.z0, 2, 2, 12, wood, { base = true })
    L.flat(c.lot, i - 2, J, 12, depth, L.C.CONCRETE[4], 0)
  else
    local I, ja = box.i0 + box.A, box.j0 + box.B - u
    L.quad(ctx, { { I, ja + 2, zw }, { I, ja - 10, zw }, { I + depth, ja - 10, zw - 2 }, { I + depth, ja + 2, zw - 2 } }, theme.roof[4])
    L.quad(ctx, { { I + depth, ja + 2, zw - 3 }, { I + depth, ja - 10, zw - 3 }, { I + depth, ja - 10, zw - 2 }, { I + depth, ja + 2, zw - 2 } }, theme.roof[2])
    L.box(ctx, I + depth - 2, ja - 2, box.z0, 2, 2, 12, wood, { base = true })
    L.box(ctx, I + depth - 2, ja - 10, box.z0, 2, 2, 12, wood, { base = true })
    L.flat(c.lot, I, ja - 10, depth, 12, L.C.CONCRETE[4], 0)
  end
end

-- Discreet service door: plain, no canopy, a step and a small bin store.  `v` is floor-LOCAL.
local function clinicService(L, c, box, side, u, theme)
  local ctx, wall = c.building, L.C.WHITE
  faceRect(L, ctx, box, side, u - 1, 0, 6, 8, wall[2])
  faceRect(L, ctx, box, side, u, 0, 4, 7, L.C.WOOD[2])
  faceRect(L, ctx, box, side, u, 6, 4, 1, L.C.WOOD[3])
  faceRect(L, ctx, box, side, u - 1, -1, 6, 1, L.C.CONCRETE[3])
end

-- Pale masonry drum / pedestal carrying a crown.  `z` is a WORLD height.
local function clinicDrum(L, c, x, y, z, w, d, h, theme)
  local wall = L.C.WHITE
  x, y, w, d = even(x), even(y), even(w), even(d)
  L.box(c.building, x, y, z, w, d, h, wall, { base = (z <= 0) })
  L.box(c.building, x - 2, y - 2, z, w + 4, d + 4, 3, wall, { base = false })
  L.box(c.building, x - 2, y - 2, z + h - 2, w + 4, d + 4, 2, wall, { base = false })
  L.flat(c.building, x, y, w, d, L.C.CONCRETE[4], z + h)
end

-- Roof water tank on a real deck.  `z` is a WORLD height (the deck it stands on).
local function clinicTank(L, c, x, y, z, theme)
  local steel = L.C.STEEL
  L.box(c.building, x, y, z, 6, 6, 2, L.C.CONCRETE, { base = (z <= 0) })
  L.cyl(c.building, x + 3, y + 3, z + 2, 3, 8, steel, { matte = true })
  L.cyl(c.building, x + 3, y + 3, z + 10, 3, 1, steel, { matte = true })
end

-- ------------------------------------------------------------------ clinic tiers 4..8
-- clinic_4: compact multi-storey clinic around a healing courtyard, entrance canopy and emblem.
local function clinic4(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- front ward block, rear ward block and two side ranges enclosing the healing courtyard
  local front = clinicWard(L, c, 4, 26, 0, A - 8, 18, 50, cs, theme, { top = 'parapet' })
  clinicWard(L, c, 4, 4, 0, A - 8, 12, 26, cs, theme, { top = 'parapet' })
  clinicWard(L, c, 4, 16, 0, 8, 10, 34, cs, theme, { top = 'parapet', dressR = false })
  clinicWard(L, c, A - 12, 16, 0, 8, 10, 34, cs, theme, { top = 'parapet', dressL = false })
  -- upper ward storey set back over the front block
  clinicWard(L, c, 8, 28, 50, A - 16, 14, 34, cs, theme, { top = 'none' })
  cap(L, c, 8, 28, 84, A - 16, 14, cs, theme)
  -- healing courtyard: covered walks on two sides, a garden bed and a bench
  clinicWalk(L, c, 12, 16, 24, 10, 0, theme, 'i')
  clinicGarden(L, c, B, 12, 18, 0, 24, 8, theme, 41, 3)
  -- main entrance with canopy on the street face, service door at the back
  clinicEntrance(L, c, front, 'L', 4, cs, theme, A, D)
  clinicService(L, c, front, 'R', 6, theme)
  -- health emblem, drawn last so nothing can cover it
  clinicEmblem(L, c, front, 'L', 16, 30, 11, theme)
end

-- clinic_5: hospital block with unequal ward wings and protected patient galleries.
local function clinic5(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- main block plus two UNEQUAL ward wings (west 76, east 96)
  local main = clinicWard(L, c, 8, 10, 0, 32, 32, 120, cs, theme, { top = 'parapet' })
  clinicWard(L, c, 4, 18, 0, 8, 24, 76, cs, theme, { top = 'parapet', dressR = false })
  clinicWard(L, c, 36, 14, 0, 8, 28, 96, cs, theme, { top = 'parapet', dressL = false })
  -- protected patient galleries spanning the whole front, carried by BOTH wings at each end
  clinicGallery(L, c, 'L', 4, 42, 40, 40, 4, cs, theme, 51)
  clinicGallery(L, c, 'L', 4, 42, 68, 40, 4, cs, theme, 53)
  -- upper setback and its roof
  clinicWard(L, c, 12, 14, 120, 24, 24, 26, cs, theme, { top = 'none' })
  cap(L, c, 12, 14, 146, 24, 24, cs, theme)
  -- healing terrace on the west wing roof, planted
  clinicGarden(L, c, B, 4, 20, 76, 8, 20, theme, 57, 2)
  -- main entrance and a discreet service door on the east wing
  clinicEntrance(L, c, main, 'L', 2, cs, theme, A, D)
  clinicService(L, c, main, 'R', 6, theme)
  clinicEmblem(L, c, main, 'L', 14, 96, 11, theme)
end

-- clinic_6: substantial hospital podium with a taller ward tower, connected annex and garden
-- setbacks.
local function clinic6(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- podium
  local pod = clinicWard(L, c, 4, 4, 0, A - 8, D - 8, 44, cs, theme, { top = 'parapet' })
  -- ward tower and a lower connected annex
  local tower = clinicWard(L, c, 10, 10, 44, 24, 24, 176, cs, theme, { top = 'none' })
  clinicWard(L, c, 38, 14, 44, 18, 18, 96, cs, theme, { top = 'parapet' })
  -- enclosed bridge: 4 units into the tower and 4 into the annex
  -- @connector bridge towerA annex
  L.box(c.building, 30, 18, 120, 12, 12, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 29, 16, 131 }, { 43, 16, 131 }, { 43, 32, 131 }, { 29, 32, 131 } }, theme.roof[3])
  -- tower crown: flat deck -> drum -> ward block -> lantern roof (full-footprint support)
  -- @deck towerA: flat deck the crown drum stands on
  cap(L, c, 10, 10, 220, 24, 24, { storey = cs.storey, pitch = 0 }, theme)
  clinicDrum(L, c, 14, 14, 220, 16, 16, 20, theme)
  -- @crown crownBlock on drum
  clinicWard(L, c, 16, 16, 240, 12, 12, 22, cs, theme, { top = 'none' })
  cap(L, c, 14, 14, 262, 16, 16, cs, theme)
  -- garden setbacks on the podium roof, and a water tank on the annex roof
  clinicGarden(L, c, B, 4, 34, 44, 20, 22, theme, 61, 3)
  clinicGarden(L, c, B, 40, 34, 44, 20, 22, theme, 67, 3)
  clinicTank(L, c, 46, 20, 140, theme)
  -- main entrance on the podium street face, service access at the back
  clinicEntrance(L, c, pod, 'L', 20, cs, theme, A, D)
  clinicService(L, c, pod, 'R', 8, theme)
  clinicEmblem(L, c, tower, 'L', 8, 150, 11, theme)
end

-- clinic_7: multi-tower medical campus with two-ended covered connections and several healing
-- terraces.
local function clinic7(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- rear treatment block
  clinicWard(L, c, 6, 6, 0, A - 12, 48, 120, cs, theme, { top = 'parapet' })
  -- three ward towers of unequal height along the street
  local ta = clinicWard(L, c, 6, 62, 0, 24, 24, 300, cs, theme, { top = 'parapet' })
  local tb = clinicWard(L, c, 36, 62, 0, 24, 24, 360, cs, theme, { top = 'none' })
  clinicWard(L, c, 66, 62, 0, 24, 24, 276, cs, theme, { top = 'parapet' })
  -- covered connections: each box reaches 4 units INTO both towers it joins
  -- @connector linkA towerA towerB
  L.box(c.building, 26, 68, 120, 14, 12, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 25, 66, 131 }, { 41, 66, 131 }, { 41, 82, 131 }, { 25, 82, 131 } }, theme.roof[3])
  -- @connector linkB towerB towerC
  L.box(c.building, 56, 68, 200, 14, 12, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 55, 66, 211 }, { 71, 66, 211 }, { 71, 82, 211 }, { 55, 82, 211 } }, theme.roof[3])
  -- @connector linkC towerA towerB
  L.box(c.building, 26, 68, 260, 14, 12, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 25, 66, 271 }, { 41, 66, 271 }, { 41, 82, 271 }, { 25, 82, 271 } }, theme.roof[3])
  -- crown on the tallest tower: deck -> drum -> ward block -> lantern roof
  -- @deck towerB: flat deck the crown drum stands on
  cap(L, c, 36, 62, 360, 24, 24, { storey = cs.storey, pitch = 0 }, theme)
  clinicDrum(L, c, 39, 65, 360, 18, 18, 24, theme)
  -- @crown crownBlock on drum
  clinicWard(L, c, 42, 68, 384, 12, 12, 24, cs, theme, { top = 'none' })
  cap(L, c, 40, 66, 408, 16, 16, cs, theme)
  -- healing terraces on the tower roofs and the rear block roof
  clinicGarden(L, c, B, 6, 64, 300, 24, 20, theme, 71, 2)
  clinicGarden(L, c, B, 66, 64, 276, 24, 20, theme, 73, 2)
  clinicGarden(L, c, B, 8, 8, 120, 40, 20, theme, 79, 3)
  clinicTank(L, c, 60, 10, 120, theme)
  -- main entrance on the first tower, service access at the back of the rear block
  clinicEntrance(L, c, ta, 'L', 6, cs, theme, A, D)
  clinicService(L, c, ta, 'R', 6, theme)
  clinicEmblem(L, c, tb, 'L', 8, 300, 11, theme)
end

-- clinic_8: monumental vertical hospital district — several ward masses around a strong central
-- treatment/administration core, with a visible health identity and human-scale entrances.
local function clinic8(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- broad plinth: the public hospital level
  local plinth = clinicWard(L, c, 6, 6, 0, A - 12, D - 12, 40, cs, theme, { top = 'parapet' })
  -- central treatment / administration core
  local core = clinicWard(L, c, 44, 44, 40, 40, 40, 500, cs, theme, { top = 'none' })
  -- four ward wings around the core, all of different heights
  clinicWard(L, c, 20, 88, 40, 88, 24, 180, cs, theme, { top = 'parapet' })   -- front
  clinicWard(L, c, 20, 16, 40, 88, 24, 150, cs, theme, { top = 'parapet' })   -- back
  clinicWard(L, c, 16, 44, 40, 24, 40, 210, cs, theme, { top = 'parapet' })   -- west
  clinicWard(L, c, 88, 44, 40, 24, 40, 240, cs, theme, { top = 'parapet' })   -- east
  -- covered connections from the core to each wing, 4 units into both receivers
  -- @connector linkFrontA core wingFront
  L.box(c.building, 56, 80, 120, 16, 12, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 55, 78, 131 }, { 73, 78, 131 }, { 73, 94, 131 }, { 55, 94, 131 } }, theme.roof[3])
  -- @connector linkFrontB core wingFront
  L.box(c.building, 56, 80, 200, 16, 12, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 55, 78, 211 }, { 73, 78, 211 }, { 73, 94, 211 }, { 55, 94, 211 } }, theme.roof[3])
  -- @connector linkBack core wingBack
  L.box(c.building, 56, 36, 120, 16, 12, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 55, 34, 131 }, { 73, 34, 131 }, { 73, 50, 131 }, { 55, 50, 131 } }, theme.roof[3])
  -- @connector linkWest core wingWest
  L.box(c.building, 36, 56, 150, 12, 16, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 34, 55, 161 }, { 50, 55, 161 }, { 50, 73, 161 }, { 34, 73, 161 } }, theme.roof[3])
  -- @connector linkEast core wingEast
  L.box(c.building, 80, 56, 180, 12, 16, 10, L.C.WHITE, { base = true })
  L.quad(c.building, { { 78, 55, 191 }, { 94, 55, 191 }, { 94, 73, 191 }, { 78, 73, 191 } }, theme.roof[3])
  -- core crown: deck -> drum -> administration block -> lantern roof, all full-footprint
  -- @deck core: flat deck the crown drum stands on
  cap(L, c, 44, 44, 540, 40, 40, { storey = cs.storey, pitch = 0 }, theme)
  clinicDrum(L, c, 49, 49, 540, 30, 30, 30, theme)
  -- @crown crownBlock on drum
  clinicWard(L, c, 52, 52, 570, 24, 24, 36, cs, theme, { top = 'none' })
  cap(L, c, 50, 50, 606, 28, 28, cs, theme)
  -- healing terraces on the wing roofs and the plinth, plus a roof tank
  clinicGarden(L, c, B, 22, 90, 220, 40, 20, theme, 81, 3)
  clinicGarden(L, c, B, 22, 18, 190, 40, 20, theme, 83, 3)
  clinicGarden(L, c, B, 18, 46, 250, 20, 36, theme, 87, 2)
  clinicGarden(L, c, B, 90, 46, 280, 20, 36, theme, 89, 2)
  clinicGarden(L, c, B, 8, 8, 40, 30, 30, theme, 91, 3)
  clinicTank(L, c, 96, 20, 190, theme)
  -- human-scale entrances: a main one on the front wing, a service door at the back
  clinicEntrance(L, c, plinth, 'L', 40, cs, theme, A, D)
  clinicService(L, c, plinth, 'R', 20, theme)
  clinicEmblem(L, c, core, 'L', 16, 380, 13, theme)
end

-- ------------------------------------------------------------------ COURT (courthouse) section
-- Court-specific helpers and tiers. Separate from the housing, commerce and clinic sections: no
-- shared function is edited, so home_4..8, shop_4..8 and clinic_4..8 output cannot change.
--
-- Identity (must survive greyscale): heavy grey ashlar masses, a colonnaded portico on a stepped
-- podium, a triangular pediment, a tall arched window rhythm, buttresses, formal paved courts and a
-- balanced-scales emblem on a stone plaque. No medical cross, no market stall, no laundry, no
-- mirrored glass, no cupola (that is the council's cue).
--
-- HEIGHT CONTRACT: helpers taking a floor-LOCAL height add box.z0 exactly once. Helpers taking a
-- WORLD height (courtArcade, courtWalk, courtCourt, courtSteps, courtDrum) say so and never add z0.

local COURT = {
  tropical = { storey = 12, pitch = 4, open = true, shade = true, recess = false, deep = 5 },
  temperate = { storey = 12, pitch = 5, open = true, shade = false, recess = false, deep = 3 },
  arid = { storey = 13, pitch = 0, open = false, shade = true, recess = true, deep = 4 },
  northern = { storey = 12, pitch = 7, open = false, shade = false, recess = false, deep = 3, ridge = true },
}

-- Balanced scales, 9 wide x 7 tall. `#` is ink; everything else is left as backing.
local SCALES = {
  '....#....',
  '..#####..',
  '....#....',
  '...#.#...',
  '..#...#..',
  '.###.###.',
  '.##...##.',
}

-- Justice emblem: balanced scales on a stone plaque.
-- The plaque is sheared with the wall, so the glyph's placement is DERIVED from the plaque's actual
-- interior per column (the same constraint the clinic emblem uses) rather than guessed: on the L
-- face the plaque steps down to the right, so the top of the rightmost column the glyph uses is the
-- binding constraint; on the R face it is the leftmost.  Every ink pixel therefore lands on the
-- plaque, never on the rim, the wall or a neighbouring window.
local function courtEmblem(L, c, box, side, u, v, size, theme)
  local z = box.z0 + v
  local i, j
  if side == 'L' then
    i, j = box.i0 + u, box.j0 + box.B
  else
    i, j = box.i0 + box.A, box.j0 + box.B - u
  end
  local p = L.P(c.building, i, j, z)
  local x0, y0 = math.floor(p[1] + 0.5), math.floor(p[2] + 0.5)
  local sy = (side == 'L') and 1 or -1
  local backing, rim = L.C.PLASTER[5], L.C.CONCRETE[2]
  local ink, ink2 = L.C.WHEAT[4], L.C.WHEAT[2]
  local n = math.max(15, size)
  if n % 2 == 0 then n = n + 1 end
  local function run(x, y, len, col)
    for k = 0, len - 1 do L.px(c.building, x + k, y + sy * math.floor(k / 2), col) end
  end
  -- sheared stone plaque with a dark ashlar rim
  for r = 0, n - 1 do
    run(x0, y0 - r, n, (r == 0 or r == n - 1) and rim or backing)
  end
  for r = 0, n - 1 do
    L.px(c.building, x0, y0 - r, rim)
    L.px(c.building, x0 + n - 1, y0 - r + sy * math.floor((n - 1) / 2), rim)
  end
  -- derive the glyph origin from the plaque's real sheared interior
  local gw, gh = 9, 7
  local kc = math.floor((n - gw) / 2)
  local top, bot = -math.huge, math.huge
  for k = kc, kc + gw - 1 do
    local f = sy * math.floor(k / 2)
    top = math.max(top, -(n - 2) + f)
    bot = math.min(bot, -1 + f - gh + 1)
  end
  local gx = x0 + kc
  local gy = top <= bot and (y0 + top + math.floor((bot - top) / 2)) or nil
  if not gy then return end
  for r = 0, gh - 1 do
    local row = SCALES[r + 1]
    for k = 0, gw - 1 do
      if row:sub(k + 1, k + 1) == '#' then
        L.px(c.building, gx + k, gy + r, (r == 0 or r == 1) and ink2 or ink)
      end
    end
  end
end

-- Judicial gallery along a hall face: a projecting stone walkway with a solid parapet and columns
-- (open biomes) or a glazed arcade flush with the wall (enclosed biomes).  A shade canopy is added
-- over the open walk in tropical/arid.  `z` is a WORLD height.
local function courtGallery(L, c, side, i0, j0, z, span, depth, cs, theme)
  local wall, trim = L.C.CONCRETE, L.C.PLASTER
  i0, j0, span = even(i0), even(j0), even(span)
  local d = even(math.max(2, depth))
  if side == 'L' then
    L.quad(c.building, { { i0, j0, z }, { i0 + span, j0, z }, { i0 + span, j0 + d, z }, { i0, j0 + d, z } }, L.C.CONCRETE[4])
    L.quad(c.building, { { i0, j0 + d, z }, { i0 + span, j0 + d, z }, { i0 + span, j0 + d, z + 3 }, { i0, j0 + d, z + 3 } }, trim[4])
    if cs.open then
      for k = 0, math.max(1, math.floor(span / 6)) do
        local uu = i0 + math.min(span - 2, k * 6)
        L.box(c.building, uu, j0 + d - 2, z + 3, 2, 2, 8, trim, { base = false })
      end
      if cs.shade then
        L.quad(c.building, { { i0 - 1, j0 - 1, z + 12 }, { i0 + span + 1, j0 - 1, z + 12 },
          { i0 + span + 1, j0 + d + 1, z + 11 }, { i0 - 1, j0 + d + 1, z + 11 } }, theme.roof[3])
      end
    else
      L.quad(c.building, { { i0, j0 + d, z + 3 }, { i0 + span, j0 + d, z + 3 },
        { i0 + span, j0 + d, z + 10 }, { i0, j0 + d, z + 10 } }, L.C.GLASS[2])
      for k = 0, math.max(1, math.floor(span / 5)) do
        local uu = i0 + math.min(span - 2, k * 5)
        L.quad(c.building, { { uu, j0 + d, z + 3 }, { uu + 1, j0 + d, z + 3 },
          { uu + 1, j0 + d, z + 10 }, { uu, j0 + d, z + 10 } }, wall[3])
      end
      L.quad(c.building, { { i0 - 1, j0 - 1, z + 11 }, { i0 + span + 1, j0 - 1, z + 11 },
        { i0 + span + 1, j0 + d + 1, z + 10 }, { i0 - 1, j0 + d + 1, z + 10 } }, theme.roof[3])
    end
  else
    L.quad(c.building, { { i0, j0, z }, { i0 + d, j0, z }, { i0 + d, j0 - span, z }, { i0, j0 - span, z } }, L.C.CONCRETE[4])
    L.quad(c.building, { { i0 + d, j0, z }, { i0 + d, j0 - span, z }, { i0 + d, j0 - span, z + 3 }, { i0 + d, j0, z + 3 } }, trim[4])
    if cs.open then
      for k = 0, math.max(1, math.floor(span / 6)) do
        local jj = j0 - math.min(span - 2, k * 6)
        L.box(c.building, i0 + d - 2, jj - 2, z + 3, 2, 2, 8, trim, { base = false })
      end
      if cs.shade then
        L.quad(c.building, { { i0 - 1, j0 + 1, z + 12 }, { i0 - 1, j0 - span - 1, z + 12 },
          { i0 + d + 1, j0 - span - 1, z + 11 }, { i0 + d + 1, j0 + 1, z + 11 } }, theme.roof[3])
      end
    else
      L.quad(c.building, { { i0 + d, j0, z + 3 }, { i0 + d, j0 - span, z + 3 },
        { i0 + d, j0 - span, z + 10 }, { i0 + d, j0, z + 10 } }, L.C.GLASS[2])
      for k = 0, math.max(1, math.floor(span / 5)) do
        local jj = j0 - math.min(span - 2, k * 5)
        L.quad(c.building, { { i0 + d, jj, z + 3 }, { i0 + d, jj - 1, z + 3 },
          { i0 + d, jj - 1, z + 10 }, { i0 + d, jj, z + 10 } }, wall[3])
      end
      L.quad(c.building, { { i0 - 1, j0 + 1, z + 11 }, { i0 - 1, j0 - span - 1, z + 11 },
        { i0 + d + 1, j0 - span - 1, z + 10 }, { i0 + d + 1, j0 + 1, z + 10 } }, theme.roof[3])
    end
  end
end

-- Stone hall: ashlar wall, plinth band, pilasters between tall arched windows, string courses.
-- opt: top = 'parapet' | 'none', dressL/dressR, v0, pilaster = every Nth bay.
local function courtHall(L, c, x, y, z, w, d, h, cs, theme, opt)
  opt = opt or {}
  x, y, w, d = even(x), even(y), even(w), even(d)
  local wall, trim = L.C.CONCRETE, L.C.PLASTER
  local boxOpt = { base = (z <= 0) }
  if opt.top == 'parapet' then
    boxOpt.parapet = { p = 2, d = 2, floor = theme.roof }
  elseif opt.top == 'none' then
    boxOpt.notop = true
  end
  local box = L.box(c.building, x, y, z, w, d, h, wall, boxOpt)
  local ctx = c.building
  local v0 = opt.v0 or 6
  -- projecting judicial galleries: an open arcade in tropical/temperate, a glazed strip in
  -- arid/northern, plus a shade canopy only where the biome calls for one
  if opt.gal then
    for _, v in ipairs(opt.gal) do
      if v + 14 < h then
        courtGallery(L, c, 'L', x + 1, y + d, z + v, w - 2, cs.deep - 1, cs, theme)
        courtGallery(L, c, 'R', x + w, y + d - 1, z + v, d - 2, cs.deep - 1, cs, theme)
      end
    end
  end
  for _, side in ipairs({ 'L', 'R' }) do
    local on = (side == 'L') and (opt.dressL ~= false) or (side == 'R' and opt.dressR ~= false)
    if on then
      local len = (side == 'L') and w or d
      local cols = math.max(1, math.floor((len - 4) / 8))
      local rows = math.max(1, math.floor((h - v0 - 3) / cs.storey))
      for r = 0, rows - 1 do
        local v = v0 + r * cs.storey
        for k = 0, cols - 1 do
          local u = 2 + k * 8
          if cs.recess then faceRect(L, ctx, box, side, u - 1, v, 6, 8, wall[2]) end
          faceRect(L, ctx, box, side, u, v, 4, 6, L.C.GLASS[2])
          faceRect(L, ctx, box, side, u, v + 5, 4, 1, L.C.GLASS[4])       -- arched head highlight
          faceRect(L, ctx, box, side, u - 1, v - 1, 6, 1, trim[4])        -- sill
          faceRect(L, ctx, box, side, u + 4, v, 2, 7, wall[2])            -- pilaster / pier
          faceRect(L, ctx, box, side, u + 4, v + 7, 2, 1, trim[3])        -- capital
        end
        if r % 2 == 1 then faceRect(L, ctx, box, side, 0, v + cs.storey - 2, len, 1, trim[3]) end
      end
      faceRect(L, ctx, box, side, 0, 0, len, 2, wall[2])                  -- plinth band
      faceRect(L, ctx, box, side, 0, 2, len, 1, trim[3])                  -- plinth cap
    end
  end
  return box
end

-- Classical pediment on the outer face of a portico: a stepped triangle in the plane j = j0.
-- `z` is a WORLD height (the top of the entablature).  `w` is the span, `h` the rise.
local function courtPediment(L, c, i0, j0, z, w, h, theme)
  -- L.quad takes ONE indexed palette colour, not a ramp.  `tympanum` is therefore a scalar
  -- (CONCRETE[3]); passing the whole L.C.CONCRETE table here drew an open wedge instead of a
  -- filled masonry triangle.  The generated probe (_court_probe.lua) asserts every quad/px colour
  -- is a number, so this class of mistake fails loudly.
  local tympanum, trim = L.C.CONCRETE[3], L.C.PLASTER
  for r = 0, h - 1 do
    local inset = even(math.floor(w * r / (2 * h)))
    L.quad(c.building, { { i0 + inset, j0, z + r }, { i0 + w - inset, j0, z + r },
      { i0 + w - inset, j0, z + r + 1 }, { i0 + inset, j0, z + r + 1 } },
      r == 0 and trim[3] or tympanum)
  end
  -- raking cornice: a light 1 px edge down each slope
  for r = 0, h - 1 do
    local inset = even(math.floor(w * r / (2 * h)))
    local pl = L.P(c.building, i0 + inset, j0, z + r)
    local pr = L.P(c.building, i0 + w - inset, j0, z + r)
    L.px(c.building, pl[1], pl[2], trim[5])
    L.px(c.building, pr[1], pr[2], trim[3])
  end
  -- base cornice under the tympanum
  L.quad(c.building, { { i0 - 1, j0, z }, { i0 + w + 1, j0, z }, { i0 + w + 1, j0, z - 2 }, { i0 - 1, j0, z - 2 } }, trim[4])
end

-- Colonnade: a row of stone columns carrying an entablature.  `z` is a WORLD height (the step the
-- columns stand on).  `span` runs along +i for side 'L', along -j for side 'R'.
local function courtColonnade(L, c, side, i0, j0, z, span, h, count, theme)
  local col, trim = L.C.PLASTER, L.C.CONCRETE
  i0, j0, span = even(i0), even(j0), even(span)
  local count_ = count
  local step = even(math.max(4, math.floor(span / count_)))
  for k = 0, count_ - 1 do
    local off = k * step
    if off + 2 <= span then
      if side == 'L' then
        L.box(c.building, i0 + off, j0, z, 2, 2, h, col, { base = (z <= 0) })
        L.box(c.building, i0 + off - 2, j0 - 2, z, 6, 6, 2, trim, { base = false })            -- base
        L.box(c.building, i0 + off - 2, j0 - 2, z + h - 2, 6, 6, 2, trim, { base = false })    -- capital
      else
        L.box(c.building, i0, j0 - off - 2, z, 2, 2, h, col, { base = (z <= 0) })
        L.box(c.building, i0 - 2, j0 - off - 4, z, 6, 6, 2, trim, { base = false })
        L.box(c.building, i0 - 2, j0 - off - 4, z + h - 2, 6, 6, 2, trim, { base = false })
      end
    end
  end
  -- entablature: a deep trim band spanning the whole colonnade, over the column heads
  if side == 'L' then
    L.box(c.building, i0 - 2, j0 - 2, z + h, span + 4, 6, 4, trim, { base = false })
  else
    L.box(c.building, i0 - 2, j0 - span - 2, z + h, 6, span + 4, 4, trim, { base = false })
  end
  return z + h + 4
end

-- Arcaded gallery along a court edge.  `z` is a WORLD height.
local function courtArcade(L, c, side, i0, j0, z, span, h, theme)
  local wall, trim = L.C.CONCRETE, L.C.PLASTER
  i0, j0, span = even(i0), even(j0), even(span)
  local bays = math.max(2, math.floor(span / 6))
  local step = even(math.max(2, math.floor(span / bays)))
  for k = 0, bays do
    local off = math.min(span - 2, k * step)
    if side == 'L' then
      L.box(c.building, i0 + off, j0, z, 2, 2, h, trim, { base = (z <= 0) })
    else
      L.box(c.building, i0, j0 - off - 2, z, 2, 2, h, trim, { base = (z <= 0) })
    end
  end
  if side == 'L' then
    L.box(c.building, i0 - 2, j0 - 2, z + h, span + 4, 6, 3, wall, { base = false })
  else
    L.box(c.building, i0 - 4, j0 - span - 4, z + h, 6, span + 4, 3, wall, { base = false })
  end
end

-- Formal paved court: a stone floor with a darker centre medallion and a kerb.  `z` is WORLD.
local function courtCourt(L, c, i0, j0, w, d, z, theme)
  i0, j0, w, d = even(i0), even(j0), even(w), even(d)
  w, d = math.max(8, w), math.max(8, d)
  L.flat(c.lot, i0, j0, w, d, L.C.CONCRETE[4], z)
  local cx, cy = even(i0 + w / 2), even(j0 + d / 2)
  L.flat(c.lot, cx - 4, cy - 4, 8, 8, L.C.CONCRETE[3], z)
  L.flat(c.lot, cx - 2, cy - 2, 4, 4, L.C.PLASTER[4], z)
  for k = 0, w - 4, 4 do
    L.dot(c.building, i0 + 2 + k, j0 + 1, z, L.C.CONCRETE[3])
    L.dot(c.building, i0 + 2 + k, j0 + d - 2, z, L.C.CONCRETE[3])
  end
end

-- Northern ridge post: a short stone mast and cap on a steep roof apex, the biome's silhouette cue
-- for "steeper roofs" (tropical instead widens its shade canopy, arid flattens to a parapet).
-- `z` is a WORLD height (the roof ridge).
local function courtRidge(L, c, x, y, z, cs, theme)
  if not cs.ridge then return end
  x, y = even(x), even(y)
  L.box(c.building, x - 2, y - 2, z, 6, 6, 2, L.C.CONCRETE, { base = false })
  L.box(c.building, x, y, z + 2, 2, 2, 7, L.C.PLASTER, { base = false })
  L.box(c.building, x - 2, y - 2, z + 9, 6, 6, 2, L.C.CONCRETE, { base = false })
  local _ = theme
end

-- Stone drum carrying a crown.  `z` is a WORLD height.
local function courtDrum(L, c, x, y, z, w, d, h, theme)
  local wall, trim = L.C.CONCRETE, L.C.PLASTER
  x, y, w, d = even(x), even(y), even(w), even(d)
  L.box(c.building, x, y, z, w, d, h, wall, { base = (z <= 0) })
  L.box(c.building, x - 2, y - 2, z, w + 4, d + 4, 3, trim, { base = false })
  L.box(c.building, x - 2, y - 2, z + h - 2, w + 4, d + 4, 2, trim, { base = false })
  L.flat(c.building, x, y, w, d, L.C.CONCRETE[4], z + h)
end

-- Portico + steps + pediment as one composed entrance.  `box` is the hall the portico serves;
-- `u` is the centre of the portico along that hall's face.  `v` is floor-LOCAL.
local function courtPortico(L, c, box, side, u, width, cs, theme, A, D)
  if side ~= 'L' then return end
  local room = D - (box.j0 + box.B)
  if room < 8 then return end
  local depth = even(math.max(6, math.min(cs.deep + 2, room - 2)))
  width = even(math.max(12, math.min(width, box.A - 4)))
  local rail = even(box.j0 + box.B)
  local i0 = even(box.i0 + u - width / 2)
  local jOut = rail + depth
  -- 1. CONTINUOUS LANDING.  One slab at the portico floor height spanning the whole portico
  --    footprint [rail, jOut], so every column base (6 deep, at jOut-6..jOut) is founded on solid
  --    masonry over its entire plan.  The previous version stacked three nested slabs that all
  --    started at the wall, so the highest one was only 2 deep and the column bases overhung it.
  L.box(c.building, i0 - 2, rail, 0, width + 4, depth, 6, L.C.CONCRETE, { base = true })
  -- 2. DESCENDING STEPS outside the landing, each 2 lower, kept inside the lot with a 2 unit margin
  local steps = math.max(1, math.min(2, math.floor((D - 2 - jOut) / 2)))
  for k = 0, steps - 1 do
    L.box(c.building, i0 - 2 + k * 2, jOut + k * 2, 0, width + 4 - k * 4, 2, 4 - k * 2,
      L.C.CONCRETE, { base = (k == steps - 1) })
  end
  -- 3. columns stand on the landing, the entablature spans them, the pediment caps the outer face
  local top = courtColonnade(L, c, 'L', i0, jOut - 4, 6, width, 38, 4, theme)
  courtPediment(L, c, i0 - 2, jOut, top, width + 4, 8, theme)
end

-- ------------------------------------------------------------------ court tiers 4..8
-- court_4: compact neighbourhood courthouse — portico, pediment, formal court behind the hall.
local function court4(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- judicial hall with the portico on the street face
  local hall = courtHall(L, c, 6, 22, 0, A - 12, 14, 74, cs, theme,
    { top = 'parapet', gal = { 30 } })
  -- rear range and two returns enclosing the formal court
  courtHall(L, c, 6, 4, 0, A - 12, 10, 30, cs, theme, { top = 'parapet' })
  courtHall(L, c, 6, 14, 0, 8, 8, 38, cs, theme, { top = 'parapet', dressR = false })
  courtHall(L, c, A - 14, 14, 0, 8, 8, 38, cs, theme, { top = 'parapet', dressL = false })
  -- formal court in the middle of the block
  courtCourt(L, c, 14, 14, 20, 8, 0, theme)
  courtArcade(L, c, 'L', 14, 22, 0, 20, 14, theme)
  -- portico, steps and pediment
  courtPortico(L, c, hall, 'L', 18, 24, cs, theme, A, D)
  cap(L, c, 6, 22, 74, A - 12, 14, cs, theme)
  courtRidge(L, c, 24, 29, 74 + cs.pitch, cs, theme)
  -- banded cornice under the roof
  faceRect(L, c.building, hall, 'L', 0, 70, A - 12, 2, L.C.PLASTER[3])
  -- emblem above the pediment apex, on the exposed upper facade
  courtEmblem(L, c, hall, 'L', 14, 58, 15, theme)
end

-- court_5: larger judicial hall with two unequal wings and an arcaded court.
local function court5(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local main = courtHall(L, c, 14, 28, 0, 20, 10, 130, cs, theme,
    { top = 'parapet', gal = { 40, 88 } })
  courtHall(L, c, 4, 18, 0, 10, 20, 80, cs, theme, { top = 'none', dressR = false })   -- west wing
  cap(L, c, 4, 18, 80, 10, 20, cs, theme)
  courtHall(L, c, 34, 18, 0, 10, 20, 100, cs, theme, { top = 'none', dressL = false }) -- east wing
  cap(L, c, 34, 18, 100, 10, 20, cs, theme)
  courtHall(L, c, 4, 4, 0, A - 8, 14, 40, cs, theme, { top = 'none' })                    -- rear hall
  cap(L, c, 4, 4, 40, A - 8, 14, cs, theme)
  -- arcaded court enclosed by the four ranges
  courtCourt(L, c, 14, 18, 20, 10, 0, theme)
  courtArcade(L, c, 'R', 34, 28, 0, 10, 16, theme)
  -- portico on the main hall, pediment, steps
  courtPortico(L, c, main, 'L', 10, 20, cs, theme, A, D)
  cap(L, c, 14, 28, 130, 20, 10, cs, theme)
  courtRidge(L, c, 24, 33, 130 + cs.pitch, cs, theme)
  cap(L, c, 4, 18, 80, 10, 20, cs, theme)
  cap(L, c, 34, 18, 100, 10, 20, cs, theme)
  faceRect(L, c.building, main, 'L', 0, 126, 20, 2, L.C.PLASTER[3])
  courtEmblem(L, c, main, 'L', 7, 96, 15, theme)
end

-- court_6: court podium with a vertical judicial tower and a supported crown.
local function court6(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- stone podium, arcaded on both street faces
  local pod = courtHall(L, c, 4, 4, 0, A - 8, D - 16, 44, cs, theme, { top = 'parapet' })
  courtArcade(L, c, 'L', 8, 52, 0, 48, 14, theme)
  courtArcade(L, c, 'R', 60, 44, 0, 36, 14, theme)
  -- vertical judicial tower and two lower annexes
  local tower = courtHall(L, c, 18, 18, 44, 28, 28, 184, cs, theme,
    { top = 'none', gal = { 60, 120 } })
  courtHall(L, c, 4, 20, 44, 12, 24, 96, cs, theme, { top = 'none', dressR = false })
  cap(L, c, 4, 20, 140, 12, 24, cs, theme)
  courtHall(L, c, 48, 20, 44, 12, 24, 120, cs, theme, { top = 'none', dressL = false })
  cap(L, c, 48, 20, 164, 12, 24, cs, theme)
  -- formal courts on the podium roof
  courtCourt(L, c, 6, 6, 24, 24, 44, theme)
  courtCourt(L, c, 34, 6, 24, 24, 44, theme)
  -- crown: flat deck -> stone drum -> judicial chamber -> pediment roof (full-footprint support)
  -- @deck tower: flat deck the crown drum stands on
  cap(L, c, 18, 18, 228, 28, 28, { storey = cs.storey, pitch = 0 }, theme)
  courtDrum(L, c, 22, 22, 228, 20, 20, 22, theme)
  -- @crown crownHall on drum
  courtHall(L, c, 24, 24, 250, 16, 16, 24, cs, theme, { top = 'none' })
  cap(L, c, 22, 22, 274, 20, 20, cs, theme)
  courtRidge(L, c, 32, 32, 274 + cs.pitch, cs, theme)
  -- portico, steps and pediment on the podium street face
  courtPortico(L, c, pod, 'L', 26, 24, cs, theme, A, D)
  courtEmblem(L, c, tower, 'L', 8, 158, 15, theme)
end

-- court_7: grouped judicial towers joined by supported connections, with formal terraces.
local function court7(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- rear judicial hall
  courtHall(L, c, 6, 6, 0, A - 12, 44, 120, cs, theme, { top = 'none' })
  cap(L, c, 6, 6, 120, A - 12, 44, cs, theme)
  -- three towers of unequal height along the street
  local ta = courtHall(L, c, 6, 58, 0, 24, 24, 280, cs, theme, { top = 'none', gal = { 160 } })
  cap(L, c, 6, 58, 280, 24, 24, cs, theme)
  local tb = courtHall(L, c, 36, 58, 0, 24, 24, 340, cs, theme,
    { top = 'none', gal = { 100, 200 } })
  courtHall(L, c, 66, 58, 0, 24, 24, 250, cs, theme, { top = 'none', gal = { 140 } })
  cap(L, c, 66, 58, 250, 24, 24, cs, theme)
  -- covered connections: each box reaches 4 units INTO both towers it joins
  -- @connector linkA towerA towerB
  L.box(c.building, 26, 66, 140, 14, 12, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 25, 64, 151 }, { 41, 64, 151 }, { 41, 80, 151 }, { 25, 80, 151 } }, theme.roof[3])
  -- @connector linkB towerB towerC
  L.box(c.building, 56, 66, 240, 14, 12, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 55, 64, 251 }, { 71, 64, 251 }, { 71, 80, 251 }, { 55, 80, 251 } }, theme.roof[3])
  -- @connector linkC towerA towerB
  L.box(c.building, 26, 66, 240, 14, 12, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 25, 64, 251 }, { 41, 64, 251 }, { 41, 80, 251 }, { 25, 80, 251 } }, theme.roof[3])
  -- formal terrace on the rear hall roof
  courtCourt(L, c, 10, 10, 76, 36, 120, theme)
  -- crown on the tallest tower
  -- @deck towerB: flat deck the crown drum stands on
  cap(L, c, 36, 58, 340, 24, 24, { storey = cs.storey, pitch = 0 }, theme)
  courtDrum(L, c, 40, 62, 340, 16, 16, 20, theme)
  -- @crown crownHall on drum
  courtHall(L, c, 42, 64, 360, 12, 12, 22, cs, theme, { top = 'none' })
  cap(L, c, 40, 62, 382, 16, 16, cs, theme)
  courtRidge(L, c, 48, 70, 382 + cs.pitch, cs, theme)
  --
  courtPortico(L, c, ta, 'L', 12, 20, cs, theme, A, D)
  courtEmblem(L, c, tb, 'L', 8, 290, 15, theme)
end

-- court_8: monumental vertical justice complex with a legible public entrance.
local function court8(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  -- broad public plinth, colonnaded
  local plinth = courtHall(L, c, 6, 6, 0, A - 12, D - 24, 40, cs, theme, { top = 'parapet' })
  courtArcade(L, c, 'L', 10, 110, 0, 108, 16, theme)
  courtArcade(L, c, 'R', 122, 102, 0, 92, 16, theme)
  -- central great hall
  local core = courtHall(L, c, 40, 40, 40, 48, 48, 500, cs, theme,
    { top = 'none', gal = { 120, 260, 400 } })
  -- four wings of different heights
  courtHall(L, c, 20, 84, 40, 88, 24, 170, cs, theme, { top = 'none', gal = { 90 } })   -- front
  cap(L, c, 20, 84, 210, 88, 24, cs, theme)
  courtHall(L, c, 20, 16, 40, 88, 24, 140, cs, theme, { top = 'none' })   -- back
  cap(L, c, 20, 16, 180, 88, 24, cs, theme)
  courtHall(L, c, 16, 44, 40, 24, 44, 200, cs, theme, { top = 'none' })   -- west
  cap(L, c, 16, 44, 240, 24, 44, cs, theme)
  courtHall(L, c, 88, 44, 40, 24, 44, 230, cs, theme, { top = 'none', gal = { 120 } })   -- east
  cap(L, c, 88, 44, 270, 24, 44, cs, theme)
  -- covered connections from the great hall to each wing, 4 units into both receivers
  -- @connector linkFrontA core wingFront
  L.box(c.building, 56, 80, 120, 16, 12, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 55, 78, 131 }, { 73, 78, 131 }, { 73, 94, 131 }, { 55, 94, 131 } }, theme.roof[3])
  -- @connector linkFrontB core wingFront
  L.box(c.building, 56, 80, 200, 16, 12, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 55, 78, 211 }, { 73, 78, 211 }, { 73, 94, 211 }, { 55, 94, 211 } }, theme.roof[3])
  -- @connector linkBack core wingBack
  L.box(c.building, 56, 36, 120, 16, 12, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 55, 34, 131 }, { 73, 34, 131 }, { 73, 50, 131 }, { 55, 50, 131 } }, theme.roof[3])
  -- @connector linkWest core wingWest
  L.box(c.building, 36, 56, 150, 12, 16, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 34, 55, 161 }, { 50, 55, 161 }, { 50, 73, 161 }, { 34, 73, 161 } }, theme.roof[3])
  -- @connector linkEast core wingEast
  L.box(c.building, 80, 56, 180, 12, 16, 10, L.C.CONCRETE, { base = true })
  L.quad(c.building, { { 78, 55, 191 }, { 94, 55, 191 }, { 94, 73, 191 }, { 78, 73, 191 } }, theme.roof[3])
  -- formal courts on the wing roofs and the plinth
  courtCourt(L, c, 24, 86, 80, 20, 210, theme)
  courtCourt(L, c, 24, 18, 80, 20, 180, theme)
  courtCourt(L, c, 8, 8, 28, 28, 40, theme)
  -- crown: deck -> drum -> chamber -> pediment roof
  -- @deck core: flat deck the crown drum stands on
  cap(L, c, 40, 40, 540, 48, 48, { storey = cs.storey, pitch = 0 }, theme)
  courtDrum(L, c, 44, 44, 540, 40, 40, 26, theme)
  -- @crown crownHall on drum
  courtHall(L, c, 48, 48, 566, 32, 32, 34, cs, theme, { top = 'none' })
  cap(L, c, 46, 46, 600, 36, 36, cs, theme)
  courtRidge(L, c, 64, 64, 600 + cs.pitch, cs, theme)
  -- grand public entrance: colonnade, steps and pediment on the plinth street face
  courtPortico(L, c, plinth, 'L', 64, 40, cs, theme, A, D)
  courtEmblem(L, c, core, 'L', 20, 380, 15, theme)
end

-- ------------------------------------------------------------------ COUNCIL (town hall) section
-- Council-specific helpers and tiers. Separate from the housing, commerce, clinic and court
-- sections: no shared function is edited, so home_4..8, shop_4..8, clinic_4..8 and court_4..8
-- output cannot change.
--
-- Identity (must survive greyscale): WARM masonry (PLASTER, biome-mutable) with timber banding,
-- a round clock face on a tower, an open belfry with a hanging bell, civic banners on brackets,
-- a ceremonial entrance with steps and a canopy, layered meeting terraces and a public courtyard.
-- Deliberately NOT the courthouse: no grey ashlar, no colonnade-and-pediment portico, no scales.
--
-- HEIGHT CONTRACT: helpers taking a floor-LOCAL height add box.z0 exactly once. Helpers taking a
-- WORLD height (councilGallery, councilTerrace, councilCourt, councilDrum, councilBelfry,
-- councilCupola) say so and never add z0 again.

local COUNCIL = {
  tropical = { storey = 12, pitch = 4, open = true, shade = true, recess = false, deep = 4 },
  temperate = { storey = 12, pitch = 5, open = true, shade = false, recess = false, deep = 3 },
  arid = { storey = 13, pitch = 0, open = false, shade = true, recess = true, deep = 4 },
  northern = { storey = 12, pitch = 7, open = false, shade = false, recess = false, deep = 3,
               ridge = true },
}

-- Round clock face painted on a wall.  Drawn in SCREEN space so the dial stays circular at 1x, but
-- anchored on the wall's projected point.  `v` is a floor-LOCAL height; box.z0 is added once.
-- The dial is a disc with a dark rim, a pale face and two hands; the checker proves every dial
-- pixel lies inside the host wall's projected face.
local function councilClock(L, c, box, side, u, v, r, theme)
  local z = box.z0 + v
  local i, j
  if side == 'L' then
    i, j = box.i0 + u, box.j0 + box.B
  else
    i, j = box.i0 + box.A, box.j0 + box.B - u
  end
  local p = L.P(c.building, i, j, z)
  local cx, cy = math.floor(p[1] + 0.5), math.floor(p[2] + 0.5)
  local face, rim, hand = L.C.PLASTER[5], L.C.CONCRETE[2], L.C.WOOD[1]
  local rr = math.max(3, r)
  for y = -rr, rr do
    for x = -rr, rr do
      local d2 = x * x + y * y
      if d2 <= rr * rr then
        local col = face
        if d2 > (rr - 1) * (rr - 1) then col = rim end
        L.px(c.building, cx + x, cy + y, col)
      end
    end
  end
  -- hands: 12 o'clock and 3 o'clock, one pixel thick, inset from the rim
  for k = 1, rr - 1 do L.px(c.building, cx, cy - k, hand) end
  for k = 1, rr - 1 do L.px(c.building, cx + k, cy, hand) end
  L.px(c.building, cx, cy, hand)
end

-- Open belfry: four corner posts on a real deck, a head beam, a hanging bell and a cap roof.
-- `z` is a WORLD height (the deck the posts stand on).
local function councilBelfry(L, c, x, y, z, w, d, h, cs, theme)
  local wall, wood = L.C.PLASTER, L.C.WOOD
  x, y, w, d = even(x), even(y), even(w), even(d)
  local px, pz = 2, 2
  for _, o in ipairs({ { x, y }, { x + w - px, y }, { x, y + d - pz }, { x + w - px, y + d - pz } }) do
    L.box(c.building, o[1], o[2], z, px, pz, h, wall, { base = (z <= 0) })
  end
  -- head beam across the posts, then the bell hanging from it
  L.box(c.building, x, y, z + h - 2, w, d, 2, wood, { base = false })
  local bx, by = even(x + w / 2 - 2), even(y + d / 2 - 2)
  L.box(c.building, bx, by, z + h - 6, 4, 4, 4, L.C.STEEL, { base = false })    -- hanger
  L.box(c.building, bx, by, z + h - 10, 4, 4, 4, L.C.WHEAT, { base = false })   -- bell body
  L.box(c.building, bx - 2, by - 2, z + h - 12, 8, 8, 2, L.C.WHEAT, { base = false }) -- bell mouth
  -- cap roof over the belfry
  cap(L, c, x - 2, y - 2, z + h, w + 4, d + 4, cs, theme)
  -- biome silhouette cues: a wide shade eave in the hot biomes, a ridge post in the north
  if cs.shade then
    L.quad(c.building, { { x - 4, y - 4, z + h + 1 }, { x + w + 4, y - 4, z + h + 1 },
      { x + w + 4, y + d + 4, z + h }, { x - 4, y + d + 4, z + h } }, theme.roof[2])
  end
  if cs.ridge then
    local rx, ry = even(x + w / 2 - 2), even(y + d / 2 - 2)
    L.box(c.building, rx, ry, z + h + cs.pitch, 4, 4, 8, L.C.PLASTER, { base = false })
    L.box(c.building, rx - 2, ry - 2, z + h + cs.pitch + 8, 8, 8, 2, L.C.WOOD, { base = false })
  end
end

-- Civic banner on a bracket: a short timber arm out of the wall and a cloth panel hanging from it.
-- `v` is a floor-LOCAL height.
local function councilBanner(L, c, box, side, u, v, w, h, theme)
  local wood, cloth = L.C.WOOD, theme.roof
  local z = box.z0 + v
  if side == 'L' then
    local J, i = box.j0 + box.B, box.i0 + u
    L.quad(c.building, { { i, J, z + 2 }, { i + 4, J, z + 2 }, { i + 4, J, z + 3 }, { i, J, z + 3 } }, wood[3])
    L.quad(c.building, { { i + 3, J, z }, { i + 4, J, z }, { i + 4, J, z + 3 }, { i + 3, J, z + 3 } }, wood[4])
    L.quad(c.building, { { i + 1, J, z - h }, { i + 4, J, z - h }, { i + 4, J, z }, { i + 1, J, z } }, cloth[4])
    L.quad(c.building, { { i + 1, J + 1, z - h }, { i + 4, J + 1, z - h }, { i + 4, J + 1, z }, { i + 1, J + 1, z } }, cloth[3])
    L.quad(c.building, { { i + 1, J, z - h }, { i + 4, J, z - h }, { i + 4, J, z - h + 1 }, { i + 1, J, z - h + 1 } }, cloth[5])
  else
    local I, ja = box.i0 + box.A, box.j0 + box.B - u
    L.quad(c.building, { { I, ja, z + 2 }, { I, ja - 4, z + 2 }, { I, ja - 4, z + 3 }, { I, ja, z + 3 } }, wood[3])
    L.quad(c.building, { { I, ja - 3, z }, { I, ja - 4, z }, { I, ja - 4, z + 3 }, { I, ja - 3, z + 3 } }, wood[4])
    L.quad(c.building, { { I, ja - 1, z - h }, { I, ja - 4, z - h }, { I, ja - 4, z }, { I, ja - 1, z } }, cloth[4])
    L.quad(c.building, { { I + 1, ja - 1, z - h }, { I + 1, ja - 4, z - h }, { I + 1, ja - 4, z }, { I + 1, ja - 1, z } }, cloth[3])
    L.quad(c.building, { { I, ja - 1, z - h }, { I, ja - 4, z - h }, { I, ja - 4, z - h + 1 }, { I, ja - 1, z - h + 1 } }, cloth[5])
  end
end

-- forward declaration: councilHall hangs galleries, and councilGallery is defined below it
local councilGallery

-- Warm civic hall: plaster masonry, timber banding, tall windows with timber lintels, string
-- courses.  opt: top = 'parapet' | 'none', dressL/dressR, v0, gal = { local floor heights }.
local function councilHall(L, c, x, y, z, w, d, h, cs, theme, opt)
  opt = opt or {}
  x, y, w, d = even(x), even(y), even(w), even(d)
  local wall, wood = L.C.PLASTER, L.C.WOOD
  local boxOpt = { base = (z <= 0) }
  if opt.top == 'parapet' then
    boxOpt.parapet = { p = 2, d = 2, floor = theme.roof }
  elseif opt.top == 'none' then
    boxOpt.notop = true
  end
  local box = L.box(c.building, x, y, z, w, d, h, wall, boxOpt)
  local ctx = c.building
  local v0 = opt.v0 or 6
  if opt.gal then
    for _, v in ipairs(opt.gal) do
      if v + 14 < h then
        councilGallery(L, c, 'L', x + 1, y + d, z + v, w - 2, cs.deep - 1, cs, theme)
        councilGallery(L, c, 'R', x + w, y + d - 1, z + v, d - 2, cs.deep - 1, cs, theme)
      end
    end
  end
  for _, side in ipairs({ 'L', 'R' }) do
    local on = (side == 'L') and (opt.dressL ~= false) or (side == 'R' and opt.dressR ~= false)
    if on then
      local len = (side == 'L') and w or d
      local cols = math.max(1, math.floor((len - 4) / 8))
      local rows = math.max(1, math.floor((h - v0 - 3) / cs.storey))
      for r = 0, rows - 1 do
        local v = v0 + r * cs.storey
        for k = 0, cols - 1 do
          local u = 2 + k * 8
          if cs.recess then faceRect(L, ctx, box, side, u - 1, v, 6, 8, wall[2]) end
          faceRect(L, ctx, box, side, u, v, 4, 6, L.C.GLASS[2])
          faceRect(L, ctx, box, side, u, v + 5, 4, 1, L.C.GLASS[4])
          faceRect(L, ctx, box, side, u - 1, v - 1, 6, 1, wood[4])        -- timber sill
          faceRect(L, ctx, box, side, u - 1, v + 6, 6, 1, wood[3])        -- timber lintel
        end
        if r % 2 == 1 then faceRect(L, ctx, box, side, 0, v + cs.storey - 2, len, 1, wood[3]) end
      end
      faceRect(L, ctx, box, side, 0, 0, len, 2, wall[2])
      faceRect(L, ctx, box, side, 0, 2, len, 1, wood[4])
    end
  end
  return box
end

-- Sheltered public gallery: a projecting walkway with a solid parapet, open colonnade in
-- tropical/temperate and a glazed strip in arid/northern.  `z` is a WORLD height.
councilGallery = function(L, c, side, i0, j0, z, span, depth, cs, theme)
  local wall, wood = L.C.PLASTER, L.C.WOOD
  i0, j0, span = even(i0), even(j0), even(span)
  local d = even(math.max(2, depth))
  if side == 'L' then
    L.quad(c.building, { { i0, j0, z }, { i0 + span, j0, z }, { i0 + span, j0 + d, z }, { i0, j0 + d, z } }, L.C.CONCRETE[4])
    L.quad(c.building, { { i0, j0 + d, z }, { i0 + span, j0 + d, z }, { i0 + span, j0 + d, z + 3 }, { i0, j0 + d, z + 3 } }, wall[4])
    if cs.open then
      for k = 0, math.max(1, math.floor(span / 6)) do
        local uu = i0 + math.min(span - 2, k * 6)
        L.box(c.building, uu, j0 + d - 2, z + 3, 2, 2, 8, wood, { base = false })
      end
      if cs.shade then
        L.quad(c.building, { { i0 - 1, j0 - 1, z + 12 }, { i0 + span + 1, j0 - 1, z + 12 },
          { i0 + span + 1, j0 + d + 1, z + 11 }, { i0 - 1, j0 + d + 1, z + 11 } }, theme.roof[3])
      end
    else
      L.quad(c.building, { { i0, j0 + d, z + 3 }, { i0 + span, j0 + d, z + 3 },
        { i0 + span, j0 + d, z + 10 }, { i0, j0 + d, z + 10 } }, L.C.GLASS[2])
      for k = 0, math.max(1, math.floor(span / 5)) do
        local uu = i0 + math.min(span - 2, k * 5)
        L.quad(c.building, { { uu, j0 + d, z + 3 }, { uu + 1, j0 + d, z + 3 },
          { uu + 1, j0 + d, z + 10 }, { uu, j0 + d, z + 10 } }, wood[3])
      end
      L.quad(c.building, { { i0 - 1, j0 - 1, z + 11 }, { i0 + span + 1, j0 - 1, z + 11 },
        { i0 + span + 1, j0 + d + 1, z + 10 }, { i0 - 1, j0 + d + 1, z + 10 } }, theme.roof[3])
    end
  else
    L.quad(c.building, { { i0, j0, z }, { i0 + d, j0, z }, { i0 + d, j0 - span, z }, { i0, j0 - span, z } }, L.C.CONCRETE[4])
    L.quad(c.building, { { i0 + d, j0, z }, { i0 + d, j0 - span, z }, { i0 + d, j0 - span, z + 3 }, { i0 + d, j0, z + 3 } }, wall[4])
    if cs.open then
      for k = 0, math.max(1, math.floor(span / 6)) do
        local jj = j0 - math.min(span - 2, k * 6)
        L.box(c.building, i0 + d - 2, jj - 2, z + 3, 2, 2, 8, wood, { base = false })
      end
      if cs.shade then
        L.quad(c.building, { { i0 - 1, j0 + 1, z + 12 }, { i0 - 1, j0 - span - 1, z + 12 },
          { i0 + d + 1, j0 - span - 1, z + 11 }, { i0 + d + 1, j0 + 1, z + 11 } }, theme.roof[3])
      end
    else
      L.quad(c.building, { { i0 + d, j0, z + 3 }, { i0 + d, j0 - span, z + 3 },
        { i0 + d, j0 - span, z + 10 }, { i0 + d, j0, z + 10 } }, L.C.GLASS[2])
      for k = 0, math.max(1, math.floor(span / 5)) do
        local jj = j0 - math.min(span - 2, k * 5)
        L.quad(c.building, { { i0 + d, jj, z + 3 }, { i0 + d, jj - 1, z + 3 },
          { i0 + d, jj - 1, z + 10 }, { i0 + d, jj, z + 10 } }, wood[3])
      end
      L.quad(c.building, { { i0 - 1, j0 + 1, z + 11 }, { i0 - 1, j0 - span - 1, z + 11 },
        { i0 + d + 1, j0 - span - 1, z + 10 }, { i0 + d + 1, j0 + 1, z + 10 } }, theme.roof[3])
    end
  end
end

-- Public courtyard: paved, with a fountain medallion and a kerb.  `z` is a WORLD height.
local function councilCourt(L, c, i0, j0, w, d, z, theme)
  i0, j0, w, d = even(i0), even(j0), even(w), even(d)
  w, d = math.max(8, w), math.max(8, d)
  L.flat(c.lot, i0, j0, w, d, L.C.CONCRETE[4], z)
  local cx, cy = even(i0 + w / 2), even(j0 + d / 2)
  L.flat(c.lot, cx - 6, cy - 6, 12, 12, L.C.CONCRETE[3], z)
  L.flat(c.lot, cx - 4, cy - 4, 8, 8, L.C.WATER[3], z)
  L.flat(c.lot, cx - 2, cy - 2, 4, 4, L.C.WATER[5], z)
  for k = 0, w - 4, 4 do
    L.dot(c.building, i0 + 2 + k, j0 + 1, z, L.C.CONCRETE[3])
    L.dot(c.building, i0 + 2 + k, j0 + d - 2, z, L.C.CONCRETE[3])
  end
end

-- Planted meeting terrace with a bench.  `z` is a WORLD height.
local function councilTerrace(L, c, B, x, y, z, w, d, theme, seed, n)
  x, y, w, d = even(x), even(y), even(w), even(d)
  w, d = math.max(8, w), math.max(8, d)
  L.flat(c.building, x + 2, y + 2, w - 4, d - 4, theme.ground[3], z)
  for k = 1, n do
    local i = x + 3 + ((k * 7 + seed) % math.max(2, w - 7))
    local j = y + 3 + ((k * 5 + seed * 3) % math.max(2, d - 7))
    B.plant(L, c.building, i, j, z, 3, theme, seed + k)
  end
  for k = 0, w - 4, 4 do
    L.dot(c.building, x + 2 + k, y + d - 2, z, theme.leaf[3])
  end
  if w >= 12 and d >= 8 then
    L.box(c.building, x + 4, y + 2, z, 6, 2, 2, L.C.WOOD, { base = (z <= 0) })
  end
end

-- Ceremonial entrance: wide double door, steps and a canopy projecting outward over its posts.
-- `v` is a floor-LOCAL height.
local function councilEntrance(L, c, box, side, u, cs, theme, A, D)
  local wall, wood = L.C.PLASTER, L.C.WOOD
  local room = (side == 'L') and (D - (box.j0 + box.B)) or (A - (box.i0 + box.A))
  local depth = even(math.max(2, math.min(cs.deep, room - 2)))
  faceRect(L, c.building, box, side, u - 1, 0, 12, 14, wall[2])
  faceRect(L, c.building, box, side, u, 0, 10, 12, L.C.GLASS[2])
  faceRect(L, c.building, box, side, u + 4, 0, 2, 12, wood[3])
  faceRect(L, c.building, box, side, u, 11, 10, 1, L.C.GLASS[4])
  faceRect(L, c.building, box, side, u - 1, 12, 12, 2, wood[4])
  local zw = box.z0 + 14
  if side == 'L' then
    local J, i = box.j0 + box.B, box.i0 + u
    L.quad(c.building, { { i - 2, J, zw }, { i + 12, J, zw }, { i + 12, J + depth, zw - 2 }, { i - 2, J + depth, zw - 2 } }, theme.roof[4])
    L.quad(c.building, { { i - 2, J + depth, zw - 3 }, { i + 12, J + depth, zw - 3 }, { i + 12, J + depth, zw - 2 }, { i - 2, J + depth, zw - 2 } }, theme.roof[2])
    L.box(c.building, i, J + depth - 2, box.z0, 2, 2, 14, wood, { base = true })
    L.box(c.building, i + 10, J + depth - 2, box.z0, 2, 2, 14, wood, { base = true })
    L.flat(c.lot, i - 2, J, 14, depth, L.C.CONCRETE[4], 0)
  else
    local I, ja = box.i0 + box.A, box.j0 + box.B - u
    L.quad(c.building, { { I, ja + 2, zw }, { I, ja - 12, zw }, { I + depth, ja - 12, zw - 2 }, { I + depth, ja + 2, zw - 2 } }, theme.roof[4])
    L.quad(c.building, { { I + depth, ja + 2, zw - 3 }, { I + depth, ja - 12, zw - 3 }, { I + depth, ja - 12, zw - 2 }, { I + depth, ja + 2, zw - 2 } }, theme.roof[2])
    L.box(c.building, I + depth - 2, ja - 2, box.z0, 2, 2, 14, wood, { base = true })
    L.box(c.building, I + depth - 2, ja - 12, box.z0, 2, 2, 14, wood, { base = true })
    L.flat(c.lot, I, ja - 12, depth, 14, L.C.CONCRETE[4], 0)
  end
end

-- Warm stone drum carrying a crown.  `z` is a WORLD height.
local function councilDrum(L, c, x, y, z, w, d, h, theme)
  local wall, wood = L.C.PLASTER, L.C.WOOD
  x, y, w, d = even(x), even(y), even(w), even(d)
  L.box(c.building, x, y, z, w, d, h, wall, { base = (z <= 0) })
  L.box(c.building, x - 2, y - 2, z, w + 4, d + 4, 3, wood, { base = false })
  L.box(c.building, x - 2, y - 2, z + h - 2, w + 4, d + 4, 2, wood, { base = false })
  L.flat(c.building, x, y, w, d, L.C.CONCRETE[4], z + h)
end

-- Civic cupola: a stepped warm-stone cap over a crown deck.  `z` is a WORLD height.
local function councilCupola(L, c, x, y, z, w, d, theme)
  local wall = L.C.PLASTER
  x, y, w, d = even(x), even(y), even(w), even(d)
  L.box(c.building, x, y, z, w, d, 4, wall, { base = false })
  L.box(c.building, x + 2, y + 2, z + 4, w - 4, d - 4, 4, wall, { base = false })
  L.box(c.building, x + 4, y + 4, z + 8, w - 8, d - 8, 4, wall, { base = false })
  L.cyl(c.building, x + w / 2, y + d / 2, z + 12, math.max(2, (w - 8) / 2), 6, L.C.WHEAT,
    { matte = true, dome = true })
end

-- ------------------------------------------------------------------ council tiers 4..8
-- council_4: neighbourhood assembly hall with a public court and a modest bell/clock tower.
local function council4(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local hall = councilHall(L, c, 6, 22, 0, A - 12, 18, 56, cs, theme, { top = 'parapet' })
  councilHall(L, c, 6, 4, 0, A - 12, 10, 28, cs, theme, { top = 'parapet' })
  councilHall(L, c, 6, 14, 0, 8, 8, 34, cs, theme, { top = 'parapet', dressR = false })
  councilHall(L, c, A - 14, 14, 0, 8, 8, 34, cs, theme, { top = 'parapet', dressL = false })
  councilCourt(L, c, 14, 14, 20, 8, 0, theme)
  -- clock tower rising from the hall, with a belfry on top
  local tower = councilHall(L, c, 8, 26, 0, 12, 12, 78, cs, theme, { top = 'none' })
  cap(L, c, 8, 26, 78, 12, 12, { storey = cs.storey, pitch = 0 }, theme)
  councilBelfry(L, c, 10, 28, 80, 8, 8, 14, cs, theme)
  councilEntrance(L, c, hall, 'L', 26, cs, theme, A, D)
  councilBanner(L, c, hall, 'L', 34, 30, 6, 10, theme)
  councilClock(L, c, tower, 'L', 6, 62, 5, theme)
end

-- council_5: stepped municipal complex with meeting wings and civic terraces.
local function council5(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local main = councilHall(L, c, 14, 26, 0, 20, 14, 110, cs, theme, { top = 'parapet', gal = { 40, 80 } })
  councilHall(L, c, 4, 18, 0, 10, 22, 70, cs, theme, { top = 'none', dressR = false })
  cap(L, c, 4, 18, 70, 10, 22, cs, theme)
  councilHall(L, c, 34, 18, 0, 10, 22, 88, cs, theme, { top = 'none', dressL = false })
  cap(L, c, 34, 18, 88, 10, 22, cs, theme)
  councilHall(L, c, 4, 4, 0, A - 8, 14, 40, cs, theme, { top = 'none' })
  cap(L, c, 4, 4, 40, A - 8, 14, cs, theme)
  councilCourt(L, c, 14, 18, 20, 8, 0, theme)
  -- clock tower on the main hall
  local tower = councilHall(L, c, 18, 28, 0, 12, 10, 140, cs, theme, { top = 'none' })
  cap(L, c, 18, 28, 140, 12, 10, { storey = cs.storey, pitch = 0 }, theme)
  councilBelfry(L, c, 20, 30, 142, 8, 6, 14, cs, theme)
  councilEntrance(L, c, main, 'L', 4, cs, theme, A, D)
  councilBanner(L, c, main, 'L', 12, 60, 6, 12, theme)
  councilClock(L, c, tower, 'L', 6, 118, 5, theme)
  councilTerrace(L, c, B, 4, 20, 70, 10, 18, theme, 41, 2)
end

-- council_6: substantial civic podium with a vertical assembly/administration tower.
local function council6(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local pod = councilHall(L, c, 4, 4, 0, A - 8, D - 16, 40, cs, theme, { top = 'parapet' })
  local tower = councilHall(L, c, 20, 20, 40, 24, 24, 190, cs, theme, { top = 'none', gal = { 60, 120 } })
  councilHall(L, c, 4, 20, 40, 14, 24, 90, cs, theme, { top = 'none', dressR = false })
  cap(L, c, 4, 20, 130, 14, 24, cs, theme)
  councilHall(L, c, 46, 20, 40, 14, 24, 110, cs, theme, { top = 'none', dressL = false })
  cap(L, c, 46, 20, 150, 14, 24, cs, theme)
  councilCourt(L, c, 6, 6, 24, 24, 40, theme)
  councilCourt(L, c, 34, 6, 24, 24, 40, theme)
  -- crown: deck -> drum -> clock stage -> belfry
  -- @deck tower: flat deck the crown drum stands on
  cap(L, c, 20, 20, 230, 24, 24, { storey = cs.storey, pitch = 0 }, theme)
  councilDrum(L, c, 24, 24, 230, 16, 16, 20, theme)
  -- @crown clockStage on drum
  local stage = councilHall(L, c, 26, 26, 250, 12, 12, 20, cs, theme, { top = 'none' })
  cap(L, c, 26, 26, 270, 12, 12, { storey = cs.storey, pitch = 0 }, theme)
  councilBelfry(L, c, 28, 28, 272, 8, 8, 12, cs, theme)
  councilEntrance(L, c, pod, 'L', 26, cs, theme, A, D)
  councilBanner(L, c, pod, 'L', 40, 26, 6, 12, theme)
  councilClock(L, c, stage, 'L', 6, 8, 5, theme)
  councilTerrace(L, c, B, 6, 34, 40, 20, 20, theme, 51, 3)
end

-- council_7: grouped civic towers with supported galleries and several setbacks.
local function council7(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  councilHall(L, c, 6, 6, 0, A - 12, 44, 110, cs, theme, { top = 'none' })
  cap(L, c, 6, 6, 110, A - 12, 44, cs, theme)
  local ta = councilHall(L, c, 6, 58, 0, 24, 24, 260, cs, theme, { top = 'none', gal = { 120 } })
  cap(L, c, 6, 58, 260, 24, 24, cs, theme)
  local tb = councilHall(L, c, 36, 58, 0, 24, 24, 320, cs, theme, { top = 'none', gal = { 100, 200 } })
  councilHall(L, c, 66, 58, 0, 24, 24, 240, cs, theme, { top = 'none', gal = { 110 } })
  cap(L, c, 66, 58, 240, 24, 24, cs, theme)
  -- covered connections: each box reaches 4 units INTO both towers it joins
  -- @connector linkA towerA towerB
  L.box(c.building, 26, 66, 120, 14, 12, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 25, 64, 131 }, { 41, 64, 131 }, { 41, 80, 131 }, { 25, 80, 131 } }, theme.roof[3])
  -- @connector linkB towerB towerC
  L.box(c.building, 56, 66, 200, 14, 12, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 55, 64, 211 }, { 71, 64, 211 }, { 71, 80, 211 }, { 55, 80, 211 } }, theme.roof[3])
  -- @connector linkC towerA towerB
  L.box(c.building, 26, 66, 200, 14, 12, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 25, 64, 211 }, { 41, 64, 211 }, { 41, 80, 211 }, { 25, 80, 211 } }, theme.roof[3])
  councilCourt(L, c, 10, 10, 76, 36, 110, theme)
  -- crown on the tallest tower
  -- @deck towerB: flat deck the crown drum stands on
  cap(L, c, 36, 58, 320, 24, 24, { storey = cs.storey, pitch = 0 }, theme)
  councilDrum(L, c, 40, 62, 320, 16, 16, 18, theme)
  -- @crown clockStage on drum
  local stage = councilHall(L, c, 42, 64, 338, 12, 12, 18, cs, theme, { top = 'none' })
  cap(L, c, 42, 64, 356, 12, 12, { storey = cs.storey, pitch = 0 }, theme)
  councilBelfry(L, c, 44, 66, 358, 8, 8, 12, cs, theme)
  councilEntrance(L, c, ta, 'L', 12, cs, theme, A, D)
  councilBanner(L, c, ta, 'L', 20, 90, 6, 12, theme)
  councilClock(L, c, stage, 'L', 6, 8, 5, theme)
  councilTerrace(L, c, B, 10, 10, 110, 30, 30, theme, 61, 3)
end

-- council_8: monumental vertical town hall with a human-scale public entrance, multiple
-- structural tiers and a distinctive civic crown.
local function council8(L, B, c, theme, s, cs)
  local A, D = s.A, s.B
  site(L, c, A, D, theme)
  local plinth = councilHall(L, c, 6, 6, 0, A - 12, D - 24, 40, cs, theme, { top = 'parapet' })
  local core = councilHall(L, c, 40, 40, 40, 48, 48, 480, cs, theme, { top = 'none', gal = { 120, 260, 400 } })
  councilHall(L, c, 20, 84, 40, 88, 24, 160, cs, theme, { top = 'none', gal = { 90 } })
  cap(L, c, 20, 84, 200, 88, 24, cs, theme)
  councilHall(L, c, 20, 16, 40, 88, 24, 130, cs, theme, { top = 'none' })
  cap(L, c, 20, 16, 170, 88, 24, cs, theme)
  councilHall(L, c, 16, 44, 40, 24, 44, 190, cs, theme, { top = 'none' })
  cap(L, c, 16, 44, 230, 24, 44, cs, theme)
  councilHall(L, c, 88, 44, 40, 24, 44, 220, cs, theme, { top = 'none', gal = { 120 } })
  cap(L, c, 88, 44, 260, 24, 44, cs, theme)
  -- covered connections from the core to each wing, 4 units into both receivers
  -- @connector linkFrontA core wingFront
  L.box(c.building, 56, 80, 120, 16, 12, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 55, 78, 131 }, { 73, 78, 131 }, { 73, 94, 131 }, { 55, 94, 131 } }, theme.roof[3])
  -- @connector linkFrontB core wingFront
  L.box(c.building, 56, 80, 200, 16, 12, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 55, 78, 211 }, { 73, 78, 211 }, { 73, 94, 211 }, { 55, 94, 211 } }, theme.roof[3])
  -- @connector linkBack core wingBack
  L.box(c.building, 56, 36, 120, 16, 12, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 55, 34, 131 }, { 73, 34, 131 }, { 73, 50, 131 }, { 55, 50, 131 } }, theme.roof[3])
  -- @connector linkWest core wingWest
  L.box(c.building, 36, 56, 150, 12, 16, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 34, 55, 161 }, { 50, 55, 161 }, { 50, 73, 161 }, { 34, 73, 161 } }, theme.roof[3])
  -- @connector linkEast core wingEast
  L.box(c.building, 80, 56, 180, 12, 16, 10, L.C.PLASTER, { base = true })
  L.quad(c.building, { { 78, 55, 191 }, { 94, 55, 191 }, { 94, 73, 191 }, { 78, 73, 191 } }, theme.roof[3])
  councilCourt(L, c, 24, 86, 80, 20, 200, theme)
  councilCourt(L, c, 24, 18, 80, 20, 170, theme)
  councilCourt(L, c, 8, 8, 28, 28, 40, theme)
  -- crown: deck -> drum -> clock stage -> belfry -> cupola
  -- @deck core: flat deck the crown drum stands on
  cap(L, c, 40, 40, 520, 48, 48, { storey = cs.storey, pitch = 0 }, theme)
  councilDrum(L, c, 44, 44, 520, 40, 40, 24, theme)
  -- @crown clockStage on drum
  local stage = councilHall(L, c, 48, 48, 544, 32, 32, 30, cs, theme, { top = 'none' })
  cap(L, c, 48, 48, 574, 32, 32, { storey = cs.storey, pitch = 0 }, theme)
  councilBelfry(L, c, 52, 52, 576, 24, 24, 16, cs, theme)
  councilCupola(L, c, 56, 56, 592, 16, 16, theme)
  councilEntrance(L, c, plinth, 'L', 64, cs, theme, A, D)
  councilBanner(L, c, plinth, 'L', 84, 26, 6, 12, theme)
  councilClock(L, c, stage, 'L', 16, 8, 5, theme)
  councilTerrace(L, c, B, 8, 8, 40, 28, 28, theme, 71, 3)
end

-- ------------------------------------------------------------------ dispatch
function F.draw(L, B, c, theme, s)
  local biome = STYLE[theme.biome] or STYLE.temperate
  if s.kind == 'home' then
    if s.tier == 4 then home4(L, B, c, theme, s, biome)
    elseif s.tier == 5 then home5(L, B, c, theme, s, biome)
    elseif s.tier == 6 then home6(L, B, c, theme, s, biome)
    elseif s.tier == 7 then home7(L, B, c, theme, s, biome)
    elseif s.tier == 8 then home8(L, B, c, theme, s, biome)
    else otherTower(L, B, c, theme, s) end
    return
  end
  if s.kind == 'shop' then
    local ss = SHOP[theme.biome] or SHOP.temperate
    if s.tier == 4 then shop4(L, B, c, theme, s, ss)
    elseif s.tier == 5 then shop5(L, B, c, theme, s, ss)
    elseif s.tier == 6 then shop6(L, B, c, theme, s, ss)
    elseif s.tier == 7 then shop7(L, B, c, theme, s, ss)
    elseif s.tier == 8 then shop8(L, B, c, theme, s, ss)
    else otherTower(L, B, c, theme, s) end
    return
  end
  if s.kind == 'clinic' then
    local cs = CLINIC[theme.biome] or CLINIC.temperate
    if s.tier == 4 then clinic4(L, B, c, theme, s, cs)
    elseif s.tier == 5 then clinic5(L, B, c, theme, s, cs)
    elseif s.tier == 6 then clinic6(L, B, c, theme, s, cs)
    elseif s.tier == 7 then clinic7(L, B, c, theme, s, cs)
    elseif s.tier == 8 then clinic8(L, B, c, theme, s, cs)
    else otherTower(L, B, c, theme, s) end
    return
  end
  if s.kind == 'court' then
    local cs = COURT[theme.biome] or COURT.temperate
    if s.tier == 4 then court4(L, B, c, theme, s, cs)
    elseif s.tier == 5 then court5(L, B, c, theme, s, cs)
    elseif s.tier == 6 then court6(L, B, c, theme, s, cs)
    elseif s.tier == 7 then court7(L, B, c, theme, s, cs)
    elseif s.tier == 8 then court8(L, B, c, theme, s, cs)
    else otherTower(L, B, c, theme, s) end
    return
  end
  if s.kind == 'council' then
    local cs = COUNCIL[theme.biome] or COUNCIL.temperate
    if s.tier == 4 then council4(L, B, c, theme, s, cs)
    elseif s.tier == 5 then council5(L, B, c, theme, s, cs)
    elseif s.tier == 6 then council6(L, B, c, theme, s, cs)
    elseif s.tier == 7 then council7(L, B, c, theme, s, cs)
    elseif s.tier == 8 then council8(L, B, c, theme, s, cs)
    else otherTower(L, B, c, theme, s) end
    return
  end
  otherTower(L, B, c, theme, s)
end

return F
