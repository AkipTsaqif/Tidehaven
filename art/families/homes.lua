-- Homes family: home (cottage / family house / courtyard house). Owned by brief 4.
-- Shape per biome (theme.biome):
--   tropical: stilt bungalows, wraparound veranda + railings, steep thatch hip roofs, no chimney, palm
--   temperate: pitched roofs, narrow porch, hedges, deciduous tree
--   arid: flat roofs with parapet, canvas terrace shade, adobe courtyard walls, cactus
--   northern: steep roofs, big chimney, woodpile, pine
-- U.house and U.flatHall are deliberately not used.
local F = {kinds = {"home"}}

---------------------------------------------------------------- shared pieces
-- Clapboard lines on the street face only; the shaded face stays plain.
local function clap(L, c, box, ramp)
  L.stripe(c.building, box.left, "dr", 6, ramp[2])
end

-- Window with optional shutters and a sill. u = offset along the face (>= 2), v = height above base.
local function win(L, c, box, side, u, v, w, h, theme, opt)
  opt = opt or {}
  local glass = opt.dark and L.C.GLASS[2] or L.C.GLASS[3]
  local g = L.wallRect(c.building, box, side, u, v, w, h, glass)
  L.edge(c.building, g, "top", L.C.GLASS[5])
  if opt.shut ~= false then
    L.wallRect(c.building, box, side, u - 2, v, 2, h, theme.roof[3])
    L.wallRect(c.building, box, side, u + w, v, 2, h, theme.roof[3])
  end
  if v >= 1 then L.wallRect(c.building, box, side, u, v - 1, w, 1, theme.wall[5]) end
end

-- 4x7 door with a lighter lintel. u even, >= 0.
local function door(L, c, box, side, u)
  L.wallRect(c.building, box, side, u, 0, 4, 7, L.C.WOOD[2])
  L.wallRect(c.building, box, side, u, 6, 4, 1, L.C.WOOD[4])
end

-- Chimney box; draw BEFORE the roof so the roof overlaps its base.
local function chimney(L, c, i0, j0, A, B, z0, H, ramp)
  L.box(c.building, i0, j0, z0, A, B, H, ramp, {base = true})
end

-- Dark stilts under the corners of a raised house (tropical).
local function stilts(L, c, i0, j0, A, B, zb)
  if zb <= 0 then return end
  for _, p in ipairs({{i0, j0}, {i0 + A - 2, j0}, {i0, j0 + B - 2}, {i0 + A - 2, j0 + B - 2}}) do
    L.box(c.building, p[1], p[2], 0, 2, 2, zb, L.C.WOOD)
  end
end

-- Porch on the front face at j = jf: a deck, posts two units in front of the wall, and a mono-pitch roof.
-- roofZ is the low front edge height; the roof rises 2 units toward the wall.
local function porch(L, c, theme, i0, jf, A, zb, roofZ, posts)
  L.flat(c.building, i0, jf, A, 4, L.C.WOOD[4], zb)
  for _, i in ipairs(posts) do L.box(c.building, i, jf + 2, zb, 2, 2, roofZ - zb, L.C.WOOD) end
  L.shed(c.building, i0, jf, roofZ, A, 4, 2, theme.roof, L.C.WOOD, {o = 0, rows = 2})
end

-- Flat-roof terrace: two posts on the parapet floor carrying a white canvas shade.
local function terrace(L, c, box)
  local t = box.z0 + box.H
  local i0, j0, A = box.i0, box.j0, box.A
  L.box(c.building, i0 + 4, j0 + 4, t - 2, 2, 2, 8, L.C.WOOD)
  L.box(c.building, i0 + A - 6, j0 + 4, t - 2, 2, 2, 8, L.C.WOOD)
  L.quad(c.building, {{i0 + 2, j0 + 2, t + 6}, {i0 + A - 2, j0 + 2, t + 6},
                      {i0 + A - 2, j0 + 8, t + 6}, {i0 + 2, j0 + 8, t + 6}}, L.C.WHITE[4])
end

-- Stacked firewood: 2 courses of 3 short stacks; log ends are dots on the right face.
local function woodpile(L, c, i0, j0)
  for m = 0, 2 do
    for k = 0, 1 do
      L.box(c.details, i0, j0 + m * 2, k * 3, 2, 2, 3, L.C.WOOD, {base = true})
      L.dot(c.details, i0 + 2, j0 + m * 2 + 1, k * 3 + 1, L.C.WOOD[5])
    end
  end
end

-- Low fence at constant i, running along j.
local function fenceJ(L, c, i, j0, j1)
  for j = j0, j1 - 2, 8 do L.box(c.details, i, j, 0, 2, 2, 6, L.C.WOOD) end
  L.quad(c.details, {{i, j0, 3}, {i, j1, 3}, {i, j1, 4}, {i, j0, 4}}, L.C.WOOD[3])
  L.quad(c.details, {{i, j0, 1}, {i, j1, 1}, {i, j1, 2}, {i, j0, 2}}, L.C.WOOD[3])
end

-- Low fence at constant j, running along i.
local function fenceI(L, c, j, i0, i1)
  for i = i0, i1 - 2, 8 do L.box(c.details, i, j, 0, 2, 2, 6, L.C.WOOD) end
  L.quad(c.details, {{i0, j, 3}, {i1, j, 3}, {i1, j, 4}, {i0, j, 4}}, L.C.WOOD[3])
  L.quad(c.details, {{i0, j, 1}, {i1, j, 1}, {i1, j, 2}, {i0, j, 2}}, L.C.WOOD[3])
end

-- Laundry line at constant i between posts at j0 and j1, with cloth squares.
local function laundry(L, c, i, j0, j1)
  L.box(c.details, i, j0, 0, 2, 2, 8, L.C.WOOD)
  L.box(c.details, i, j1, 0, 2, 2, 8, L.C.WOOD)
  L.quad(c.details, {{i, j0, 7}, {i, j1, 7}, {i, j1, 8}, {i, j0, 8}}, L.OUTLINE)
  L.quad(c.details, {{i, j0 + 2, 6}, {i, j0 + 4, 6}, {i, j0 + 4, 2}, {i, j0 + 2, 2}}, L.C.WHITE[4])
  L.quad(c.details, {{i, j0 + 6, 6}, {i, j0 + 8, 6}, {i, j0 + 8, 3}, {i, j0 + 6, 3}}, L.FLOWERS[1])
end

-- Flower bed: soil with three flower colours on the lot.
local function bed(L, c, i0, j0, A, B, seed)
  local m = L.flat(c.lot, i0, j0, A, B, L.C.DIRT[4])
  L.speckle(c.lot, m, 0.25, L.FLOWERS[1], seed)
  L.speckle(c.lot, m, 0.20, L.FLOWERS[2], seed + 1)
  L.speckle(c.lot, m, 0.15, L.FLOWERS[4], seed + 2)
end

local function path(L, c, i0, j0, A, B)
  L.flat(c.lot, i0, j0, A, B, L.C.DIRT[4])
end

-- Courtyard well: round stone shaft with a small shed roof on two posts.
local function well(L, c, theme)
  L.cyl(c.details, 24, 28, 0, 3, 5, L.C.CONCRETE, {cap = L.C.CONCRETE[4]})
  L.box(c.details, 22, 26, 0, 2, 2, 8, L.C.WOOD)
  L.box(c.details, 26, 26, 0, 2, 2, 8, L.C.WOOD)
  L.shed(c.details, 20, 24, 8, 12, 8, 3, theme.roof, L.C.WOOD, {o = 0, rows = 2})
end

---------------------------------------------------------------- tropical stilt bungalow
-- Raised timber deck on stilts, veranda on the front (vf) and optionally right (vr) side with
-- railings, roof posts, and a steep thatch hip roof spanning house + veranda. No chimney: tropical
-- households cook outdoors. b = {i, j, A, B, zb, H, vf, vr, R, door, winsL, winsR, rows}
local function bungalow(L, c, theme, b)
  local i0, j0, A, Bd, zb, H = b.i, b.j, b.A, b.B, b.zb, b.H
  local vf, vr = b.vf or 4, b.vr or 0
  local DA, DB = A + vr, Bd + vf
  local fj, ri = j0 + DB, i0 + DA
  local wood, wall = L.C.WOOD, theme.wall
  L.shadow(c.shadow, i0, j0, DA, DB, 2)
  -- Stilts along the visible front and right edges, then the deck on top of them.
  local function stilt(i, j) L.box(c.building, i, j, 0, 2, 2, zb - 1, wood) end
  stilt(ri - 2, j0); stilt(i0, fj - 2); stilt(ri - 2, fj - 2)
  if DA >= 24 then stilt(i0 + (DA / 2 - (DA / 2) % 2), fj - 2) end
  if DB >= 24 then stilt(ri - 2, j0 + (DB / 2 - (DB / 2) % 2)) end
  local deck = L.box(c.building, i0, j0, zb - 1, DA, DB, 1, wood, {corner = false})
  L.stripe(c.building, deck.top, "ur", 4, wood[3])
  -- House walls.
  local box = L.box(c.building, i0, j0, zb, A, Bd, H, wall, {notop = true, base = true})
  clap(L, c, box, wall)
  door(L, c, box, "L", b.door)
  for _, v in ipairs(b.rows or {3}) do
    for _, u in ipairs(b.winsL or {}) do win(L, c, box, "L", u, v, 2, 3, theme) end
    for _, u in ipairs(b.winsR or {}) do win(L, c, box, "R", u, v, 2, 3, theme) end
  end
  -- Railings: a thin light top rail with short balusters (dots), not solid posts, so the walls
  -- behind stay readable. Gap in the front rail at the steps.
  local function railI(a0, a1)
    if a1 <= a0 then return end
    L.quad(c.building, {{a0, fj, zb + 3}, {a1, fj, zb + 3}, {a1, fj, zb + 4}, {a0, fj, zb + 4}}, wood[4])
    for i = a0 + 2, a1 - 2, 4 do L.dot(c.building, i, fj, zb + 1, wood[2]); L.dot(c.building, i, fj, zb + 2, wood[2]) end
  end
  local g0, g1 = i0 + b.door, i0 + b.door + 4
  railI(i0, g0)
  railI(g1, ri)
  if vr > 0 then
    L.quad(c.building, {{ri, j0 + 2, zb + 3}, {ri, fj, zb + 3}, {ri, fj, zb + 4}, {ri, j0 + 2, zb + 4}}, wood[4])
    for j = j0 + 4, fj - 2, 4 do L.dot(c.building, ri, j, zb + 1, wood[2]); L.dot(c.building, ri, j, zb + 2, wood[2]) end
    L.box(c.building, ri - 2, j0, zb, 2, 2, H, wood)
  end
  -- Roof posts at the open veranda corners only.
  L.box(c.building, i0, fj - 2, zb, 2, 2, H, wood)
  L.box(c.building, ri - 2, fj - 2, zb, 2, 2, H, wood)
  -- Steep thatch hip roof over house and veranda.
  L.hip(c.building, i0, j0, zb + H, DA, DB, b.R or 8, L.C.THATCH, {o = 0, rows = 2}) -- veranda already overhangs
  -- Steps down from the veranda gap.
  L.box(c.details, g0, fj, 0, 4, 2, zb - 2, wood, {base = true})
  L.box(c.details, g0, fj + 2, 0, 4, 2, math.max(1, zb - 4), wood, {base = true})
  return box
end

local function sandPath(L, c, theme, i0, j0, A, B)
  local m = L.flat(c.lot, i0, j0, A, B, theme.sand[4])
  L.speckle(c.lot, m, 0.15, theme.sand[3], i0 * 7 + j0)
end

-- Clay water jar.
local function jar(L, c, i, j)
  L.cyl(c.details, i, j, 0, 2, 3, L.C.BRICK, {hole = L.OUTLINE, matte = true})
end

local function tropical1(L, B, c, theme, spec)
  local seed = spec.seed
  bungalow(L, c, theme, {i = 10, j = 8, A = 16, B = 12, zb = 6, H = 14, vf = 4, vr = 4, R = 8,
    door = 4, winsL = {12}, winsR = {4}})
  sandPath(L, c, theme, 14, 28, 4, 18)
  jar(L, c, 22, 30)
  bed(L, c, 32, 28, 8, 6, seed + 30)
  fenceI(L, c, 44, 26, 42)
  B.plant(L, c.details, 40, 38, 0, 4, theme, seed + 10)
  L.bush(c.details, 6, 42, 3, theme.leaf, seed + 11)
end

local function tropical2(L, B, c, theme, spec)
  local seed = spec.seed
  -- Back main house, two storeys on stilts.
  bungalow(L, c, theme, {i = 6, j = 6, A = 24, B = 12, zb = 6, H = 20, vf = 4, vr = 0, R = 8,
    door = 18, winsL = {4, 12}, winsR = {4}, rows = {3, 13}})
  -- Front-left wing joining its veranda, forming the L.
  bungalow(L, c, theme, {i = 6, j = 22, A = 12, B = 12, zb = 6, H = 12, vf = 4, vr = 4, R = 7,
    door = 2, winsL = {8}, winsR = {4}})
  -- Open-sided outdoor kitchen shelter with a thatch roof.
  for _, p in ipairs({{34, 6}, {40, 6}, {34, 12}, {40, 12}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 8, L.C.WOOD) end
  L.box(c.building, 36, 8, 0, 4, 4, 3, L.C.BRICK, {base = true})
  L.hip(c.building, 34, 6, 8, 8, 8, 5, L.C.THATCH, {o = 2, rows = 2})
  sandPath(L, c, theme, 8, 42, 4, 4)
  sandPath(L, c, theme, 24, 26, 4, 20)
  laundry(L, c, 34, 30, 40)
  jar(L, c, 30, 24)
  bed(L, c, 36, 18, 8, 6, seed + 30)
  B.plant(L, c.details, 42, 40, 0, 4, theme, seed + 10)
  L.bush(c.details, 18, 44, 3, theme.leaf, seed + 11)
end

local function tropical3(L, B, c, theme, spec)
  local seed = spec.seed
  -- U of three stilt houses around a sandy courtyard: long back house, left and right wings.
  bungalow(L, c, theme, {i = 4, j = 4, A = 40, B = 12, zb = 6, H = 18, vf = 4, vr = 0, R = 8,
    door = 18, winsL = {4, 10, 26, 32}, winsR = {4}, rows = {3, 12}})
  local yard = L.flat(c.lot, 20, 22, 12, 18, theme.sand[4])
  L.speckle(c.lot, yard, 0.12, theme.sand[3], seed + 3)
  bungalow(L, c, theme, {i = 32, j = 22, A = 12, B = 12, zb = 6, H = 12, vf = 4, vr = 0, R = 7,
    door = 4, winsR = {4}})
  bungalow(L, c, theme, {i = 4, j = 22, A = 12, B = 12, zb = 6, H = 12, vf = 4, vr = 4, R = 7,
    door = 4, winsR = {4}})
  -- Courtyard: well, palm, flower bed; low front wall with a gate and a path to the street.
  well(L, c, {roof = L.C.THATCH})
  bed(L, c, 26, 34, 4, 4, seed + 40)
  B.plant(L, c.details, 22, 36, 0, 4, theme, seed + 10)
  L.box(c.details, 20, 40, 0, 4, 2, 4, theme.wall, {base = true})
  L.box(c.details, 28, 40, 0, 4, 2, 4, theme.wall, {base = true})
  sandPath(L, c, theme, 24, 40, 4, 6)
  sandPath(L, c, theme, 8, 42, 4, 4)
  sandPath(L, c, theme, 36, 42, 4, 4)
  jar(L, c, 18, 44)
end

---------------------------------------------------------------- tier 1: cottage
local function tier1(L, B, c, theme, spec)
  local bio, seed = theme.biome, spec.seed
  if bio == "tropical" then return tropical1(L, B, c, theme, spec) end
  local wall, roof = theme.wall, theme.roof
  local i0, j0, A, Bd, H = 8, 6, 20, 16, 12

  if bio == "arid" then
    -- Flat roof with parapet, thick adobe walls, small deep windows, canvas terrace shade.
    local box = L.box(c.building, i0, j0, 0, A, Bd, H, wall, {parapet = {p = 2, d = 2, floor = wall}, base = true})
    clap(L, c, box, wall)
    door(L, c, box, "L", 8)
    win(L, c, box, "L", 2, 4, 2, 3, theme, {dark = true, shut = false})
    win(L, c, box, "L", 14, 4, 2, 3, theme, {dark = true, shut = false})
    win(L, c, box, "R", 4, 4, 2, 3, theme, {dark = true, shut = false})
    win(L, c, box, "R", 10, 4, 2, 3, theme, {dark = true, shut = false})
    terrace(L, c, box)
    -- Courtyard wall with a gap for the path.
    L.box(c.details, 6, 40, 0, 8, 2, 4, wall, {base = true})
    L.box(c.details, 18, 40, 0, 12, 2, 4, wall, {base = true})
    path(L, c, 14, 22, 4, 18)
    B.plant(L, c.details, 40, 36, 0, 4, theme, seed + 10)
    return
  end

  -- Pitched-roof cottage. Tropical raises it on stilts with a wide veranda.
  local zb = (bio == "tropical") and 3 or 0
  local R = (bio == "northern") and 12 or 7
  local o = (bio == "tropical") and 4 or 2
  stilts(L, c, i0, j0, A, Bd, zb)
  local box = L.box(c.building, i0, j0, zb, A, Bd, H, wall, {notop = true, base = true})
  clap(L, c, box, wall)
  door(L, c, box, "L", 8)
  win(L, c, box, "L", 2, 4, 2, 3, theme)
  win(L, c, box, "L", 14, 4, 2, 3, theme)
  win(L, c, box, "R", 4, 4, 2, 3, theme)
  win(L, c, box, "R", 10, 4, 2, 3, theme)

  -- Chimney, back half of the roof, before the roof is drawn.
  local cw = (bio == "northern") and 6 or 4
  chimney(L, c, i0 + A - cw - 2, j0 + 2, cw, 4, zb + H - 2, R + 8, L.C.BRICK)
  L.gable(c.building, i0, j0, zb + H, A, Bd, R, "i", roof, wall, {o = o, rows = 3})

  if bio == "tropical" then
    porch(L, c, theme, 8, j0 + Bd, 20, zb, zb + 8, {8, 26})
  else
    porch(L, c, theme, 14, j0 + Bd, 8, zb, zb + 8, {14, 20})
  end

  -- Yard: path from the porch to the lot front, fence, flower bed, plant and bush.
  path(L, c, 16, j0 + Bd + 4, 4, 14)
  fenceI(L, c, 44, 26, 42)
  if bio == "temperate" then
    L.bush(c.details, 30, 42, 3, theme.leaf, seed + 12)
    L.bush(c.details, 38, 42, 3, theme.leaf, seed + 13)
  end
  bed(L, c, 30, 22, 8, 6, seed + 30)
  if bio == "northern" then woodpile(L, c, 30, 10) end
  B.plant(L, c.details, 38, 36, 0, 4, theme, seed + 10)
  L.bush(c.details, 6, 42, 3, theme.leaf, seed + 11)
end

---------------------------------------------------------------- tier 2: L-shaped family house
local function tier2Arid(L, B, c, theme, spec)
  local wall = theme.wall
  -- Two flat-roofed blocks in an L: main block along i, wing toward the street.
  local main = L.box(c.building, 6, 6, 0, 24, 12, 20, wall, {parapet = {p = 2, d = 2, floor = wall}, base = true})
  clap(L, c, main, wall)
  for _, u in ipairs({14, 20}) do win(L, c, main, "L", u, 12, 2, 3, theme, {dark = true, shut = false}) end
  for _, u in ipairs({2, 8}) do
    win(L, c, main, "R", u, 4, 2, 3, theme, {dark = true, shut = false})
    win(L, c, main, "R", u, 12, 2, 3, theme, {dark = true, shut = false})
  end
  terrace(L, c, main)
  local wing = L.box(c.building, 6, 18, 0, 12, 12, 20, wall, {parapet = {p = 2, d = 2, floor = wall}, base = true})
  clap(L, c, wing, wall)
  door(L, c, wing, "L", 4)
  win(L, c, wing, "L", 8, 12, 2, 3, theme, {dark = true, shut = false})
  win(L, c, wing, "R", 2, 4, 2, 3, theme, {dark = true, shut = false})
  win(L, c, wing, "R", 8, 4, 2, 3, theme, {dark = true, shut = false})
  -- Courtyard wall at the front, path from the door.
  L.box(c.details, 16, 44, 0, 12, 2, 4, wall, {base = true})
  L.box(c.details, 32, 44, 0, 10, 2, 4, wall, {base = true})
  path(L, c, 10, 30, 4, 14)
  B.plant(L, c.details, 38, 24, 0, 4, theme, spec.seed + 10)
end

local function tier2(L, B, c, theme, spec)
  local bio, seed = theme.biome, spec.seed
  if bio == "arid" then return tier2Arid(L, B, c, theme, spec) end
  if bio == "tropical" then return tropical2(L, B, c, theme, spec) end
  local wall, roof = theme.wall, theme.roof
  local zb = (bio == "tropical") and 3 or 0
  local R = (bio == "northern") and 12 or 8
  local o = (bio == "tropical") and 4 or 2
  local H = 20

  stilts(L, c, 6, 6, 24, 12, zb)
  stilts(L, c, 6, 18, 12, 12, zb)

  -- Main block (back), two storeys, ridge along i.
  local main = L.box(c.building, 6, 6, zb, 24, 12, H, wall, {notop = true, base = true})
  clap(L, c, main, wall)
  for _, u in ipairs({14, 20}) do
    win(L, c, main, "L", u, 3, 2, 3, theme)
    win(L, c, main, "L", u, 13, 2, 3, theme)
  end
  for _, u in ipairs({2, 8}) do
    win(L, c, main, "R", u, 3, 2, 3, theme)
    win(L, c, main, "R", u, 13, 2, 3, theme)
  end
  -- Balcony off the upper floor, clear of the wing.
  L.flat(c.building, 20, 18, 6, 4, L.C.WOOD[4], zb + 10)
  L.box(c.building, 20, 20, zb + 10, 6, 2, 3, L.C.WOOD, {base = true})
  chimney(L, c, 22, 8, 4, 4, zb + H - 2, R + 8, L.C.BRICK)
  L.gable(c.building, 6, 6, zb + H, 24, 12, R, "i", roof, wall, {o = o, rows = 3})

  -- Front wing (drawn after the main block), with its gable on the street face.
  local wing = L.box(c.building, 6, 18, zb, 12, 12, H, wall, {notop = true, base = true})
  clap(L, c, wing, wall)
  for _, u in ipairs({2, 8}) do
    win(L, c, wing, "R", u, 3, 2, 3, theme)
    win(L, c, wing, "R", u, 13, 2, 3, theme)
    win(L, c, wing, "L", u, 13, 2, 3, theme)
  end
  door(L, c, wing, "L", 4)
  if bio == "tropical" then
    porch(L, c, theme, 6, 30, 12, zb, zb + 8, {6, 16})
  else
    porch(L, c, theme, 8, 30, 8, zb, zb + 8, {8, 14})
  end
  L.gable(c.building, 6, 18, zb + H, 12, 12, R, "j", roof, wall, {o = o, rows = 3})

  -- Yard: path to the lot front, laundry line, garden shed, fence, flower bed, plant.
  path(L, c, 10, 34, 4, 10)
  laundry(L, c, 34, 30, 40)
  L.box(c.building, 34, 6, 0, 8, 8, 6, L.C.WOOD, {notop = true, base = true})
  L.shed(c.building, 34, 6, 6, 8, 8, 3, roof, L.C.WOOD, {o = 2, rows = 2})
  fenceJ(L, c, 44, 8, 42)
  bed(L, c, 20, 36, 10, 6, seed + 30)
  if bio == "temperate" then
    L.bush(c.details, 6, 42, 3, theme.leaf, seed + 14)
  end
  if bio == "northern" then woodpile(L, c, 22, 24) end
  B.plant(L, c.details, 38, 24, 0, 4, theme, seed + 10)
  L.bush(c.details, 6, 42, 3, theme.leaf, seed + 11)
end

---------------------------------------------------------------- tier 3: courtyard compound
local function tier3Arid(L, B, c, theme, spec)
  local wall, roof, seed = theme.wall, theme.roof, spec.seed
  -- Back block two storeys, two single-storey flat blocks forming a U around an open courtyard.
  local back = L.box(c.building, 4, 4, 0, 40, 12, 20, wall, {parapet = {p = 2, d = 2, floor = wall}, base = true})
  clap(L, c, back, wall)
  door(L, c, back, "L", 18)
  for _, u in ipairs({14, 24}) do
    win(L, c, back, "L", u, 3, 2, 3, theme, {dark = true, shut = false})
    win(L, c, back, "L", u, 13, 2, 3, theme, {dark = true, shut = false})
  end
  for _, u in ipairs({2, 8}) do
    win(L, c, back, "R", u, 4, 2, 3, theme, {dark = true, shut = false})
    win(L, c, back, "R", u, 12, 2, 3, theme, {dark = true, shut = false})
  end
  terrace(L, c, back)
  local lw = L.box(c.building, 4, 16, 0, 12, 22, 10, wall, {parapet = {p = 2, d = 2, floor = wall}, base = true})
  clap(L, c, lw, wall)
  door(L, c, lw, "L", 4)
  win(L, c, lw, "R", 10, 4, 2, 3, theme, {dark = true, shut = false})
  win(L, c, lw, "R", 16, 4, 2, 3, theme, {dark = true, shut = false})
  local rw = L.box(c.building, 32, 16, 0, 12, 22, 10, wall, {parapet = {p = 2, d = 2, floor = wall}, base = true})
  clap(L, c, rw, wall)
  door(L, c, rw, "L", 4)
  win(L, c, rw, "R", 10, 4, 2, 3, theme, {dark = true, shut = false})
  win(L, c, rw, "R", 16, 4, 2, 3, theme, {dark = true, shut = false})
  -- Courtyard: front wall with a gate gap, well, cactus, path to the street.
  L.box(c.details, 16, 38, 0, 6, 2, 4, wall, {base = true})
  L.box(c.details, 26, 38, 0, 6, 2, 4, wall, {base = true})
  well(L, c, theme)
  B.plant(L, c.details, 20, 34, 0, 4, theme, seed + 10)
  path(L, c, 22, 40, 4, 6)
end

local function tier3(L, B, c, theme, spec)
  local bio, seed = theme.biome, spec.seed
  if bio == "arid" then return tier3Arid(L, B, c, theme, spec) end
  if bio == "tropical" then return tropical3(L, B, c, theme, spec) end
  local wall, roof = theme.wall, theme.roof
  local zb = (bio == "tropical") and 3 or 0
  local R = (bio == "northern") and 12 or 8
  local R2 = (bio == "northern") and 9 or 6
  local o = (bio == "tropical") and 4 or 2

  stilts(L, c, 4, 4, 40, 12, zb)
  stilts(L, c, 4, 16, 12, 22, zb)
  stilts(L, c, 32, 16, 12, 22, zb)

  -- Back block: two storeys, ridge along i, two chimneys on its back half.
  local back = L.box(c.building, 4, 4, zb, 40, 12, 20, wall, {notop = true, base = true})
  clap(L, c, back, wall)
  door(L, c, back, "L", 18)
  for _, u in ipairs({14, 24}) do
    win(L, c, back, "L", u, 3, 2, 3, theme)
    win(L, c, back, "L", u, 13, 2, 3, theme)
  end
  for _, u in ipairs({2, 8}) do
    win(L, c, back, "R", u, 3, 2, 3, theme)
    win(L, c, back, "R", u, 13, 2, 3, theme)
  end
  chimney(L, c, 12, 6, 4, 4, zb + 18, R + 8, L.C.BRICK)
  chimney(L, c, 36, 6, 4, 4, zb + 18, R + 8, L.C.BRICK)
  L.gable(c.building, 4, 4, zb + 20, 40, 12, R, "i", roof, wall, {o = o, rows = 3})

  -- Left and right single-storey wings, gables on the street face.
  local lw = L.box(c.building, 4, 16, zb, 12, 22, 10, wall, {notop = true, base = true})
  clap(L, c, lw, wall)
  door(L, c, lw, "L", 4)
  win(L, c, lw, "R", 10, 3, 2, 3, theme)
  win(L, c, lw, "R", 16, 3, 2, 3, theme)
  chimney(L, c, 6, 20, 4, 4, zb + 8, R2 + 6, L.C.BRICK)
  L.gable(c.building, 4, 16, zb + 10, 12, 22, R2, "j", roof, wall, {o = o, rows = 3})

  local rw = L.box(c.building, 32, 16, zb, 12, 22, 10, wall, {notop = true, base = true})
  clap(L, c, rw, wall)
  door(L, c, rw, "L", 4)
  win(L, c, rw, "R", 10, 3, 2, 3, theme)
  win(L, c, rw, "R", 16, 3, 2, 3, theme)
  L.gable(c.building, 32, 16, zb + 10, 12, 22, R2, "j", roof, wall, {o = o, rows = 3})

  -- Courtyard: front wall with a gate, well, laundry, bed, tree; path out through the gate.
  L.box(c.details, 16, 38, 0, 6, 2, 4, wall, {base = true})
  L.box(c.details, 26, 38, 0, 6, 2, 4, wall, {base = true})
  well(L, c, theme)
  laundry(L, c, 18, 20, 26)
  bed(L, c, 24, 34, 6, 4, seed + 40)
  B.plant(L, c.details, 20, 34, 0, 4, theme, seed + 10)
  L.bush(c.details, 10, 42, 3, theme.leaf, seed + 5)
  L.bush(c.details, 36, 42, 3, theme.leaf, seed + 6)
  path(L, c, 22, 40, 4, 6)
  if bio == "northern" then woodpile(L, c, 42, 40) end
end

---------------------------------------------------------------- entry
function F.draw(L, B, c, theme, spec, U)
  L.lot(c.lot, spec.A, spec.B, theme.ground, spec.seed, 0.05)
  if spec.tier == 1 then tier1(L, B, c, theme, spec)
  elseif spec.tier == 2 then tier2(L, B, c, theme, spec)
  else tier3(L, B, c, theme, spec) end
end

return F
