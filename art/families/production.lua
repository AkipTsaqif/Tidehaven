-- Production family: farm, fishery, bakery, timber_camp. Owned by brief 1.
-- Each kind has its own working main building (barn, boat shed/hut, oven+shop, saw shed/hall).
-- U.house is deliberately not used: the four kinds must not read as cottages.
local F = {kinds = {"farm", "fishery", "bakery", "timber_camp"}}

-- Side fence along an i-constant line (posts every 6 units, two rails).
local function fenceI(L, c, i, j0, j1, ramp)
  for j = j0, j1 - 2, 6 do L.box(c.details, i, j, 0, 2, 2, 6, ramp) end
  L.quad(c.details, {{i, j0, 4}, {i, j1, 4}, {i, j1, 5}, {i, j0, 5}}, ramp[3])
  L.quad(c.details, {{i, j0, 2}, {i, j1, 2}, {i, j1, 3}, {i, j0, 3}}, ramp[3])
end

-- Stacked logs running along i. Each log is a box; its visible end (right face) gets a ring.
local function logPile(L, c, i0, j0, courses, logs, len, ramp)
  for k = 0, courses - 1 do
    for m = 0, logs - 1 do
      L.box(c.details, i0, j0 + m * 4, k * 3, len, 4, 3, ramp, {base = true})
      local p = L.P(c.details, i0 + len, j0 + m * 4 + 2, k * 3 + 1.5)
      L.ellipse(c.details, p[1], p[2], 2, 2, ramp[4])
      L.px(c.details, math.floor(p[1]), math.floor(p[2]), ramp[1])
    end
  end
end

-- Four diagonal sail blades in screen space around a hub (windmill).
local function sails(L, c, hx, hy, R, cloth, arm)
  for k = 0, 3 do
    local a = k * math.pi / 2 + math.pi / 4
    local dx, dy = math.cos(a), math.sin(a)
    local px, py = -dy * 2, dx * 2
    local x0, y0 = hx + dx * 3, hy + dy * 3
    local x1, y1 = hx + dx * R, hy + dy * R
    L.poly(c, {{x0 + px, y0 + py}, {x1 + px, y1 + py}, {x1 - px, y1 - py}, {x0 - px, y0 - py}}, cloth)
  end
  L.ellipse(c, hx, hy, 2, 2, arm)
end

-- Crop field: DIRT bed with crop rows along j. Arid gets sparser rows.
local function field(L, c, theme, i0, j0, A, B, rowRamp, seed)
  local bed = L.flat(c.lot, i0, j0, A, B, L.C.DIRT[3])
  local period = (theme.biome == "arid") and 8 or 4
  L.stripe(c.lot, bed, "ur", period, rowRamp)
  L.speckle(c.lot, bed, 0.05, L.C.WHEAT[5], seed)
  return bed
end

local function farm(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  if tier == 1 then
    -- Garden farm: low timber shed at the back, crop rows over the front, fence, basket.
    field(L, c, theme, 4, 30, 38, 14, L.C.WHEAT[4], seed + 1)
    local shed = L.box(c.building, 8, 8, 0, 12, 10, 8, L.C.WOOD, {notop = true, base = true})
    L.shed(c.building, 8, 8, 8, 12, 10, 4, theme.roof, L.C.WOOD, {o = 2, rows = 3})
    L.wallRect(c.building, shed, "L", 4, 0, 4, 6, L.C.WOOD[1])
    fenceI(L, c, 44, 4, 28, L.C.WOOD)
    local basket = L.box(c.details, 28, 26, 0, 4, 4, 3, L.C.WOOD, {base = true})
    L.speckle(c.details, basket.top, 0.6, L.C.WHEAT[4], seed + 2)
  elseif tier == 2 then
    -- Farmstead: a real barn with its ridge along j, so the big gable faces the street.
    field(L, c, theme, 4, 30, 38, 14, L.C.WHEAT[4], seed + 1)
    field(L, c, theme, 30, 4, 14, 20, theme.leaf[4], seed + 3)
    local barn = L.box(c.building, 6, 6, 0, 20, 24, 12, L.C.BARN, {notop = true, base = true})
    L.gable(c.building, 6, 6, 12, 20, 24, 10, "j", theme.roof, L.C.BARN, {o = 2, rows = 3})
    L.wallRect(c.building, barn, "L", 8, 0, 4, 7, L.C.WOOD[1])
    -- X brace across the barn door (street face j = 30; door spans i 14..18, z 0..7).
    L.quad(c.building, {{14, 30, 0}, {15, 30, 0}, {18, 30, 7}, {17, 30, 7}}, L.C.WOOD[4])
    L.quad(c.building, {{17, 30, 0}, {18, 30, 0}, {15, 30, 7}, {14, 30, 7}}, L.C.WOOD[4])
    L.cyl(c.details, 36, 36, 0, 4, 18, L.C.WHITE, {dome = true})
    fenceI(L, c, 46, 4, 24, L.C.WOOD)
  else
    -- Large farm: barn, granary, two silos, hay bales, fields on two sides, track to the lot edge.
    field(L, c, theme, 30, 18, 16, 12, theme.leaf[4], seed + 3)
    field(L, c, theme, 4, 36, 40, 10, L.C.WHEAT[4], seed + 1)
    L.flat(c.lot, 14, 32, 6, 16, L.C.DIRT[4])
    L.box(c.building, 4, 4, 0, 24, 28, 14, L.C.BARN, {notop = true, base = true})
    L.gable(c.building, 4, 4, 14, 24, 28, 10, "j", theme.roof, L.C.BARN, {o = 2, rows = 3})
    local barn = {i0 = 4, j0 = 4, z0 = 0, A = 24, B = 28}
    L.wallRect(c.building, barn, "L", 10, 0, 4, 7, L.C.WOOD[1])
    L.box(c.building, 32, 4, 0, 12, 12, 10, L.C.WHITE, {notop = true, base = true})
    L.hip(c.building, 32, 4, 10, 12, 12, 6, theme.roof, {o = 2, rows = 3})
    L.cyl(c.details, 34, 34, 0, 4, 18, L.C.WHITE, {dome = true})
    L.cyl(c.details, 42, 34, 0, 3, 12, L.C.STEEL, {dome = true})
    L.cyl(c.details, 22, 42, 0, 3, 3, L.C.WHEAT, {matte = true})
    L.cyl(c.details, 27, 44, 0, 3, 3, L.C.WHEAT, {matte = true})
  end
end

local function fishery(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  -- Shoreline is fixed on the high-i edge: sand strip, then water to the lot edge.
  local sand = L.flat(c.lot, 32, 0, 4, 48, theme.sand[3])
  L.speckle(c.lot, sand, 0.06, theme.sand[4], seed + 3)
  local water = L.flat(c.lot, 36, 0, 12, 48, theme.water[3])
  L.stripe(c.lot, water, "h", 5, theme.water[4])
  L.stripe(c.lot, water, "h", 5, theme.water[5], 2)
  local function rowBoat(j0, jl)
    L.box(c.details, 38, j0, 0, 6, jl, 2, L.C.WOOD, {base = true})
    L.flat(c.details, 40, j0 + 2, 2, jl - 4, L.C.WOOD[1], 2)
  end
  local function netRack(i0, j)
    L.box(c.details, i0, j, 0, 2, 2, 8, L.C.WOOD)
    L.box(c.details, i0 + 8, j, 0, 2, 2, 8, L.C.WOOD)
    L.box(c.details, i0, j, 8, 10, 2, 1, L.C.WOOD)
    local net = L.quad(c.details, {{i0 + 2, j, 2}, {i0 + 8, j, 2}, {i0 + 8, j, 7}, {i0 + 2, j, 7}}, L.C.WHITE[3])
    L.stripe(c.details, net, "dr", 2, L.C.WHITE[2])
  end
  if tier == 1 then
    -- Fishing hut on stilts at the water's edge, net rack, short pier, one rowing boat.
    local px = L.flat(c.details, 28, 12, 20, 4, L.C.WOOD[4], 2)
    for _, i in ipairs({30, 36, 42}) do L.box(c.props_back, i, 12, 0, 2, 2, 2, L.C.WOOD) end
    for _, p in ipairs({{16, 6}, {26, 6}, {16, 16}, {26, 16}}) do
      L.box(c.props_back, p[1], p[2], 0, 2, 2, 3, L.C.WOOD)
    end
    local hut = L.box(c.building, 16, 6, 3, 12, 12, 8, L.C.WOOD, {notop = true, base = true})
    L.gable(c.building, 16, 6, 11, 12, 12, 7, "i", theme.roof, L.C.WOOD, {o = 2, rows = 3})
    L.wallRect(c.building, hut, "L", 4, 0, 4, 7, L.C.WOOD[1])
    L.wallRect(c.building, hut, "R", 4, 3, 4, 3, L.C.GLASS[3])
    netRack(18, 22)
    rowBoat(24, 12)
  elseif tier == 2 then
    -- Fishing station: boat shed with a wide dark doorway on the water-facing (right) side.
    local pier = L.flat(c.details, 28, 20, 20, 4, L.C.WOOD[4], 2)
    for _, i in ipairs({30, 36, 42}) do L.box(c.props_back, i, 20, 0, 2, 2, 2, L.C.WOOD) end
    local shed = L.box(c.building, 18, 4, 0, 14, 12, 10, L.C.WOOD, {notop = true, base = true})
    L.gable(c.building, 18, 4, 10, 14, 12, 6, "i", theme.roof, L.C.WOOD, {o = 2, rows = 3})
    L.wallRect(c.building, shed, "R", 2, 0, 8, 7, L.OUTLINE)
    netRack(16, 22 + 4)
    rowBoat(26, 10)
    -- Second boat with a mast and sail.
    L.box(c.details, 38, 38, 0, 6, 8, 2, L.C.WOOD, {base = true})
    L.box(c.details, 40, 40, 2, 2, 2, 14, L.C.WOOD)
    L.quad(c.details, {{42, 40, 5}, {42, 44, 5}, {42, 42, 15}}, L.C.WHITE[4])
    L.cyl(c.details, 24, 26, 0, 3, 5, L.C.WOOD, {cap = L.C.WOOD[4]})
    L.cyl(c.details, 24, 30, 0, 3, 5, L.C.WOOD, {cap = L.C.WOOD[4]})
    L.box(c.details, 28, 28, 0, 4, 4, 4, L.C.WOOD, {base = true})
    L.box(c.details, 28, 28, 4, 4, 4, 3, L.C.WOOD, {base = true})
  else
    -- Fishing harbour: L-shaped pier, warehouse with gable roof, hand crane, three boats, crates.
    L.flat(c.details, 28, 12, 20, 4, L.C.WOOD[4], 2)
    L.flat(c.details, 36, 16, 4, 20, L.C.WOOD[4], 2)
    for _, p in ipairs({{30, 12}, {36, 20}, {36, 28}, {36, 34}}) do L.box(c.props_back, p[1], p[2], 0, 2, 2, 2, L.C.WOOD) end
    local wh = L.box(c.building, 6, 4, 0, 20, 16, 12, theme.wall, {notop = true, base = true})
    L.gable(c.building, 6, 4, 12, 20, 16, 9, "i", theme.roof, theme.wall, {o = 2, rows = 3})
    L.wallRect(c.building, wh, "L", 6, 0, 8, 8, L.C.WOOD[1])
    L.box(c.details, 30, 22, 0, 2, 2, 16, L.C.WOOD)
    L.box(c.details, 30, 22, 15, 8, 2, 2, L.C.WOOD)
    for z = 9, 13 do L.dot(c.details, 37, 23, z, L.C.STEEL[2]) end
    L.box(c.details, 36, 22, 6, 2, 2, 2, L.C.STEEL)
    L.box(c.details, 22, 30, 0, 4, 4, 4, L.C.WOOD, {base = true})
    L.box(c.details, 22, 30, 4, 4, 4, 4, L.C.WOOD, {base = true})
    L.box(c.details, 26, 30, 0, 4, 4, 4, L.C.WOOD, {base = true})
    -- Boats: rowing boat, sailing boat, small boat.
    L.box(c.details, 42, 16, 0, 4, 10, 2, L.C.WOOD, {base = true})
    L.box(c.details, 42, 30, 0, 4, 12, 2, L.C.WOOD, {base = true})
    L.box(c.details, 42, 34, 2, 2, 2, 14, L.C.WOOD)
    L.quad(c.details, {{44, 32, 4}, {44, 40, 4}, {44, 36, 15}}, L.C.WHITE[4])
    L.box(c.details, 36, 40, 0, 4, 6, 2, L.C.WOOD, {base = true})
  end
  U.greenery(L, B, c, theme, spec, false)
end

local function bakery(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  -- Paved forecourt at the front of the lot.
  local court = L.flat(c.lot, 6, 34, 36, 12, L.C.CONCRETE[4])
  L.speckle(c.lot, court, 0.03, L.C.CONCRETE[3], seed + 5)
  -- Dome oven with dark mouth on its front. (ic, jc) = oven centre, r = screen radius.
  local function oven(ic, jc, r, H)
    L.cyl(c.building, ic, jc, 0, r, H, L.C.BRICK, {dome = true, matte = true})
    local p = L.P(c.building, ic, jc, 0)
    L.poly(c.building, {{p[1] - 2, p[2] - 5}, {p[1] + 2, p[2] - 5}, {p[1] + 2, p[2] - 1}, {p[1] - 2, p[2] - 1}}, L.OUTLINE)
  end
  if tier == 1 then
    -- Free-standing dome oven beside a lean-to counter hut, woodpile and table of loaves.
    oven(14, 26, 8, 10)
    local hut = L.box(c.building, 22, 8, 0, 16, 14, 8, theme.wall, {notop = true, base = true})
    L.shed(c.building, 22, 8, 8, 16, 14, 5, theme.roof, theme.wall, {o = 2, rows = 3})
    L.wallRect(c.building, hut, "L", 4, 0, 4, 6, L.C.WOOD[1])
    L.box(c.details, 24, 24, 0, 10, 4, 4, L.C.WOOD, {base = true})
    L.box(c.details, 26, 24, 4, 4, 4, 2, L.C.WHEAT, {base = true})
    L.box(c.details, 30, 24, 4, 4, 4, 2, L.C.WHEAT, {base = true})
    L.box(c.details, 6, 38, 0, 8, 4, 3, L.C.WOOD, {base = true})
    L.box(c.details, 6, 38, 3, 8, 4, 2, L.C.WOOD, {base = true})
    local tray = L.box(c.details, 30, 36, 0, 8, 6, 3, L.C.WOOD, {base = true})
    L.speckle(c.details, tray.top, 0.5, L.C.WHEAT[4], seed + 2)
  else
    -- Narrow two-storey shop: gable on the street face, striped awning, loaf sign, brick chimney.
    local shop = {i0 = 12, j0 = 6, z0 = 0, A = 16, B = 24}
    L.box(c.building, 12, 6, 0, 16, 24, 20, theme.wall, {notop = true, base = true})
    L.box(c.building, 22, 8, 20, 2, 2, 14, L.C.BRICK)
    L.gable(c.building, 12, 6, 20, 16, 24, 8, "j", theme.roof, theme.wall, {o = 2, rows = 3})
    L.windows(c.building, shop, "L", {u0 = 2, cols = 1, w = 8, h = 6, v0 = 2, glass = L.C.GLASS, sill = theme.wall[5]})
    L.wallRect(c.building, shop, "L", 12, 0, 4, 7, L.C.WOOD[1])
    L.awning(c.building, shop, "L", 2, 10, 10, 4, 2, theme.roof, L.C.WHITE[4])
    -- Loaf sign: WOOD board with a WHEAT loaf and crust.
    L.wallRect(c.building, shop, "L", 4, 10, 8, 4, L.C.WOOD[3])
    L.wallRect(c.building, shop, "L", 6, 11, 4, 2, L.C.WHEAT[4])
    L.wallRect(c.building, shop, "L", 6, 13, 4, 1, L.C.WHEAT[2])
    L.windows(c.building, shop, "L", {cols = 2, w = 2, h = 3, gap = 4, v0 = 15, sill = theme.wall[5]})
    L.windows(c.building, shop, "R", {cols = 3, w = 2, h = 3, gap = 2, v0 = 4, sill = theme.wall[4]})
    L.windows(c.building, shop, "R", {cols = 3, w = 2, h = 3, gap = 2, v0 = 14, sill = theme.wall[4]})
    oven(32, 20, 6, 9)
    if tier == 3 then
      -- Windmill for flour: round tower, conical cap and four sails in screen space.
      L.cyl(c.building, 38, 38, 0, 7, 28, L.C.WHITE, {dome = false, matte = true})
      L.poly(c.building, {{40, 66}, {56, 66}, {48, 56}}, theme.roof[4])
      sails(L, c.details, 48, 66, 13, L.C.WHITE[4], L.C.WOOD[3])
      L.box(c.details, 26, 40, 0, 4, 4, 3, L.C.WHITE, {base = true})
      L.box(c.details, 30, 40, 0, 4, 4, 3, L.C.WHITE, {base = true})
    end
  end
  U.greenery(L, B, c, theme, spec, false)
end

local function timber(L, B, c, theme, spec, U)
  local tier, seed = spec.tier, spec.seed
  -- Standing trees behind the site: 2 at T1, 3 at T2 and T3.
  local spots = {{4, 6}, {14, 2}, {2, 20}}
  for k = 1, (tier == 1 and 2 or 3) do
    B.plant(L, c.props_back, spots[k][1], spots[k][2], 0, 4, theme, seed + k * 5)
  end
  if tier == 1 then
    -- Open lean-to shelter on posts, chopping block with axe, log pile, stumps.
    for _, p in ipairs({{8, 6}, {18, 6}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 10, L.C.WOOD) end
    for _, p in ipairs({{8, 14}, {18, 14}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 8, L.C.WOOD) end
    L.shed(c.building, 6, 4, 8, 16, 12, 4, theme.roof, L.C.WOOD, {o = 2, rows = 3})
    L.box(c.details, 30, 28, 0, 4, 4, 5, L.C.WOOD, {base = true})
    L.box(c.details, 32, 30, 5, 2, 2, 3, L.C.STEEL)
    for z = 6, 10 do L.dot(c.details, 33, 29, z, L.C.WOOD[2]) end
    logPile(L, c, 30, 34, 2, 2, 12, L.C.WOOD)
    L.cyl(c.details, 40, 22, 0, 3, 3, L.C.WOOD, {cap = L.C.WOOD[4]})
    L.cyl(c.details, 44, 30, 0, 3, 3, L.C.WOOD, {cap = L.C.WOOD[4]})
  elseif tier == 2 then
    -- Open-sided saw shed on posts with a long low roof, sawhorse, log piles, planks, cart.
    for _, p in ipairs({{8, 4}, {30, 4}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 8, L.C.WOOD) end
    for _, p in ipairs({{8, 14}, {30, 14}}) do L.box(c.building, p[1], p[2], 0, 2, 2, 6, L.C.WOOD) end
    L.box(c.building, 14, 4, 0, 12, 4, 4, L.C.WOOD, {base = true})
    L.shed(c.building, 6, 2, 6, 28, 14, 4, theme.roof, L.C.WOOD, {o = 2, rows = 3})
    L.box(c.details, 18, 22, 0, 2, 2, 6, L.C.WOOD)
    L.box(c.details, 26, 22, 0, 2, 2, 6, L.C.WOOD)
    L.box(c.details, 16, 20, 6, 14, 4, 3, L.C.WOOD, {base = true})
    logPile(L, c, 4, 32, 2, 2, 12, L.C.WOOD)
    logPile(L, c, 28, 34, 2, 2, 12, L.C.WOOD)
    L.box(c.details, 34, 22, 0, 8, 6, 2, L.C.WOOD, {base = true})
    L.box(c.details, 34, 22, 2, 8, 6, 2, L.C.WOOD, {base = true})
    L.box(c.details, 20, 42, 0, 6, 4, 3, L.C.WOOD, {base = true})
  else
    -- Timber-framed sawmill hall (box + gable, vertical framing stripes), log yard, plank stack,
    -- hand crane and stumps where the forest was cut.
    local hall = L.box(c.building, 8, 4, 0, 24, 16, 14, L.C.WOOD, {notop = true, base = true})
    L.stripe(c.building, hall.left, "v", 6, L.C.WOOD[1])
    L.stripe(c.building, hall.right, "v", 6, L.C.WOOD[1])
    L.gable(c.building, 8, 4, 14, 24, 16, 10, "i", theme.roof, L.C.WOOD, {o = 2, rows = 3})
    L.wallRect(c.building, hall, "L", 8, 0, 8, 9, L.C.WOOD[1])
    L.windows(c.building, hall, "L", {cols = 2, w = 4, h = 3, gap = 6, v0 = 10, sill = L.C.WOOD[5]})
    logPile(L, c, 30, 26, 3, 2, 12, L.C.WOOD)
    logPile(L, c, 4, 34, 2, 3, 12, L.C.WOOD)
    logPile(L, c, 22, 38, 2, 2, 8, L.C.WOOD)
    L.box(c.details, 36, 40, 0, 8, 6, 2, L.C.WOOD, {base = true})
    L.box(c.details, 36, 40, 2, 8, 6, 2, L.C.WOOD, {base = true})
    L.box(c.details, 40, 20, 0, 2, 2, 16, L.C.WOOD)
    L.box(c.details, 40, 20, 15, 6, 2, 2, L.C.WOOD)
    for z = 9, 13 do L.dot(c.details, 45, 21, z, L.C.STEEL[2]) end
    L.cyl(c.details, 38, 8, 0, 3, 3, L.C.WOOD, {cap = L.C.WOOD[4]})
    L.cyl(c.details, 44, 12, 0, 3, 3, L.C.WOOD, {cap = L.C.WOOD[4]})
    L.cyl(c.details, 40, 2, 0, 3, 3, L.C.WOOD, {cap = L.C.WOOD[4]})
  end
  U.greenery(L, B, c, theme, spec, false)
end

function F.draw(L, B, c, theme, spec, U)
  L.lot(c.lot, spec.A, spec.B, theme.ground, spec.seed, 0.05)
  local kind = spec.kind
  if kind == "farm" then farm(L, B, c, theme, spec, U)
  elseif kind == "fishery" then fishery(L, B, c, theme, spec, U)
  elseif kind == "bakery" then bakery(L, B, c, theme, spec, U)
  elseif kind == "timber_camp" then timber(L, B, c, theme, spec, U)
  else error("production family does not draw " .. tostring(kind)) end
end

return F
