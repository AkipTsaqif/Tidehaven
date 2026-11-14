-- Services & industry family: workshop, shop, clinic, public_works. Owned by brief 3.
-- workshop:     brick workshop -> sawtooth craft hall -> factory with smokestacks and loading dock
-- shop:         market stall -> striped-awning shop -> open market hall with coloured stalls
-- clinic:       white dispensary -> portico clinic -> hospital wings with a red cross
-- public_works: tool shed -> fenced town yard with tank -> depot with garage doors and water tower
-- U.flatHall and the yellow vehicle are deliberately not used.
local F = {kinds = {"workshop", "shop", "clinic", "public_works"}}

local function sawtooth(L, c, i0, j0, A, B, z, R, roof, wall, teeth)
  -- Each tooth is a mono-pitch shed; its high edge faces the back. Teeth run along i.
  local w = A / teeth
  for k = 0, teeth - 1 do
    L.shed(c, i0 + k * w, j0, z, w, B, R, roof, wall, {o = 0, rows = 2})
  end
end

-- Square brick chimney that belongs to the roof: drawn before the roof.
local function chimney(L, c, i0, j0, z0, H, ramp)
  return L.box(c, i0, j0, z0, 4, 4, H, ramp, {base = true})
end

---------------------------------------------------------------- workshop
local function workshop(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  local brick, wood, steel = L.C.BRICK, L.C.WOOD, L.C.STEEL
  if tier == 1 then
    -- One-storey brick workshop with a gable roof, a wide dark door with forge glow, a square chimney,
    -- an anvil on a stump and a workbench with tools.
    local wk = L.box(c.building, 8, 8, 0, 20, 16, 12, brick, {notop = true, base = true})
    chimney(L, c.building, 22, 18, 12, 14, brick)                       -- back half of chimney, before roof
    L.gable(c.building, 8, 8, 12, 20, 16, 8, "i", theme.roof, brick, {o = 2, rows = 3})
    L.wallRect(c.building, wk, "L", 4, 0, 10, 8, L.OUTLINE)             -- wide dark doorway
    L.wallRect(c.building, wk, "L", 6, 1, 6, 3, L.C.IND_YELLOW[4])      -- forge glow inside the door
    L.wallRect(c.building, wk, "L", 6, 1, 6, 1, L.LIT)
    L.flat(c.lot, 6, 26, 36, 10, L.C.DIRT[4])                           -- yard
    L.box(c.details, 4, 28, 0, 2, 2, 2, steel)                          -- anvil stump and body
    L.box(c.details, 4, 28, 2, 4, 4, 3, steel, {base = true})
    L.box(c.details, 18, 30, 0, 8, 4, 4, wood, {base = true})           -- workbench
    L.box(c.details, 18, 30, 4, 8, 4, 1, wood)
    L.quad(c.details, {{20, 31, 5}, {22, 31, 5}, {22, 31, 8}, {20, 31, 8}}, steel[4])  -- hammer / tools
    L.quad(c.details, {{24, 31, 5}, {25, 31, 5}, {25, 31, 9}, {24, 31, 9}}, wood[4])
    L.box(c.details, 30, 34, 0, 6, 4, 3, wood, {base = true})           -- crate
    U.greenery(L, B, c, theme, spec, true)
  elseif tier == 2 then
    -- Craft hall: two sawtooth bays with skylights, forge chimney, lean-to storage annex, crates
    -- and a hand cart with planks.
    local hallA, hallB = 24, 20
    L.box(c.building, 6, 6, 0, hallA, hallB, 10, brick, {notop = true, base = true})
    sawtooth(L, c.building, 6, 6, hallA, hallB, 10, 6, theme.roof, brick, 2)
    -- Skylights: glass strips on the upper sawtooth faces.
    L.stripe(c.building, L.flat(c.building, 8, 8, 8, 16, L.C.GLASS[4], 16), "h", 4, L.C.GLASS[5])
    chimney(L, c.props_back, 26, 4, 0, 22, brick)                       -- forge chimney behind hall
    L.box(c.building, 30, 26, 0, 12, 8, 6, wood, {notop = true, base = true})   -- lean-to annex
    L.shed(c.building, 30, 26, 6, 12, 8, 3, theme.roof, wood, {o = 2, rows = 2})
    L.wallRect(c.building, {i0 = 30, j0 = 26, z0 = 0, A = 12, B = 8}, "L", 2, 0, 4, 5, L.OUTLINE)
    L.box(c.details, 8, 36, 0, 6, 4, 4, wood, {base = true})            -- crates
    L.box(c.details, 8, 36, 4, 4, 4, 3, wood, {base = true})
    L.box(c.details, 16, 38, 0, 10, 4, 2, wood, {base = true})          -- hand cart bed
    L.quad(c.details, {{16, 38, 2}, {16, 42, 2}, {16, 42, 5}, {16, 38, 5}}, wood[2])
    L.cyl(c.details, 16, 42, 0, 2, 2, steel, {matte = true})            -- cart wheel
    L.flat(c.lot, 4, 32, 40, 12, L.C.CONCRETE[4])                       -- paved forecourt
    U.greenery(L, B, c, theme, spec, true)
  else
    -- Factory: large brick hall with a four-tooth sawtooth roof, two tall banded smokestacks,
    -- raised loading dock with crates and barrels, small office, paved lot.
    L.flat(c.lot, 0, 0, 48, 48, L.C.ASPHALT[4])
    L.box(c.building, 4, 6, 0, 32, 20, 10, brick, {notop = true, base = true})
    sawtooth(L, c.building, 4, 6, 32, 20, 10, 6, theme.roof, brick, 4)
    -- Two square banded smokestacks. Each stack is drawn back to front.
    local s1 = L.box(c.props_back, 6, 4, 0, 4, 4, 26, brick, {base = true})
    L.stripe(c.props_back, L.flat(c.props_back, 6, 4, 4, 4, brick[4], 26), "h", 4, brick[2])
    local s2 = L.box(c.building, 28, 4, 0, 4, 4, 28, brick, {base = true})
    L.stripe(c.building, L.flat(c.building, 28, 4, 4, 4, brick[4], 28), "h", 4, brick[2])
    -- Raised loading dock with crates and barrels, in front of the hall.
    L.box(c.details, 8, 30, 0, 24, 6, 4, L.C.CONCRETE, {base = true})
    L.box(c.details, 10, 32, 0, 6, 4, 4, wood, {base = true})
    L.box(c.details, 18, 32, 0, 6, 4, 4, wood, {base = true})
    L.cyl(c.details, 26, 34, 0, 3, 5, wood, {cap = wood[4]})
    L.cyl(c.details, 30, 34, 0, 3, 5, wood, {cap = wood[4]})
    -- Office block in theme.wall with a flat roof.
    local office = L.box(c.building, 38, 26, 0, 8, 12, 12, theme.wall, {parapet = {p = 2, d = 2, floor = L.C.CONCRETE}, base = true})
    L.wallRect(c.building, office, "L", 2, 0, 4, 6, L.C.GLASS[2])
    L.windows(c.building, office, "R", {cols = 2, w = 2, h = 3, gap = 2, v0 = 3, sill = theme.wall[5]})
  end
end

---------------------------------------------------------------- shop
local function shop(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  local stripe = L.C.WHITE[4]
  if tier == 1 then
    -- Open market stall: four posts, striped canopy, counter piled with produce, crates and
    -- baskets, and a tiny storage kiosk behind it.
    for _, p in ipairs({{10, 10}, {22, 10}, {10, 22}, {22, 22}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 10, L.C.WOOD) end
    local canopy = L.quad(c.building, {{8, 8, 12}, {26, 8, 12}, {26, 24, 12}, {8, 24, 12}}, theme.roof[4])
    L.stripe(c.building, canopy, "v", 4, stripe, 0)
    L.stripe(c.building, canopy, "v", 4, stripe, 2)
    L.edge(c.building, canopy, "bottom", theme.roof[1])
    L.box(c.details, 12, 26, 0, 10, 4, 4, L.C.WOOD, {base = true})     -- counter
    L.speckle(c.details, L.flat(c.details, 12, 26, 10, 4, L.C.WOOD[4], 4), 0.5, L.C.BARN[4], seed + 1)
    L.box(c.details, 4, 30, 0, 4, 4, 3, L.C.WOOD, {base = true})        -- basket pile
    L.speckle(c.details, L.flat(c.details, 4, 30, 4, 4, L.C.WOOD[4], 3), 0.6, L.FLOWERS[2], seed + 2)
    L.box(c.details, 30, 30, 0, 6, 4, 3, L.C.WOOD, {base = true})       -- crate
    L.box(c.building, 32, 6, 0, 8, 8, 8, L.C.WOOD, {notop = true, base = true})   -- storage kiosk
    L.shed(c.building, 32, 6, 8, 8, 8, 3, theme.roof, L.C.WOOD, {o = 2, rows = 2})
    U.greenery(L, B, c, theme, spec, true)
  elseif tier == 2 then
    -- Two-storey market shop: shop window with wood frame, deep striped awning, upper floor with
    -- shuttered windows, hanging coin sign, display crates out front.
    local sh = L.box(c.building, 8, 6, 0, 20, 24, 18, theme.wall, {notop = true, base = true})
    L.gable(c.building, 8, 6, 18, 20, 24, 8, "j", theme.roof, theme.wall, {o = 2, rows = 2})
    L.wallRect(c.building, sh, "L", 2, 0, 16, 8, L.C.WOOD[1])           -- wood frame around window
    L.wallRect(c.building, sh, "L", 4, 1, 12, 6, L.C.GLASS[3])          -- shop window glass
    L.wallRect(c.building, sh, "L", 4, 1, 12, 1, L.C.GLASS[5])
    L.awning(c.building, sh, "L", 0, 10, 24, 6, 3, theme.roof, stripe)
    L.windows(c.building, sh, "L", {cols = 2, w = 2, h = 3, gap = 4, v0 = 12, sill = theme.wall[5]})
    L.windows(c.building, sh, "R", {cols = 3, w = 2, h = 3, gap = 2, v0 = 3, sill = theme.wall[4]})
    L.windows(c.building, sh, "R", {cols = 3, w = 2, h = 3, gap = 2, v0 = 12, sill = theme.wall[4]})
    -- Coin sign: a 4x4 round disc hanging from a bracket.
    L.box(c.building, 26, 6, 14, 2, 2, 2, L.C.WOOD)
    L.ellipse(c.building, L.P(c.building, 26, 6, 0)[1], L.P(c.building, 26, 6, 0)[2] - 12, 2, 2, L.C.IND_YELLOW[4])
    L.box(c.details, 8, 34, 0, 8, 4, 4, L.C.WOOD, {base = true})       -- display crates
    L.speckle(c.details, L.flat(c.details, 8, 34, 8, 4, L.C.WOOD[4], 4), 0.6, L.FLOWERS[1], seed + 3)
    L.box(c.details, 26, 36, 0, 6, 4, 3, L.C.WOOD, {base = true})
    L.speckle(c.details, L.flat(c.details, 26, 36, 6, 4, L.C.WOOD[4], 3), 0.5, L.C.BARN[4], seed + 4)
    U.greenery(L, B, c, theme, spec, true)
  else
    -- Long open market hall: a large gable on rows of posts with open arcades, three or four stalls
    -- with different awning colours, barrels and carts, paved square.
    L.flat(c.lot, 4, 4, 40, 40, L.C.CONCRETE[4])
    for _, p in ipairs({{6, 8}, {18, 8}, {30, 8}, {6, 26}, {18, 26}, {30, 26}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 12, L.C.WOOD) end
    local hall = L.box(c.building, 4, 4, 0, 40, 36, 2, L.C.WOOD, {notop = true})  -- deck, low
    L.gable(c.building, 4, 4, 12, 40, 36, 10, "j", theme.roof, L.C.WOOD, {o = 2, rows = 3})
    -- Four stalls with different awning colours, along the front.
    local colours = {theme.roof, L.C.ROOF_GREEN, L.C.IND_YELLOW, L.C.GLASS_TEAL}
    for k = 1, 4 do
      local i0 = 6 + (k - 1) * 10
      L.box(c.details, i0, 40, 0, 6, 4, 3, L.C.WOOD, {base = true})     -- stall counter
      local aw = L.quad(c.details, {{i0 - 2, 38, 9}, {i0 + 8, 38, 9}, {i0 + 8, 36, 12}, {i0 - 2, 36, 12}}, colours[k][4])
      L.stripe(c.details, aw, "v", 3, stripe, 0)
      L.edge(c.details, aw, "bottom", colours[k][1])
    end
    L.cyl(c.details, 44, 44, 0, 3, 4, L.C.WOOD, {cap = L.C.WOOD[4]})    -- barrels
    L.cyl(c.details, 40, 40, 0, 3, 4, L.C.WOOD, {cap = L.C.WOOD[4]})
    L.box(c.details, 4, 44, 0, 8, 4, 2, L.C.WOOD, {base = true})        -- hand cart bed
    L.bush(c.details, 42, 42, 3, theme.leaf, seed + 5)
    U.greenery(L, B, c, theme, spec, true)
  end
end

---------------------------------------------------------------- clinic
local function clinic(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  local white, red = L.C.WHITE, L.BEACON
  if tier == 1 then
    -- Small white dispensary with a hip roof, a cross on the street face, porch canopy, bench,
    -- and flower beds.
    local house = L.box(c.building, 8, 8, 0, 20, 16, 10, white, {notop = true, base = true})
    L.hip(c.building, 8, 8, 10, 20, 16, 6, theme.roof, {o = 2, rows = 2})
    L.wallRect(c.building, house, "L", 6, 0, 6, 7, L.C.WOOD[1])         -- door
    -- Red cross beside the porch (the porch canopy and eave would hide it above the door).
    L.wallRect(c.building, house, "L", 14, 4, 6, 2, red)                -- cross arms
    L.wallRect(c.building, house, "L", 16, 2, 2, 6, red)                -- cross stem
    -- Porch canopy.
    L.awning(c.building, house, "L", 4, 8, 10, 4, 2, theme.roof, nil)
    L.box(c.details, 30, 30, 0, 4, 6, 2, L.C.WOOD, {base = true})       -- bench
    L.flat(c.lot, 4, 30, 24, 10, L.C.GRASS[5])                           -- flower bed strip
    for k = 0, 5 do L.dot(c.lot, 6 + k * 3, 32 + (k % 2) * 4, 0, L.FLOWERS[(k % 4) + 1]) end
    U.greenery(L, B, c, theme, spec, true)
  elseif tier == 2 then
    -- Two-storey white clinic with a portico canopy on two posts, cross above the door,
    -- regular windows, fenced garden with bench and patient cart.
    local cl = L.box(c.building, 6, 6, 0, 24, 20, 18, white, {notop = true, base = true})
    L.hip(c.building, 6, 6, 18, 24, 20, 5, theme.roof, {o = 2, rows = 2})
    L.windows(c.building, cl, "R", {cols = 3, w = 2, h = 4, gap = 4, v0 = 3, sill = white[5]})
    L.windows(c.building, cl, "R", {cols = 3, w = 2, h = 4, gap = 4, v0 = 11, sill = white[5]})
    L.wallRect(c.building, cl, "L", 10, 0, 4, 7, L.C.WOOD[1])           -- door
    -- Cross above the door.
    L.wallRect(c.building, cl, "L", 8, 13, 8, 2, red)
    L.wallRect(c.building, cl, "L", 10, 10, 2, 8, red)
    -- Portico canopy on two posts.
    L.box(c.details, 16, 26, 0, 2, 2, 8, white)
    L.box(c.details, 22, 26, 0, 2, 2, 8, white)
    L.awning(c.details, cl, "L", 8, 8, 8, 4, 2, theme.roof, nil)
    -- Fenced garden with bench and cart.
    L.flat(c.lot, 32, 26, 12, 16, L.C.GRASS[5])
    L.box(c.details, 32, 28, 0, 2, 12, 4, L.C.WOOD)
    L.box(c.details, 32, 28, 0, 12, 2, 4, L.C.WOOD)
    L.box(c.details, 34, 36, 0, 6, 2, 2, L.C.WOOD, {base = true})     -- bench
    L.box(c.details, 36, 40, 0, 4, 4, 2, L.C.WOOD, {base = true})      -- patient cart
    L.dot(c.details, 38, 42, 0, L.FLOWERS[1])
    U.greenery(L, B, c, theme, spec, true)
  else
    -- Hospital: main block with a perpendicular wing, central entrance block with bigger cross,
    -- window rows, rooftop water tank and vents, courtyard with trees and a covered walkway.
    local main = L.box(c.building, 4, 8, 0, 32, 12, 18, white, {notop = true, base = true})
    L.hip(c.building, 4, 8, 18, 32, 12, 5, theme.roof, {o = 2, rows = 2})
    local wing = L.box(c.building, 26, 20, 0, 12, 20, 14, white, {notop = true, base = true})
    L.hip(c.building, 26, 20, 14, 12, 20, 4, theme.roof, {o = 2, rows = 2})
    L.windows(c.building, main, "R", {cols = 2, w = 2, h = 4, gap = 4, v0 = 4, sill = white[5]})
    L.windows(c.building, main, "L", {cols = 4, w = 2, h = 4, gap = 4, v0 = 4, sill = white[5]})
    L.windows(c.building, wing, "L", {cols = 2, w = 2, h = 4, gap = 4, v0 = 4, sill = white[5]})
    -- Central entrance block with bigger cross.
    L.box(c.building, 14, 4, 18, 8, 6, 6, white, {notop = true, base = true})
    L.wallRect(c.building, main, "L", 14, 0, 6, 8, L.C.WOOD[1])
    L.wallRect(c.building, main, "L", 4, 13, 6, 2, red)                 -- large cross, clear of the wing
    L.wallRect(c.building, main, "L", 6, 10, 2, 8, red)
    -- Rooftop water tank and vent.
    L.cyl(c.building, 10, 14, 21, 2, 6, L.C.STEEL, {dome = true})     -- sits on the ridge
    L.box(c.building, 28, 28, 14, 2, 2, 4, L.C.STEEL)
    -- Courtyard with trees and covered walkway.
    L.flat(c.lot, 6, 34, 36, 10, L.C.GRASS[4])
    L.box(c.details, 4, 34, 0, 2, 10, 5, white)                         -- covered walkway
    L.box(c.details, 10, 34, 0, 2, 10, 5, white)
    L.flat(c.details, 4, 34, 8, 10, white[5], 5)
    B.plant(L, c.details, 36, 36, 0, 4, theme, seed + 6)
    L.bush(c.details, 14, 44, 3, theme.leaf, seed + 7)
    L.bush(c.details, 30, 44, 3, theme.leaf, seed + 8)
    U.greenery(L, B, c, theme, spec, false)
  end
end

---------------------------------------------------------------- public_works
local function publicWorks(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  local steel, wood = L.C.STEEL, L.C.WOOD
  -- Gravel cone: a small triangle on the lot, shaded in two tones.
  local function gravel(i0, j0, A, B2)
    local m = L.flat(c.details, i0, j0, A, B2, L.C.CONCRETE[3], 0)
    L.poly(c.details, {L.P(c.details, i0 + 1, j0 + 1, 0), L.P(c.details, i0 + A - 1, j0 + 1, 0),
                       L.P(c.details, i0 + A / 2, j0 + B2 / 2, 8)}, L.C.CONCRETE[4])
    return m
  end
  if tier == 1 then
    -- Timber tool shed with shed roof, wheelbarrow, gravel pile, pipes, shovels against the wall.
    local shed = L.box(c.building, 8, 8, 0, 16, 12, 9, wood, {notop = true, base = true})
    L.shed(c.building, 8, 8, 9, 16, 12, 4, theme.roof, wood, {o = 2, rows = 2})
    L.wallRect(c.building, shed, "L", 4, 0, 4, 6, L.OUTLINE)            -- door
    -- Shovels leaning on the right wall (thin wood handles, steel heads).
    for k = 0, 1 do
      local j = 14 + k * 4
      L.quad(c.details, {{26, j, 0}, {26, j, 9}, {26, j + 1, 9}, {26, j + 1, 0}}, wood[4])
      L.box(c.details, 26, j - 2, 9, 2, 2, 2, steel)
    end
    gravel(6, 26, 14, 10)
    -- Pipes: stacked steel cylinders on the lot.
    L.cyl(c.details, 30, 34, 0, 2, 4, steel, {matte = true})
    L.cyl(c.details, 34, 34, 0, 2, 4, steel, {matte = true})
    -- Wheelbarrow: box tray on a wheel.
    L.box(c.details, 36, 38, 2, 6, 4, 2, wood, {base = true})
    L.cyl(c.details, 40, 42, 0, 2, 2, steel, {matte = true})
    U.greenery(L, B, c, theme, spec, true)
  elseif tier == 2 then
    -- Fenced yard with a larger shed, water tank on four legs with conical cap, two material piles, cart.
    -- Fence: low wood posts along the front and right edges.
    for i = 4, 36, 6 do L.box(c.details, i, 40, 0, 2, 2, 4, wood) end
    for j = 4, 40, 6 do L.box(c.details, 40, j, 0, 2, 2, 4, wood) end
    L.quad(c.details, {{4, 41, 3}, {42, 41, 3}, {42, 41, 4}, {4, 41, 4}}, wood[3])
    L.quad(c.details, {{41, 4, 3}, {41, 42, 3}, {41, 42, 4}, {41, 4, 4}}, wood[3])
    local shed = L.box(c.building, 6, 4, 0, 18, 14, 10, wood, {notop = true, base = true})
    L.shed(c.building, 6, 4, 10, 18, 14, 4, theme.roof, wood, {o = 2, rows = 2})
    L.wallRect(c.building, shed, "L", 4, 0, 6, 6, L.OUTLINE)            -- big door
    -- Water tank on four legs with conical cap.
    for _, p in ipairs({{28, 10}, {34, 10}, {28, 16}, {34, 16}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 12, steel) end
    L.cyl(c.building, 32, 14, 12, 6, 8, wood, {matte = true})
    L.poly(c.building, {L.P(c.building, 26, 8, 20), L.P(c.building, 38, 8, 20), L.P(c.building, 32, 14, 26)}, theme.roof[4])
    gravel(6, 26, 14, 10)
    L.box(c.details, 26, 34, 0, 8, 6, 3, wood, {base = true})          -- plank pile
    L.box(c.details, 36, 30, 0, 6, 6, 4, L.C.CONCRETE, {base = true})  -- brick pile
    L.box(c.details, 8, 36, 0, 6, 4, 2, wood, {base = true})            -- hand cart
    L.cyl(c.details, 10, 40, 0, 2, 2, steel, {matte = true})
    U.greenery(L, B, c, theme, spec, true)
  else
    -- Depot: big garage with three doors (dark rects with horizontal slats), tall water tower, material
    -- yard with gravel, sand, bricks and pipes, small office, paved yard.
    L.flat(c.lot, 0, 0, 48, 48, L.C.CONCRETE[4])
    local depot = L.box(c.building, 4, 4, 0, 36, 20, 12, theme.wall, {notop = true, base = true})
    L.hip(c.building, 4, 4, 12, 36, 20, 6, theme.roof, {o = 2, rows = 2})
    for k = 0, 2 do
      local u = 4 + k * 12
      local door = L.wallRect(c.building, depot, "L", u, 0, 8, 8, L.OUTLINE)
      L.stripe(c.building, door, "h", 2, L.C.STEEL[2], 0)
    end
    -- Water tower: four tall legs, tank, conical cap.
    for _, p in ipairs({{34, 30}, {40, 30}, {34, 36}, {40, 36}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 22, steel) end
    L.cyl(c.building, 37, 33, 22, 6, 8, steel, {matte = true})
    L.poly(c.building, {L.P(c.building, 31, 27, 30), L.P(c.building, 43, 27, 30), L.P(c.building, 37, 33, 36)}, theme.roof[4])
    -- Material yard.
    gravel(6, 34, 14, 10)
    L.box(c.details, 22, 40, 0, 8, 6, 3, L.C.CONCRETE, {base = true})  -- bricks
    L.cyl(c.details, 30, 44, 0, 2, 2, steel, {matte = true})           -- pipes
    L.cyl(c.details, 34, 44, 0, 2, 2, steel, {matte = true})
    -- Small office.
    local office = L.box(c.building, 4, 26, 0, 10, 8, 8, theme.wall, {notop = true, base = true})
    L.hip(c.building, 4, 26, 8, 10, 8, 3, theme.roof, {o = 2, rows = 2})
    L.wallRect(c.building, office, "L", 2, 0, 4, 5, L.C.GLASS[2])
    U.greenery(L, B, c, theme, spec, true)
  end
end

function F.draw(L, B, c, theme, spec, U)
  local kind = spec.kind
  local ground = theme.ground
  if kind == "workshop" or kind == "public_works" then ground = L.C.CONCRETE end
  L.lot(c.lot, spec.A, spec.B, ground, spec.seed, 0.05)
  if kind == "workshop" then workshop(L, B, c, theme, spec, U)
  elseif kind == "shop" then shop(L, B, c, theme, spec, U)
  elseif kind == "clinic" then clinic(L, B, c, theme, spec, U)
  elseif kind == "public_works" then publicWorks(L, B, c, theme, spec, U)
  else error("services family does not draw " .. tostring(kind)) end
end

return F
