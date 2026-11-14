-- Civic family: guard_house, court, council. Owned by brief 2.
-- guard_house: wooden watchtower -> stone guard house with crenels -> walled compound.
-- court:       columned pediment hall with scales -> town hall -> civic hall with dome and wings.
-- council:     open meeting pavilion -> pitched meeting hall with bell cupola -> assembly hall with clock tower.
-- U.flatHall and the old rooftop cupola are deliberately not used.
local F = {kinds = {"guard_house", "court", "council"}}

-- Crenels: alternating 2-unit merlons along an i-run (fixed j) or a j-run (fixed i).
local function merlonsI(L, c, i0, i1, j, z, ramp)
  for i = i0, i1 - 2, 4 do L.box(c, i, j, z, 2, 2, 3, ramp) end
end

local function merlonsJ(L, c, i, j0, j1, z, ramp)
  for j = j0, j1 - 2, 4 do L.box(c, i, j, z, 2, 2, 3, ramp) end
end

-- Balance-scale icon on a wall plane j. ci = centre i, zb = wall top. Sized to fit a pediment.
local function scales(L, c, ci, j, zb, col)
  L.quad(c, {{ci - 1, j, zb + 1}, {ci + 1, j, zb + 1}, {ci + 1, j, zb + 5}, {ci - 1, j, zb + 5}}, col)
  L.quad(c, {{ci - 5, j, zb + 3}, {ci + 5, j, zb + 3}, {ci + 5, j, zb + 4}, {ci - 5, j, zb + 4}}, col)
  L.quad(c, {{ci - 6, j, zb + 1}, {ci - 2, j, zb + 1}, {ci - 2, j, zb + 2}, {ci - 6, j, zb + 2}}, col)
  L.quad(c, {{ci + 2, j, zb + 1}, {ci + 6, j, zb + 1}, {ci + 6, j, zb + 2}, {ci + 2, j, zb + 2}}, col)
end

-- Stepped slabs leading up to a portico. Slab k = 0 sits nearest the building and is the tallest;
-- each outer slab is 2 units deeper and 2 px lower. Drawn back to front.
local function steps(L, c, i0, j0, A, n, ramp)
  for k = 0, n - 1 do
    L.box(c, i0 - 2 * k, j0 + 2 * k, 0, A + 4 * k, 2, 2 * (n - k), ramp, {base = true})
  end
end

local function columns(L, c, edges, j0, H, ramp)
  for _, i in ipairs(edges) do L.box(c, i, j0, 0, 2, 2, H, ramp) end
end

---------------------------------------------------------------- guard_house
local function guardHouse(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  local stone, wood = L.C.CONCRETE, L.C.WOOD
  if tier == 1 then
    -- Wooden watchtower: four posts, X brace on the front, railed platform (back and left rails),
    -- hip-roofed cabin, open right side with a ladder, and a tiny guard shed at the foot.
    for _, p in ipairs({{10, 10}, {24, 10}, {10, 24}, {24, 24}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 20, wood) end
    L.quad(c.building, {{12, 26, 2}, {13, 26, 2}, {25, 26, 18}, {24, 26, 18}}, wood[3])
    L.quad(c.building, {{24, 26, 2}, {25, 26, 2}, {13, 26, 18}, {12, 26, 18}}, wood[3])
    L.box(c.building, 8, 8, 20, 18, 18, 2, wood)            -- platform, top z 22
    L.box(c.building, 8, 8, 22, 18, 2, 3, wood)             -- back rail
    L.box(c.building, 8, 10, 22, 2, 16, 3, wood)            -- left rail
    local cabin = L.box(c.building, 12, 12, 22, 12, 12, 6, wood, {notop = true, base = true})
    L.hip(c.building, 12, 12, 28, 12, 12, 5, theme.roof, {o = 2, rows = 2})
    L.wallRect(c.building, cabin, "L", 4, 0, 4, 5, L.OUTLINE)
    L.wallRect(c.building, cabin, "R", 4, 2, 2, 2, L.C.GLASS[3])
    -- Ladder on the open right side, from the ground to the platform edge at i = 26.
    L.quad(c.details, {{26, 14, 0}, {26, 15, 0}, {26, 15, 20}, {26, 14, 20}}, wood[4])
    L.quad(c.details, {{26, 19, 0}, {26, 20, 0}, {26, 20, 20}, {26, 19, 20}}, wood[4])
    for z = 3, 15, 4 do L.quad(c.details, {{26, 15, z}, {26, 19, z}, {26, 19, z + 1}, {26, 15, z + 1}}, wood[2]) end
    -- Guard shed at the foot of the tower.
    local sh = L.box(c.building, 30, 12, 0, 8, 8, 6, wood, {notop = true, base = true})
    L.shed(c.building, 30, 12, 6, 8, 8, 3, theme.roof, wood, {o = 2, rows = 2})
    L.wallRect(c.building, sh, "L", 2, 0, 4, 5, L.OUTLINE)
    L.flat(c.lot, 20, 26, 6, 16, L.C.DIRT[3])               -- path from the tower to the lot front
    U.greenery(L, B, c, theme, spec)
  elseif tier == 2 then
    -- Squat stone guard house with crenellated rims, a taller stone tower with flag at the back
    -- corner, a door, arrow slits, a bench, a weapon rack and a lamp.
    L.box(c.building, 4, 4, 0, 8, 8, 24, stone, {base = true})           -- back-corner tower
    for _, p in ipairs({{4, 4}, {10, 4}, {4, 10}, {10, 10}}) do L.box(c.building, p[1], p[2], 24, 2, 2, 3, stone) end
    L.box(c.building, 6, 6, 24, 2, 2, 14, L.C.STEEL)                     -- flag pole to z 38
    L.quad(c.building, {{8, 8, 37}, {14, 8, 35}, {14, 8, 31}, {8, 8, 33}}, theme.roof[4])
    local main = L.box(c.building, 8, 12, 0, 24, 20, 12, stone, {base = true})
    merlonsI(L, c.building, 8, 32, 30, 12, stone)                        -- crenels, street rim
    merlonsJ(L, c.building, 30, 12, 32, 12, stone)                       -- crenels, right rim
    L.wallRect(c.building, main, "L", 10, 0, 4, 7, L.C.WOOD[1])          -- door on the street face
    L.wallRect(c.building, main, "L", 10, 6, 4, 1, L.C.WOOD[3])          -- lighter door head
    L.wallRect(c.building, main, "R", 6, 4, 2, 4, L.OUTLINE)             -- arrow slits
    L.wallRect(c.building, main, "R", 14, 4, 2, 4, L.OUTLINE)
    L.flat(c.lot, 6, 32, 30, 12, stone[4])                               -- forecourt
    L.box(c.details, 14, 36, 0, 8, 2, 3, wood)                           -- bench
    L.box(c.details, 26, 36, 0, 6, 2, 2, wood)                           -- weapon rack
    L.quad(c.details, {{27, 36, 0}, {28, 36, 0}, {28, 36, 12}, {27, 36, 12}}, L.C.STEEL[4])
    L.quad(c.details, {{30, 36, 0}, {31, 36, 0}, {31, 36, 12}, {30, 36, 12}}, L.C.STEEL[4])
    L.box(c.details, 34, 30, 0, 2, 2, 9, L.C.STEEL)                      -- lamp post
    L.box(c.details, 32, 28, 9, 4, 4, 2, L.C.STEEL)                      -- lamp head
    L.dot(c.details, 34, 30, 11, L.LIT)
    U.greenery(L, B, c, theme, spec)
  else
    -- Walled compound: low stone walls with a gate on the street side; inside, a stone guard house,
    -- a tall crenellated tower with flag, and a barracks. Paved yard.
    local yard = L.flat(c.lot, 6, 6, 36, 36, stone[4])
    L.speckle(c.lot, yard, 0.03, stone[3], seed + 3)
    -- Back walls first.
    L.box(c.building, 4, 4, 0, 36, 2, 6, stone, {base = true})           -- north wall
    L.box(c.building, 4, 4, 0, 2, 38, 6, stone, {base = true})           -- north-west wall
    -- Stone guard house.
    local gh = L.box(c.building, 10, 10, 0, 16, 12, 10, stone, {base = true})
    merlonsI(L, c.building, 10, 26, 20, 10, stone)
    merlonsJ(L, c.building, 24, 10, 22, 10, stone)
    L.wallRect(c.building, gh, "L", 6, 0, 4, 7, L.C.WOOD[1])
    L.wallRect(c.building, gh, "R", 4, 4, 2, 4, L.OUTLINE)
    -- Barracks.
    local bar = L.box(c.building, 28, 22, 0, 10, 10, 7, wood, {notop = true, base = true})
    L.shed(c.building, 28, 22, 7, 10, 10, 4, theme.roof, wood, {o = 2, rows = 2})
    L.wallRect(c.building, bar, "L", 2, 0, 4, 5, L.OUTLINE)
    -- Tall tower with crenels and flag.
    L.box(c.building, 30, 8, 0, 8, 8, 26, stone, {base = true})
    for _, p in ipairs({{30, 8}, {36, 8}, {30, 14}, {36, 14}}) do L.box(c.building, p[1], p[2], 26, 2, 2, 3, stone) end
    L.box(c.building, 32, 10, 26, 2, 2, 16, L.C.STEEL)
    L.quad(c.building, {{35, 13, 41}, {41, 13, 39}, {41, 13, 35}, {35, 13, 37}}, theme.roof[4])
    -- Front walls last, with the gate gap at i 22..28.
    L.box(c.building, 40, 4, 0, 2, 38, 6, stone, {base = true})          -- east wall
    L.box(c.building, 6, 40, 0, 16, 2, 6, stone, {base = true})          -- street wall, left of gate
    L.box(c.building, 28, 40, 0, 12, 2, 6, stone, {base = true})         -- street wall, right of gate
    L.bush(c.details, 8, 36, 3, theme.leaf, seed + 11)
  end
end

---------------------------------------------------------------- court
local function court(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  local white = L.C.WHITE
  if tier == 1 then
    -- Pale stone court house: pediment on the street face, two columns, two steps, lamp post.
    local hall = L.box(c.building, 8, 6, 0, 20, 16, 12, white, {notop = true, base = true})
    L.gable(c.building, 8, 6, 12, 20, 16, 7, "j", theme.roof, white, {o = 2, rows = 2})
    L.windows(c.building, hall, "R", {cols = 2, w = 2, h = 3, gap = 4, v0 = 3, sill = white[5]})
    L.wallRect(c.building, hall, "L", 8, 0, 4, 7, L.C.WOOD[1])          -- door, centred at i = 18
    scales(L, c.building, 18, 22, 12, L.C.STEEL[2])                      -- icon in the pediment
    columns(L, c.details, {12, 22}, 24, 12, white)
    L.box(c.details, 10, 24, 12, 16, 2, 2, white)                        -- entablature
    steps(L, c.details, 10, 26, 16, 2, white)
    L.box(c.details, 34, 26, 0, 2, 2, 12, L.C.STEEL)                     -- lamp post
    L.box(c.details, 32, 24, 12, 4, 4, 2, L.C.STEEL)
    L.dot(c.details, 34, 26, 14, L.LIT)
    U.greenery(L, B, c, theme, spec)
  elseif tier == 2 then
    -- Town hall: four columns, full pediment, three steps, tall side windows, paved forecourt, planters.
    local hall = L.box(c.building, 8, 6, 0, 24, 20, 14, white, {notop = true, base = true})
    L.gable(c.building, 8, 6, 14, 24, 20, 9, "j", theme.roof, white, {o = 2, rows = 2})
    L.windows(c.building, hall, "R", {cols = 3, w = 2, h = 4, gap = 4, v0 = 3, sill = white[5]})
    L.wallRect(c.building, hall, "L", 10, 0, 4, 7, L.C.WOOD[1])          -- door, centred at i = 20
    L.wallRect(c.building, hall, "L", 10, 6, 4, 1, L.C.WOOD[3])
    scales(L, c.building, 20, 26, 14, L.C.STEEL[2])
    L.flat(c.lot, 6, 30, 30, 12, white[4])                               -- forecourt
    columns(L, c.details, {10, 16, 22, 28}, 28, 14, white)
    L.box(c.details, 8, 28, 14, 24, 2, 2, white)                         -- entablature
    steps(L, c.details, 10, 30, 20, 3, white)
    L.box(c.details, 4, 38, 0, 4, 4, 3, L.C.CONCRETE)                    -- planters
    L.box(c.details, 36, 38, 0, 4, 4, 3, L.C.CONCRETE)
    L.bush(c.details, 6, 40, 4, theme.leaf, seed + 12)
    L.bush(c.details, 38, 40, 4, theme.leaf, seed + 13)
    U.greenery(L, B, c, theme, spec)
  else
    -- Civic hall: six-column portico, dome on a drum at the ridge, broad steps, side wings,
    -- plaza with statue on a plinth.
    local wing = L.box(c.building, 4, 8, 0, 8, 12, 10, white, {notop = true, base = true})
    L.hip(c.building, 4, 8, 10, 8, 12, 5, theme.roof, {o = 2, rows = 2})
    L.wallRect(c.building, wing, "L", 2, 0, 4, 6, L.C.WOOD[1])
    local hall = L.box(c.building, 12, 4, 0, 24, 18, 16, white, {notop = true, base = true})
    L.gable(c.building, 12, 4, 16, 24, 18, 10, "j", theme.roof, white, {o = 2, rows = 2})
    L.cyl(c.building, 24, 13, 22, 6, 8, white, {matte = true})           -- drum sits in the roof
    L.cyl(c.building, 24, 13, 30, 6, 0, L.C.ROOF_GREEN, {dome = true, matte = true})
    L.windows(c.building, hall, "R", {cols = 3, w = 2, h = 4, gap = 4, v0 = 3, sill = white[5]})
    L.wallRect(c.building, hall, "L", 10, 0, 4, 7, L.C.WOOD[1])          -- door, centred at i = 24
    scales(L, c.building, 24, 22, 16, L.C.STEEL[2])
    L.flat(c.lot, 6, 26, 36, 18, L.C.CONCRETE[4])                        -- plaza
    columns(L, c.details, {12, 16, 20, 26, 30, 34}, 24, 16, white)
    L.box(c.details, 12, 24, 16, 24, 2, 2, white)                        -- entablature
    steps(L, c.details, 12, 26, 24, 3, white)
    L.box(c.details, 22, 38, 0, 4, 4, 4, L.C.CONCRETE)                   -- statue plinth
    L.box(c.details, 22, 38, 4, 4, 4, 8, white)                          -- statue
    L.dot(c.details, 24, 40, 12, white[5])
    local wing2 = L.box(c.building, 36, 8, 0, 8, 12, 10, white, {notop = true, base = true})
    L.hip(c.building, 36, 8, 10, 8, 12, 5, theme.roof, {o = 2, rows = 2})
    L.windows(c.building, wing2, "L", {cols = 2, w = 2, h = 3, gap = 2, v0 = 3, sill = white[5]})
    L.bush(c.details, 10, 44, 3, theme.leaf, seed + 14)
    L.bush(c.details, 34, 44, 3, theme.leaf, seed + 15)
    U.greenery(L, B, c, theme, spec)
  end
end

---------------------------------------------------------------- council
local function council(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  local wood, wall, roof = L.C.WOOD, theme.wall, theme.roof
  if tier == 1 then
    -- Open meeting pavilion: hip roof on four posts, benches under the roof, flag pole and notice board.
    L.box(c.props_back, 14, 14, 0, 8, 4, 3, wood)                        -- benches inside the ring
    L.box(c.props_back, 14, 22, 0, 8, 4, 3, wood)
    for _, p in ipairs({{12, 12}, {26, 12}, {12, 26}, {26, 26}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 10, wood) end
    L.hip(c.building, 10, 10, 10, 20, 20, 6, roof, {o = 2, rows = 2})
    L.box(c.details, 34, 16, 0, 2, 2, 22, L.C.STEEL)                     -- flag pole
    L.quad(c.details, {{36, 18, 21}, {44, 18, 21}, {44, 18, 16}, {36, 18, 16}}, roof[4])
    L.box(c.details, 22, 40, 0, 2, 2, 10, wood)                          -- notice board posts
    L.box(c.details, 16, 40, 0, 2, 2, 10, wood)
    L.box(c.details, 16, 40, 4, 8, 2, 6, wood)                           -- board
    for _, i in ipairs({18, 20, 22}) do L.dot(c.details, i, 42, 7, L.C.WHITE[5]) end
    L.dot(c.details, 19, 42, 9, L.C.WHITE[5])
    U.greenery(L, B, c, theme, spec)
  elseif tier == 2 then
    -- Long pitched meeting hall (ridge along i) with street windows, a double door, a bell cupola
    -- on the ridge, benches and a flag.
    local hall = L.box(c.building, 8, 12, 0, 32, 20, 12, wall, {notop = true, base = true})
    L.gable(c.building, 8, 12, 12, 32, 20, 9, "i", roof, wall, {o = 2, rows = 3})
    L.windows(c.building, hall, "L", {cols = 4, w = 2, h = 3, gap = 4, v0 = 8, sill = wall[5]})
    L.wallRect(c.building, hall, "L", 14, 0, 4, 7, wood[1])              -- double door, centred at i = 24
    L.wallRect(c.building, hall, "L", 14, 6, 4, 1, wood[3])
    L.box(c.building, 22, 20, 18, 4, 4, 7, wall, {notop = true, base = true})   -- bell cupola
    L.hip(c.building, 22, 20, 25, 4, 4, 3, roof, {o = 2, rows = 1})
    L.quad(c.building, {{23, 24, 20}, {25, 24, 20}, {25, 24, 22}, {23, 24, 22}}, L.C.IND_YELLOW[4])
    L.flat(c.lot, 6, 34, 36, 10, L.C.CONCRETE[4])                        -- gathering space
    L.box(c.details, 12, 36, 0, 8, 2, 3, wood)                           -- benches
    L.box(c.details, 26, 36, 0, 8, 2, 3, wood)
    L.box(c.details, 4, 36, 0, 2, 2, 22, L.C.STEEL)                      -- flag pole
    L.quad(c.details, {{6, 38, 22}, {14, 38, 22}, {14, 38, 17}, {6, 38, 17}}, roof[4])
    U.greenery(L, B, c, theme, spec)
  else
    -- Assembly hall with a tall square clock tower at its right end (about 2.9x the eave height),
    -- an annex behind, a plaza with benches, flags and a bush border.
    L.box(c.building, 14, 4, 0, 12, 8, 10, wall, {notop = true, base = true})   -- annex (furthest back)
    L.shed(c.building, 14, 4, 10, 12, 8, 4, roof, wall, {o = 2, rows = 2})
    local hall = L.box(c.building, 8, 14, 0, 24, 16, 14, wall, {notop = true, base = true})
    L.gable(c.building, 8, 14, 14, 24, 16, 9, "i", roof, wall, {o = 2, rows = 3})
    L.windows(c.building, hall, "L", {cols = 4, w = 2, h = 3, gap = 4, v0 = 8, sill = wall[5]})
    L.wallRect(c.building, hall, "L", 10, 0, 4, 7, wood[1])              -- door, centred at i = 12+8
    L.wallRect(c.building, hall, "L", 10, 6, 4, 1, wood[3])
    L.box(c.building, 32, 14, 0, 8, 8, 40, wall, {notop = true, base = true})  -- clock tower
    L.hip(c.building, 32, 14, 40, 8, 8, 8, roof, {o = 2, rows = 2})
    local p = L.P(c.building, 36, 22, 32)                                -- clock face on the j = 22 wall
    L.ellipse(c.building, p[1], p[2], 4, 4, L.OUTLINE)
    L.ellipse(c.building, p[1], p[2], 3, 3, L.C.WHITE[5])
    L.px(c.building, p[1], p[2] - 2, L.OUTLINE)                          -- hands
    L.px(c.building, p[1] + 1, p[2], L.OUTLINE)
    L.flat(c.lot, 6, 30, 36, 14, L.C.CONCRETE[4])                        -- plaza
    L.box(c.details, 12, 36, 0, 8, 2, 3, wood)                           -- benches
    L.box(c.details, 26, 36, 0, 8, 2, 3, wood)
    L.box(c.details, 10, 40, 0, 2, 2, 22, L.C.STEEL)                     -- banner poles
    L.quad(c.details, {{12, 42, 22}, {18, 42, 22}, {18, 42, 17}, {12, 42, 17}}, roof[4])
    L.box(c.details, 38, 40, 0, 2, 2, 22, L.C.STEEL)
    L.quad(c.details, {{32, 42, 22}, {38, 42, 22}, {38, 42, 17}, {32, 42, 17}}, roof[4])
    L.bush(c.details, 26, 44, 3, theme.leaf, seed + 5)
    L.bush(c.details, 34, 44, 3, theme.leaf, seed + 6)
    U.greenery(L, B, c, theme, spec)
  end
end

function F.draw(L, B, c, theme, spec, U)
  L.lot(c.lot, spec.A, spec.B, theme.ground, spec.seed, 0.05)
  local kind = spec.kind
  if kind == "guard_house" then guardHouse(L, B, c, theme, spec, U)
  elseif kind == "court" then court(L, B, c, theme, spec, U)
  elseif kind == "council" then council(L, B, c, theme, spec, U)
  else error("civic family does not draw " .. tostring(kind)) end
end

return F
