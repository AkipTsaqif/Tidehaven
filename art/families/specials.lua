-- Special engine states: camp, home_site, development_site, development_abandoned, destroyed.
-- Owned by brief 5. These are real engine states, not pretend functioning businesses.
-- camp:                 ridge tent, campfire, pot on a tripod, bedroll. No walls, no roof structure.
-- home_site:            small timber frame, foundation slab, A-frame truss, plank stack, ladder.
-- development_site:     brick shell at uneven heights, steel scaffold, tall jib crane, site fence and gate.
-- development_abandoned: concrete shell, no roof, rusty scaffold, weeds, broken fence, reclaimed ground.
-- destroyed:            charred brick stumps, collapsed roof slab, fallen beams, rubble, scorch, smoke.
local F = {kinds = {"camp", "home_site", "development_site", "development_abandoned", "destroyed"}}

-- Thin strut between two world points, 1 unit thick in z (about 1 px on screen).
local function strut(L, c, a, b, col)
  return L.quad(c, {a, b, {b[1], b[2], b[3] + 1}, {a[1], a[2], a[3] + 1}}, col)
end

-- Fence run along i at constant j. Posts every 8 units (gap posts skipped), rails as given {z0, z1} pairs.
local function fenceI(L, c, j, i0, i1, ramp, gap0, gap1, rails)
  for i = i0, i1 - 2, 8 do
    if not gap0 or i < gap0 or i >= gap1 then L.box(c, i, j, 0, 2, 2, 6, ramp) end
  end
  for _, r in ipairs(rails) do
    local function seg(a, b)
      if b > a then L.quad(c, {{a, j, r[1]}, {b, j, r[1]}, {b, j, r[2]}, {a, j, r[2]}}, ramp[3]) end
    end
    if gap0 then seg(i0, gap0); seg(gap1, i1) else seg(i0, i1) end
  end
end

---------------------------------------------------------------- camp
local function camp(L, B, c, theme, seed)
  -- Trampled dirt under the tent and fire.
  local trample = L.flat(c.lot, 8, 10, 30, 28, L.C.DIRT[3])
  L.speckle(c.lot, trample, 0.35, L.C.DIRT[4], seed + 4)
  L.shadow(c.shadow, 12, 12, 20, 20, 6)
  -- Ridge tent: ridge along i at j = 30, z = 14. Back slope first, then the front slope and gable flap.
  L.quad(c.building, {{10, 24, 0}, {30, 24, 0}, {28, 30, 14}, {12, 30, 14}}, L.C.WHITE[2])
  L.quad(c.building, {{30, 24, 0}, {30, 36, 0}, {28, 30, 14}}, L.C.WHITE[2])
  L.quad(c.building, {{10, 36, 0}, {30, 36, 0}, {28, 30, 14}, {12, 30, 14}}, L.C.WHITE[3])
  strut(L, c.building, {12, 30, 14}, {28, 30, 14}, L.C.WHITE[5])
  -- Dark opening on the front slope.
  L.quad(c.details, {{18, 36, 0}, {22, 36, 0}, {22, 34, 7}, {18, 34, 7}}, L.OUTLINE)
  -- Campfire: four stones around a flame core at (36, 36).
  for _, p in ipairs({{34, 34}, {38, 34}, {34, 38}, {38, 38}}) do L.box(c.details, p[1], p[2], 0, 2, 2, 2, L.C.CONCRETE) end
  L.dot(c.details, 36, 36, 1, L.LIT)
  L.dot(c.details, 36, 36, 3, L.C.IND_YELLOW[4])
  L.dot(c.details, 35, 36, 4, L.C.BRICK[4])
  L.dot(c.details, 37, 36, 4, L.C.IND_YELLOW[5])
  -- Cooking pot on a tripod at (42, 42).
  strut(L, c.details, {42, 42, 9}, {40, 44, 0}, L.C.WOOD)
  strut(L, c.details, {42, 42, 9}, {44, 44, 0}, L.C.WOOD)
  strut(L, c.details, {42, 42, 9}, {42, 40, 0}, L.C.WOOD)
  L.box(c.details, 40, 40, 5, 2, 2, 4, L.C.STEEL)
  L.dot(c.details, 42, 42, 9, L.C.STEEL[5])
  -- Bedroll and a bundle.
  L.box(c.details, 12, 38, 0, 8, 4, 2, L.C.BARN, {base = true})
  L.box(c.details, 8, 40, 0, 4, 4, 3, L.C.WOOD, {base = true})
  B.plant(L, c.details, 4, 4, 0, 4, theme, seed + 10)
end

---------------------------------------------------------------- home_site
local function homeSite(L, B, c, theme, seed)
  -- Cleared plot.
  local plot = L.flat(c.lot, 8, 8, 28, 28, L.C.DIRT[3])
  L.speckle(c.lot, plot, 0.12, L.C.DIRT[4], seed + 1)
  -- Foundation slab and corner posts.
  L.box(c.building, 10, 10, 0, 20, 20, 2, L.C.CONCRETE, {base = true})
  for _, p in ipairs({{10, 10}, {26, 10}, {10, 26}, {26, 26}}) do L.box(c.building, p[1], p[2], 2, 2, 2, 14, L.C.WOOD) end
  -- Top plates on the back and left sides only.
  L.box(c.building, 10, 10, 16, 18, 2, 2, L.C.WOOD)
  L.box(c.building, 10, 10, 16, 2, 18, 2, L.C.WOOD)
  -- A-frame truss at the right end (plane i = 26), tie beam at z 18.
  strut(L, c.building, {26, 10, 18}, {26, 18, 28}, L.C.WOOD[4])
  strut(L, c.building, {26, 26, 18}, {26, 18, 28}, L.C.WOOD[4])
  L.box(c.building, 26, 10, 18, 2, 16, 2, L.C.WOOD)
  -- Ladder leaning on the truss.
  strut(L, c.details, {30, 14, 0}, {28, 14, 16}, L.C.WOOD[3])
  strut(L, c.details, {32, 14, 0}, {30, 14, 16}, L.C.WOOD[3])
  -- Plank stack and bricks.
  L.box(c.details, 32, 28, 0, 8, 4, 2, L.C.WOOD, {base = true})
  L.box(c.details, 32, 28, 2, 8, 4, 2, L.C.WOOD, {base = true})
  L.box(c.details, 8, 38, 4, 6, 2, 1, L.C.WOOD)
  L.box(c.details, 8, 38, 0, 2, 2, 4, L.C.WOOD)
  L.box(c.details, 12, 38, 0, 2, 2, 4, L.C.WOOD)
  L.box(c.details, 30, 38, 0, 4, 2, 2, L.C.BRICK)
  L.box(c.details, 34, 38, 0, 4, 2, 2, L.C.BRICK)
  L.box(c.details, 32, 38, 2, 4, 2, 2, L.C.BRICK)
  B.plant(L, c.details, 4, 4, 0, 4, theme, seed + 10)
end

---------------------------------------------------------------- development_site
local function developmentSite(L, B, c, theme, seed)
  -- Brick shell at uneven heights: back wall tallest, right wall lower, front footing only.
  L.flat(c.lot, 12, 12, 20, 18, L.C.CONCRETE[4])
  L.box(c.building, 8, 8, 0, 28, 4, 18, L.C.BRICK, {base = true})
  L.box(c.building, 8, 12, 0, 4, 22, 14, L.C.BRICK, {base = true})
  L.box(c.building, 32, 12, 0, 4, 22, 8, L.C.BRICK, {base = true})
  L.box(c.building, 12, 30, 0, 12, 4, 4, L.C.BRICK, {base = true})
  -- Steel scaffold: back posts behind the shell, front posts in front of it, planks at two levels.
  L.box(c.props_back, 6, 6, 0, 2, 2, 22, L.C.STEEL)
  L.box(c.props_back, 38, 6, 0, 2, 2, 22, L.C.STEEL)
  L.box(c.details, 6, 36, 0, 2, 2, 22, L.C.STEEL)
  L.box(c.details, 22, 36, 0, 2, 2, 22, L.C.STEEL)
  L.box(c.details, 38, 36, 0, 2, 2, 22, L.C.STEEL)
  L.box(c.details, 6, 36, 12, 32, 2, 2, L.C.WOOD)
  L.box(c.details, 6, 36, 20, 32, 2, 2, L.C.WOOD)
  L.box(c.details, 38, 6, 12, 2, 30, 2, L.C.WOOD)
  -- Tall jib crane: base, mast at the back-right corner, jib over the site, rope and hanging brick load.
  L.box(c.details, 40, 2, 0, 6, 6, 4, L.C.STEEL, {base = true})
  L.box(c.details, 42, 4, 0, 2, 2, 40, L.C.STEEL)
  L.box(c.details, 26, 4, 39, 16, 2, 2, L.C.STEEL)
  strut(L, c.details, {26, 5, 39}, {26, 5, 22}, L.C.STEEL[2])
  L.box(c.details, 24, 4, 18, 4, 4, 4, L.C.BRICK)
  -- Material pallets and a mixing trough at the front.
  L.box(c.details, 20, 40, 0, 8, 4, 3, L.C.BRICK, {base = true})
  L.box(c.details, 30, 40, 0, 6, 4, 3, L.C.WOOD, {base = true})
  L.box(c.details, 36, 40, 0, 6, 4, 2, L.C.CONCRETE, {base = true})
  L.box(c.details, 42, 30, 0, 4, 6, 3, L.C.CONCRETE, {base = true})
  -- Site fence along the front with a gate between i 18 and 24.
  fenceI(L, c.details, 44, 6, 42, L.C.WOOD, 18, 24, {{3, 4}, {1, 2}})
  L.box(c.details, 18, 44, 0, 2, 2, 8, L.C.WOOD)
  L.box(c.details, 24, 44, 0, 2, 2, 8, L.C.WOOD)
  B.plant(L, c.details, 4, 4, 0, 4, theme, seed + 10)
end

---------------------------------------------------------------- development_abandoned
local function developmentAbandoned(L, B, c, theme, seed)
  -- Overgrown ground: reclaimed grass tufts over the lot and inside the shell.
  local reclaim = L.flat(c.lot, 6, 6, 36, 36, theme.ground[4])
  L.speckle(c.lot, reclaim, 0.20, theme.leaf[3], seed + 1)
  local inside = L.flat(c.lot, 12, 12, 20, 16, theme.ground[3])
  L.speckle(c.lot, inside, 0.25, theme.leaf[4], seed + 2)
  -- Concrete shell with no roof: uneven heights, a broken chunk on the back wall, and a stub on the right.
  L.box(c.building, 8, 8, 0, 28, 4, 14, L.C.CONCRETE, {base = true})
  L.box(c.building, 8, 12, 0, 4, 18, 9, L.C.CONCRETE, {base = true})
  L.box(c.building, 32, 12, 0, 4, 14, 4, L.C.CONCRETE, {base = true})
  L.box(c.building, 14, 8, 14, 4, 4, 2, L.C.CONCRETE)
  -- Rusty scaffold: two posts (one shorter), a partial plank, a leaning pole and a fallen pole.
  L.box(c.props_back, 6, 6, 0, 2, 2, 16, L.C.RUST)
  L.box(c.props_back, 38, 6, 0, 2, 2, 12, L.C.RUST)
  L.box(c.props_back, 6, 6, 12, 16, 2, 2, L.C.RUST)
  strut(L, c.details, {40, 38, 0}, {34, 32, 18}, L.C.RUST[4])
  strut(L, c.details, {16, 40, 1}, {28, 40, 1}, L.C.RUST[3])
  -- Weeds growing through the shell.
  L.bush(c.details, 20, 26, 3, theme.leaf, seed + 5)
  L.bush(c.details, 30, 30, 3, theme.leaf, seed + 6)
  -- Broken fence: posts with one top rail and a missing section.
  fenceI(L, c.details, 44, 6, 42, L.C.WOOD, 26, 32, {{3, 4}})
  B.plant(L, c.details, 4, 4, 0, 4, theme, seed + 10)
end

---------------------------------------------------------------- destroyed
local function destroyed(L, B, c, theme, seed)
  -- Scorch and rubble on dark ground.
  local scorch = L.flat(c.lot, 8, 8, 30, 30, L.C.DIRT[1])
  L.speckle(c.lot, scorch, 0.12, L.C.DIRT[2], seed + 2)
  local rubble = L.flat(c.lot, 14, 16, 22, 20, L.C.DIRT[1])
  L.speckle(c.lot, rubble, 0.25, L.C.CONCRETE[2], seed + 3)
  L.speckle(c.lot, rubble, 0.10, L.C.BRICK[3], seed + 4)
  -- Charred brick wall stumps of different heights, back wall and left wall.
  L.box(c.building, 10, 8, 0, 6, 4, 12, L.C.BRICK, {base = true})
  L.box(c.building, 18, 8, 0, 4, 4, 6, L.C.BRICK, {base = true})
  L.box(c.building, 26, 8, 0, 6, 4, 15, L.C.BRICK, {base = true})
  L.box(c.building, 36, 8, 0, 4, 4, 8, L.C.BRICK, {base = true})
  L.box(c.building, 8, 14, 0, 4, 6, 10, L.C.BRICK, {base = true})
  L.box(c.building, 8, 22, 0, 4, 6, 5, L.C.BRICK, {base = true})
  -- Charred posts in the rubble.
  L.box(c.details, 22, 22, 0, 2, 2, 8, L.C.WOOD)
  L.box(c.details, 32, 26, 0, 2, 2, 5, L.C.WOOD)
  -- Collapsed roof: a tile slab sloping down into the rubble.
  local slab = L.quad(c.building, {{14, 16, 12}, {30, 16, 12}, {34, 26, 2}, {18, 26, 2}}, theme.roof[3])
  L.stripe(c.building, slab, "dr", 3, theme.roof[2])
  -- Fallen beams lying across the rubble.
  strut(L, c.details, {14, 20, 0}, {26, 30, 4}, L.C.WOOD[1])
  strut(L, c.details, {24, 14, 0}, {36, 22, 2}, L.C.WOOD[2])
  -- Thin smoke wisp above the back wall.
  L.dot(c.details, 12, 10, 26, L.C.WHITE[3])
  L.dot(c.details, 12, 10, 30, L.C.WHITE[2])
  L.dot(c.details, 12, 8, 34, L.C.WHITE[3])
end

function F.draw(L, B, c, theme, spec, U)
  local kind, seed = spec.kind, spec.seed
  L.lot(c.lot, 48, 48, theme.ground, seed, 0.05)
  if kind == "camp" then camp(L, B, c, theme, seed)
  elseif kind == "home_site" then homeSite(L, B, c, theme, seed)
  elseif kind == "development_site" then developmentSite(L, B, c, theme, seed)
  elseif kind == "development_abandoned" then developmentAbandoned(L, B, c, theme, seed)
  elseif kind == "destroyed" then destroyed(L, B, c, theme, seed)
  else error("specials family does not draw " .. tostring(kind)) end
end

return F
