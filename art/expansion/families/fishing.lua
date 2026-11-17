-- art/expansion/families/fishing.lua
-- Fishing boats: fishing_canoe / net_boat / fishing_sailboat.
--
-- Same authoring model as the general boats (art/expansion/families/boats.lua), with fishing gear
-- instead of cargo: a local boat frame where +u points at the BOW and +v at the camera-near
-- broadside, mapped onto the world axes per heading:
--   ne = -j, se = +i, sw = +j, nw = -i.
-- The camera therefore sees the +j broadside for SE/NW (lit ramp step 3) and the +i broadside for
-- SW/NE (shaded ramp step 2), and the visible end is the bow for SE/SW and the stern transom for
-- NW/NE.  The four headings are four separate drawings with one fixed light source.
--
-- Fishing identity, not cargo identity: paddles, a gear basket, line and pot gear (canoe); a net
-- drying rack over a marked working deck with baskets and a float line (net_boat); a mast, sail and
-- rigging with net/float storage and a small covered gear area (fishing_sailboat).  Loaded states
-- carry fish crates with a few silver/teal fish forms inside the crate rim, never a loose heap.
-- No fish schools are painted into these assets: water markers are a separate family.
--
-- Layers: the boat's own structure and attached gear is one silhouette in c.building so the
-- runner's 1 px outline wraps the whole boat instead of ringing every spar; c.details holds loose
-- gear that legitimately sits proud of the deck; c.shadow holds only the water shadow.

local F = {}

-- ux, uy, vx, vy: world direction of +u (bow) and +v (camera-near side)
local DIR = {
  se = { 1, 0, 0, 1 },
  nw = { -1, 0, 0, 1 },
  sw = { 0, 1, 1, 0 },
  ne = { 0, -1, 1, 0 },
}

local function frame(heading, A, B)
  local d = assert(DIR[heading], 'unknown fishing heading ' .. tostring(heading))
  return { ux = d[1], uy = d[2], vx = d[3], vy = d[4], ci = A / 2, cj = B / 2 }
end

local function Wp(f, u, v, z)
  return { f.ci + f.ux * u + f.vx * v, f.cj + f.uy * u + f.vy * v, z }
end

local function quad(L, c, f, pts, col)
  local o = {}
  for k = 1, #pts do o[k] = Wp(f, pts[k][1], pts[k][2], pts[k][3]) end
  return L.quad(c, o, col)
end

local function dotUV(L, c, f, u, v, z, col)
  local p = Wp(f, u, v, z)
  L.dot(c, p[1], p[2], p[3], col)
end

-- Outward normal of a boat-local edge on the world axes (visible when it points to +i or +j).
local function edgeNormal(f, a, b)
  local nu, nv = b[2] - a[2], -(b[1] - a[1])
  local mu, mv = (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
  if nu * mu + nv * mv < 0 then nu, nv = -nu, -nv end
  return nu * f.ux + nv * f.vx, nu * f.uy + nv * f.vy
end

-- Fixed light from the upper left: +j broadside bright (ramp 3), +i broadside shaded (ramp 2).
local function faceCol(R, ni, nj)
  if ni + nj <= 0 then return nil end
  if nj >= ni then return (ni == 0) and R[3] or R[2] end
  return (nj == 0) and R[2] or R[3]
end

-- ------------------------------------------------------------------ hull data
local SPEC = {
  fishing_canoe = {
    free = 2,
    profile = { { 7, 0 }, { 6, 0.8 }, { 4, 1.6 }, { 1, 2.4 }, { -2, 2.4 }, { -4, 1.8 }, { -7, 0.6 } },
    smashed = { { 4.6, 1.2 }, { 1, 2.4 }, { -2, 2.4 }, { -4, 1.8 }, { -6, 0.6 } },
  },
  net_boat = {
    free = 3,
    profile = { { 7, 0 }, { 6, 1 }, { 4, 3 }, { 1, 4.4 }, { -3, 4.4 }, { -6, 3.4 }, { -7, 3 } },
    smashed = { { 4.4, 2 }, { 1, 4.4 }, { -3, 4.4 }, { -6, 3.4 }, { -5.6, 2 } },
  },
  fishing_sailboat = {
    free = 3,
    profile = { { 14, 0 }, { 13, 1 }, { 11, 3 }, { 8, 5 }, { 3, 6 }, { -6, 6 }, { -11, 5 }, { -14, 3.6 } },
    smashed = { { 10, 3 }, { 8, 5 }, { 3, 6 }, { -6, 6 }, { -11, 5 }, { -12.6, 2.4 } },
  },
}

-- Closed outline: bow tip -> +v side -> stern edge -> -v side -> back to the bow.
local function outline(profile)
  local out = {}
  for _, p in ipairs(profile) do out[#out + 1] = { p[1], p[2] } end
  out[#out + 1] = { profile[#profile][1], -profile[#profile][2] }
  for k = #profile, 1, -1 do out[#out + 1] = { profile[k][1], -profile[k][2] } end
  out[#out] = nil
  return out
end

local function inset(profile, d)
  local out = {}
  for _, p in ipairs(profile) do
    local u, hw = p[1], math.max(0, p[2] - d)
    if #out == 0 or out[#out][1] > u then out[#out + 1] = { u, hw } end
  end
  return out
end

-- ------------------------------------------------------------------ hull parts
local function planPoly(L, c, f, profile, z, col, grow)
  local g = grow or 0
  local pts = {}
  for _, p in ipairs(profile) do pts[#pts + 1] = { p[1], math.max(0, p[2] + g), z } end
  pts[#pts + 1] = { profile[#profile][1], -math.max(0, profile[#profile][2] + g), z }
  for k = #profile, 1, -1 do
    pts[#pts + 1] = { profile[k][1], -math.max(0, profile[k][2] + g), z }
  end
  return quad(L, c, f, pts, col)
end

local function hullSide(L, c, f, ol, free, R, opt)
  opt = opt or {}
  local n = #ol
  for k = 1, n do
    local a, b = ol[k], ol[k % n + 1]
    local ni, nj = edgeNormal(f, a, b)
    local col = faceCol(R, ni, nj)
    local mu = (a[1] + b[1]) / 2
    local holed = opt.hole and mu >= opt.hole[1] and mu <= opt.hole[2]
    if col and not holed then
      if a[2] == b[2] then
        quad(L, c, f, { { a[1], a[2], free }, { b[1], b[2], free }, { b[1], b[2], 1 }, { a[1], a[2], 1 } }, col)
        quad(L, c, f, { { a[1], a[2], 1 }, { b[1], b[2], 1 }, { b[1], b[2], 0 }, { a[1], a[2], 0 } }, R[1])
      else
        quad(L, c, f, { { a[1], a[2], free }, { b[1], b[2], free }, { b[1], b[2], 0 }, { a[1], a[2], 0 } }, col)
      end
    end
  end
end

local function prism(L, c, f, u0, v0, u1, v1, z0, z1, R, colTop)
  local o = { { u0, v0 }, { u1, v0 }, { u1, v1 }, { u0, v1 } }
  for k = 1, 4 do
    local a, b = o[k], o[k % 4 + 1]
    local ni, nj = edgeNormal(f, a, b)
    local col = faceCol(R, ni, nj)
    if col then
      quad(L, c, f, { { a[1], a[2], z1 }, { b[1], b[2], z1 }, { b[1], b[2], z0 }, { a[1], a[2], z0 } }, col)
    end
  end
  return quad(L, c, f, { { u0, v0, z1 }, { u1, v0, z1 }, { u1, v1, z1 }, { u0, v1, z1 } }, colTop or R[4])
end

-- 1 px line; the step count follows the steepest axis so rigging and ropes stay connected
-- (a fixed u-step would break a steep line into detached specks).
local function thinLine(L, c, f, u0, v0, z0, u1, v1, z1, col)
  local n = math.max(1, math.floor(math.abs(u1 - u0) + math.abs(v1 - v0)),
    math.floor(math.abs(z1 - z0)))
  for k = 0, n do
    local t = k / n
    local p = Wp(f, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, math.floor(z0 + (z1 - z0) * t + 0.5))
    L.dot(c, p[1], p[2], p[3], col)
  end
end

local function deckSeams(L, c, f, profile, vs, z, col)
  local lo = profile[#profile][1]
  for _, v in ipairs(vs) do
    quad(L, c, f, { { -lo, v, z }, { lo, v, z }, { lo, v + 1, z }, { -lo, v + 1, z } }, col)
  end
end

local function rimHighlight(L, c, f, profile, z, col)
  for k = 1, #profile - 1 do
    local a, b = profile[k], profile[k + 1]
    local ni, nj = edgeNormal(f, { a[1], a[2] }, { b[1], b[2] })
    if ni + nj > 0 then
      quad(L, c, f, { { a[1], a[2] - 1, z }, { b[1], b[2] - 1, z }, { b[1], b[2], z }, { a[1], a[2], z } }, col)
    end
  end
end

-- Hull, gunwale, interior. opt.hole punches sprung planking; opt.smashed uses the broken plan.
local function hullBody(L, c, f, sp, s, opt)
  local R = L.C.WOOD
  local free = sp.free
  local prof = (opt.smashed and sp.smashed) or sp.profile
  hullSide(L, c.building, f, outline(prof), free, R, opt)
  planPoly(L, c.building, f, prof, free, R[4])
  planPoly(L, c.building, f, inset(prof, 1), free, opt.deck1 or R[2])
  planPoly(L, c.building, f, inset(prof, 2), free, opt.deck2 or R[1])
  rimHighlight(L, c.building, f, prof, free, R[5])
  return prof
end

-- ------------------------------------------------------------------ shared fishing gear
-- Woven basket: staved sides, a lit rim, a darker weave line.
local function basket(L, c, f, u0, v0, u1, v1, z0, z1, ramp)
  prism(L, c, f, u0, v0, u1, v1, z0, z1, ramp, ramp[4])
  quad(L, c, f, { { u0 + 0.4, v1 - 0.4, z0 + (z1 - z0) * 0.45 },
    { u1 - 0.4, v1 - 0.4, z0 + (z1 - z0) * 0.45 }, { u1 - 0.4, v1, z0 + (z1 - z0) * 0.45 },
    { u0 + 0.4, v1, z0 + (z1 - z0) * 0.45 } }, ramp[2])
  quad(L, c, f, { { u0, v0, z1 }, { u0, v1, z1 }, { u0 + 0.6, v1, z1 }, { u0 + 0.6, v0, z1 } }, ramp[5])
end

-- Salt-water float: a two-tone cork/glass ball with a rope eye.
local function floatBall(L, c, f, u, v, z, body, hi)
  quad(L, c, f, { { u - 0.6, v, z }, { u + 0.6, v, z }, { u + 0.6, v, z + 1.2 }, { u - 0.6, v, z + 1.2 } }, body)
  dotUV(L, c, f, u - 0.2, v, z + 1.2, hi)
  dotUV(L, c, f, u, v, z + 1.6, L.C.WOOD[2])
end

-- Fish crate: an open crate with a few silver/teal fish inside the rim (never a loose heap).
local function fishCrate(L, c, f, u0, v0, u1, v1, z, ramp)
  local silver, teal = L.C.STEEL[4], L.C.GLASS_TEAL[4]
  prism(L, c, f, u0, v0, u1, v1, z, z + 2, ramp, ramp[3])
  local inner = quad(L, c, f, { { u0 + 0.6, v0 + 0.6, z + 2 }, { u1 - 0.6, v0 + 0.6, z + 2 },
    { u1 - 0.6, v1 - 0.6, z + 2 }, { u0 + 0.6, v1 - 0.6, z + 2 } }, L.C.STEEL[2])
  local _ = inner
  -- four fish bodies: silver back, teal shade, tail flick
  local cu, cv = (u0 + u1) / 2, (v0 + v1) / 2
  for k = -1, 1, 2 do
    quad(L, c, f, { { cu + k * 0.8 - 0.4, cv - 0.8, z + 2.4 },
      { cu + k * 0.8 + 0.6, cv - 0.4, z + 2.4 }, { cu + k * 0.8 + 0.6, cv + 0.6, z + 2.4 },
      { cu + k * 0.8 - 0.4, cv + 0.6, z + 2.4 } }, silver)
    dotUV(L, c, f, cu + k * 0.8 - 0.6, cv + 0.2, z + 2.4, teal)
  end
  quad(L, c, f, { { cu + 0.2, cv + 0.6, z + 2.4 }, { cu + 1.4, cv + 1.2, z + 2.4 },
    { cu + 1.4, cv + 0.4, z + 2.4 }, { cu + 0.2, cv - 0.2, z + 2.4 } }, silver)
end

-- Drying net draped over a rail: a mesh sheet lying across the aft deck plus a skirt hanging over
-- the near gunwale, so the net reads as a net at 1x instead of a thin vertical sliver. The damaged
-- variant loses the after third of the sheet and leaves loose strands, still tied to the frame.
local function netSheet(L, c, f, u0, u1, vHalf, zt, zb, torn)
  local sheet = (f.vx == 0) and L.C.WHITE[3] or L.C.WHITE[2]
  local weave = (f.vx == 0) and L.C.WHITE[1] or L.C.WHITE[4]
  local rope = L.C.WOOD[4]
  local ub = torn and (u0 + (u1 - u0) * 0.6) or u1
  quad(L, c, f, { { u0, -vHalf, zt }, { ub, -vHalf, zt }, { ub, vHalf, zt }, { u0, vHalf, zt } }, sheet)
  local v = -vHalf + 1
  while v < vHalf - 0.4 do
    thinLine(L, c, f, u0, v, zt, ub, v, zt, weave)
    v = v + 2
  end
  local u = u0 + 1
  while u < ub - 0.4 do
    thinLine(L, c, f, u, -vHalf, zt, u, vHalf, zt, weave)
    u = u + 2
  end
  thinLine(L, c, f, u0, -vHalf, zt, ub, -vHalf, zt, rope)
  thinLine(L, c, f, u0, vHalf, zt, ub, vHalf, zt, rope)
  thinLine(L, c, f, u0, -vHalf, zt, u0, vHalf, zt, rope)
  thinLine(L, c, f, ub, -vHalf, zt, ub, vHalf, zt, rope)
  -- skirt hanging over the near rail
  quad(L, c, f, { { u0, vHalf, zt }, { ub, vHalf, zt }, { ub, vHalf, zb }, { u0, vHalf, zb } }, sheet)
  u = u0 + 1
  while u < ub - 0.4 do
    thinLine(L, c, f, u, vHalf, zt, u, vHalf, zb, weave)
    u = u + 1.5
  end
  thinLine(L, c, f, u0, vHalf, zb, ub, vHalf, zb, rope)
  if torn then
    thinLine(L, c, f, ub, vHalf - 0.6, zt, ub + 1.2, vHalf - 0.2, zt - 1.6, weave)
    thinLine(L, c, f, ub - 0.4, vHalf, zb + 0.8, ub + 0.6, vHalf, zb - 1.2, weave)
    quad(L, c, f, { { ub - 1.4, vHalf - 0.3, zt - 1.2 }, { ub - 0.4, vHalf - 0.3, zt - 0.8 },
      { ub - 0.4, vHalf - 0.3, zt - 2.2 }, { ub - 1.4, vHalf - 0.3, zt - 2.6 } }, weave)
  end
  return ub
end

-- Paddle: shaft plus blade, shipped along the near gunwale with the blade forward.
local function paddle(L, c, f, u0, v, z, len, broken)
  local R = L.C.WOOD
  local zu = z
  if broken then
    thinLine(L, c, f, u0, v, zu, u0 - len * 0.45, v, zu, R[3])
    thinLine(L, c, f, u0 - len * 0.45, v, zu, u0 - len * 0.3, v, zu - 0.8, R[2])
    quad(L, c, f, { { u0 + 1.4, v - 0.4, zu }, { u0 + 2.6, v, zu },
      { u0 + 2.6, v + 1.4, zu }, { u0 + 1.4, v + 1.2, zu } }, R[4])
  else
    thinLine(L, c, f, u0, v, zu, u0 - len, v, zu, R[3])
    quad(L, c, f, { { u0 - len + 1.2, v - 0.6, zu }, { u0 - len - 1.4, v + 0.2, zu },
      { u0 - len - 1.4, v + 1.8, zu }, { u0 - len + 1.2, v + 1.4, zu } }, R[4])
  end
end

-- ------------------------------------------------------------------ fishing canoe
local function canoe(L, c, f, sp, theme, s)
  local R = L.C.WOOD
  local free = sp.free
  local st = s.visualState
  local plank = theme.roof[4]
  local prof = hullBody(L, c, f, sp, s, {
    hole = (st == 'damaged') and { -2.4, -0.6 } or nil,
    smashed = (st == 'damaged') or nil,
    deck1 = R[2], deck2 = R[1],
  })
  -- lit sheer stripe: the biome cue at this size is paint on the hull, not an extra silhouette
  for k = -2, 0, 1 do dotUV(L, c.building, f, k * 1.4 - 0.6, 2.2, free - 1, plank) end
  -- raised stem head at the bow, so the double-ended canoe still reads bow vs stern
  prism(L, c.building, f, prof[1][1] - 1.2, -0.6, prof[1][1], 0.6, free - 0.4, free + 1.4, R, R[4])
  -- gear basket aft of the paddler
  basket(L, c.building, f, -5.6, -1.2, -3.4, 1.2, free + 1, free + 2.6, L.C.WHEAT)
  -- paddle shipped along the near gunwale, plus a spare inboard
  paddle(L, c.building, f, 4.6, 2.0, free + 1.4, 8, st == 'damaged')
  if st ~= 'damaged' then paddle(L, c.building, f, 2.2, -1.6, free + 1.6, 6.4, false) end
  -- simple line and pot gear: a coil of line, two floats and a woven pot at the bow
  thinLine(L, c.building, f, 1.4, 1.6, free + 1, 0.2, 1.6, free + 1, R[4])
  thinLine(L, c.building, f, 0.2, 1.6, free + 1, 0.2, 0.4, free + 1, R[4])
  floatBall(L, c.building, f, 5.6, -1.6, free + 1, theme.roof[4], theme.roof[5])
  if st ~= 'damaged' then floatBall(L, c.building, f, 4.4, -1.8, free + 1, theme.roof[3], theme.roof[4]) end
  basket(L, c.building, f, 5.6, -2.4, 7, -1.2, free + 1, free + 2.4, L.C.ADOBE)

  if st == 'loaded' then
    fishCrate(L, c.details, f, -3.4, -1.6, -1, 0.8, free + 1, R)
    basket(L, c.details, f, -0.6, 0.4, 0.8, 1.8, free + 1, free + 2.2, L.C.WHEAT)
  end
  if st == 'damaged' then
    -- tipped basket, lost pot and loose line
    thinLine(L, c.building, f, -4.6, 1.8, free + 1, -3.2, 2.2, 0.6, R[3])
    dotUV(L, c.details, f, -2.2, 2, free + 1, L.C.WHEAT[2])
  end
end

-- ------------------------------------------------------------------ net boat
local function netBoat(L, c, f, sp, theme, s)
  local R = L.C.WOOD
  local free = sp.free
  local st = s.visualState
  local torn = (st == 'damaged')
  local prof = hullBody(L, c, f, sp, s, {
    hole = (torn) and { -4.6, -2.6 } or nil,
    smashed = torn or nil,
    deck1 = theme.roof[3], deck2 = R[3],
  })
  deckSeams(L, c.building, f, prof, { -2, 2 }, free, R[2])
  -- marked working area: a lighter sorting bay with a rope border
  local bay = { -0.4, -2.4, 3.6, 2.4 }
  quad(L, c.building, f, { { bay[1], bay[2], free + 0.5 }, { bay[3], bay[2], free + 0.5 },
    { bay[3], bay[4], free + 0.5 }, { bay[1], bay[4], free + 0.5 } }, R[4])
  for _, seg in ipairs({ { bay[1], bay[2], bay[3], bay[2] }, { bay[3], bay[2], bay[3], bay[4] },
    { bay[3], bay[4], bay[1], bay[4] }, { bay[1], bay[4], bay[1], bay[2] } }) do
    thinLine(L, c.building, f, seg[1], seg[2], free + 1, seg[3], seg[4], free + 1, R[2])
  end
  -- net-drying rack: forked posts carrying the drying net draped across the aft deck
  for _, u in ipairs({ -6.4, -1.2 }) do
    local top = free + 4.2
    prism(L, c.building, f, u - 0.6, 2, u + 0.6, 3.2, free, (torn and u == -6.4) and free + 3 or top, R, R[5])
    if torn and u == -6.4 then
      thinLine(L, c.building, f, u, 2.6, free + 3, u - 1.6, 2.6, free + 4.2, R[3])   -- snapped fork
    else
      thinLine(L, c.building, f, u - 0.9, 2.6, top, u + 0.9, 2.6, top, R[4])
    end
  end
  netSheet(L, c.building, f, -6.6, -0.8, 2.6, free + 4.2, free + 1.8, torn)
  -- baskets and a float line over the near gunwale
  basket(L, c.building, f, 4.2, -3, 5.6, -1.6, free + 1, free + 2.6, L.C.WHEAT)
  if not torn then basket(L, c.building, f, 4.6, 0.6, 6, 2, free + 1, free + 2.4, L.C.ADOBE) end
  thinLine(L, c.building, f, -7, 3, free + 1, 6.6, 3, free + 1, R[3])
  for k = 0, 2 do floatBall(L, c.building, f, -5.4 + k * 3.2, 3, free + 1, theme.roof[4], theme.roof[5]) end
  -- bow cleat and mooring strop
  prism(L, c.building, f, 6.2, -0.8, 7, 0.8, free, free + 1.4, R, R[4])

  if st == 'loaded' then
    fishCrate(L, c.details, f, 0, -1.8, 2.4, 0, free + 1, R)
    fishCrate(L, c.details, f, 2.8, 0.2, 4.6, 1.8, free + 1, R)
    basket(L, c.details, f, 1, 1, 2.4, 2.2, free + 1, free + 2.2, L.C.WHEAT)
  end
  if torn then
    -- net bundle torn loose at the after end, still tied to the rack foot
    quad(L, c.details, f, { { -5.4, -0.4, free + 1 }, { -4, -0.4, free + 1.8 },
      { -4, -0.4, free + 2.6 }, { -5.4, -0.4, free + 2 } }, L.C.WHITE[2])
    thinLine(L, c.details, f, -5.4, -0.4, free + 2.4, -6.2, -0.4, free + 1, L.C.WOOD[4])
    dotUV(L, c.details, f, 2.4, 2.6, free + 1, L.C.WHEAT[2])
  end
end

-- ------------------------------------------------------------------ fishing sailboat
local function fishingSailboat(L, c, f, sp, theme, s)
  local R = L.C.WOOD
  local free = sp.free
  local st = s.visualState
  local torn = (st == 'damaged')
  local mastU, mastTop = 3, 44
  local prof = hullBody(L, c, f, sp, s, {
    hole = (torn) and { -9.6, -7.6 } or nil,
    smashed = torn or nil,
    deck1 = theme.roof[3], deck2 = R[3],
  })
  deckSeams(L, c.building, f, prof, { -3, 1 }, free, R[2])
  -- small covered gear area aft: four posts under a tilting roof
  for _, u in ipairs({ -11, -6 }) do
    for _, v in ipairs({ -4.4, 4.4 }) do
      prism(L, c.building, f, u - 0.5, v - 0.5, u + 0.5, v + 0.5, free + 1, free + 5, R, R[4])
    end
  end
  quad(L, c.building, f, { { -12, -5.4, free + 6 }, { -5, -5.4, free + 6 },
    { -5, 0, free + 7.4 }, { -12, 0, free + 7.4 } }, theme.roof[4])
  quad(L, c.building, f, { { -12, 0, free + 7.4 }, { -5, 0, free + 7.4 },
    { -5, 5.4, free + 6 }, { -12, 5.4, free + 6 } }, theme.roof[2])
  thinLine(L, c.building, f, -12, 0, free + 7.5, -5, 0, free + 7.5, theme.roof[5])
  -- net and float storage on the foredeck, plus a lashed net roll on the cabin side
  quad(L, c.building, f, { { 5.4, -3.6, free + 2 }, { 9.4, -3.6, free + 2 },
    { 9.4, -0.4, free + 2 }, { 5.4, -0.4, free + 2 } }, L.C.WHITE[3])
  thinLine(L, c.building, f, 5.4, -2.8, free + 2.6, 9.4, -2.8, free + 2.6, L.C.WHITE[1])
  thinLine(L, c.building, f, 5.4, -1.2, free + 2.6, 9.4, -1.2, free + 2.6, L.C.WHITE[1])
  for k = 0, 1 do floatBall(L, c.building, f, 10.4 + k * 1.6, -1.2, free + 1, theme.roof[4], theme.roof[5]) end
  prism(L, c.building, f, -3.4, 2.4, -0.6, 4.4, free + 1, free + 3, L.C.WHITE, L.C.WHITE[3])
  -- mast, rigging and sail
  prism(L, c.building, f, mastU, -1, mastU + 2, 1, free + 1, mastTop, R, R[5])
  thinLine(L, c.building, f, mastU + 1, 0, mastTop - 1, 13.4, 0, free + 2, R[2])
  thinLine(L, c.building, f, mastU + 1, 0, mastTop - 1, -12.4, 0, free + 7, R[2])
  quad(L, c.building, f, { { mastU + 1, -0.4, mastTop }, { mastU - 2.6, -0.4, mastTop - 2.6 },
    { mastU - 2.6, 0.4, mastTop - 2.6 }, { mastU + 1, 0.4, mastTop } }, theme.roof[4])
  local sail = (f.vx == 0) and L.C.WHITE[4] or L.C.WHITE[3]
  local seam = (f.vx == 0) and L.C.WHITE[2] or L.C.WHITE[5]
  if torn then
    -- torn above the reef; yard still stepped, patch sewn over the tear
    quad(L, c.building, f, { { mastU, 0, 20 }, { -5, 0, 18 }, { -11, 0, 12 }, { mastU, 0, 10 } }, sail)
    quad(L, c.building, f, { { mastU, 0, 20 }, { -3.4, 0, 19 }, { -5, 0, 11 }, { mastU, 0, 10 } }, seam)
    thinLine(L, c.building, f, mastU + 0.4, 0, 38.6, -7.2, 0, 33.6, R[3])   -- bare gaff still stepped
    thinLine(L, c.building, f, -11.4, 0, 12.4, mastU + 0.4, 0, 10.2, R[3])
    quad(L, c.building, f, { { -7, -0.3, 15 }, { -5.2, -0.3, 14.4 }, { -5.2, -0.3, 12.4 },
      { -7, -0.3, 13 } }, L.C.WHITE[5])
  else
    -- gaff main: head and gaff peak up top, boom along the foot, so the silhouette is a
    -- four-sided working sail rather than the general boat's triangular lateen
    quad(L, c.building, f, { { mastU, 0, 38 }, { -6.6, 0, 33 }, { -11, 0, 12 }, { mastU, 0, 10 } }, sail)
    quad(L, c.building, f, { { mastU, 0, 38 }, { -3.6, 0, 35.4 }, { -5.4, 0, 11 }, { mastU, 0, 10 } }, seam)
    thinLine(L, c.building, f, mastU + 0.4, 0, 38.6, -7.2, 0, 33.6, R[3])      -- gaff
    thinLine(L, c.building, f, -11.4, 0, 12.4, mastU + 0.4, 0, 10.2, R[3])     -- boom
    thinLine(L, c.building, f, -7.2, 0, 33.6, -11.4, 0, 12.4, R[2])           -- leech
    thinLine(L, c.building, f, -11.4, 0, 12.4, -11.8, 0, 10, R[2])
  end
  -- steering oar over the quarter
  prism(L, c.building, f, -12.6, -0.8, -11.4, 0.8, 0, 2.6, R, R[2])

  if st == 'loaded' then
    fishCrate(L, c.details, f, 5.6, 0.6, 8, 2.6, free + 1, R)
    fishCrate(L, c.details, f, 6, -4.4, 8.4, -2.6, free + 1, R)
  end
  if torn then
    thinLine(L, c.details, f, 9.6, -1, free + 3, 11, -2, free + 1.4, L.C.WHITE[2])
    dotUV(L, c.details, f, 4.6, 3, free + 1, L.C.WHEAT[2])
  end
end

-- ------------------------------------------------------------------ dispatch
local DRAW = {
  fishing_canoe = canoe,
  net_boat = netBoat,
  fishing_sailboat = fishingSailboat,
}

function F.draw(L, B, c, theme, s)
  local sp = assert(SPEC[s.kind], 'unknown fishing kind ' .. tostring(s.kind))
  local f = frame(s.orientation, s.A, s.B)
  planPoly(L, c.shadow, f, sp.profile, 0, L.SHADOW, 1)
  DRAW[s.kind](L, c, f, sp, theme, s)
end

return F
