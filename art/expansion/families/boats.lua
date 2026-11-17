-- art/expansion/families/boats.lua
-- General boats: rowboat / work_skiff / cargo_barge / coastal_sailboat.
--
-- Every boat is authored in a local boat frame and then mapped onto the world axes per heading:
--   +u points at the BOW, +v points at the camera-near broadside, z is up from the waterline z=0.
-- Heading NE means the bow points to screen north-east, which in this projection is the -j axis;
-- SE is +i, SW is +j, NW is -i.  The four headings are four separately drawn objects, never one
-- bitmap flipped: the camera sees the +j broadside for SE/NW and the +i broadside for SW/NE, and
-- the visible end is the bow for SE/SW and the stern transom for NW/NE.  The light is fixed:
-- +j faces take the lit ramp step and +i faces the shaded one, in every heading.
--
-- Layer use: the boat's own structure (hull, gunwale, interior, thwarts, oars, mast, sail,
-- rigging, stern gear) is one silhouette in c.building, so the runner's automatic 1 px outline
-- wraps the whole boat instead of ringing every thin spar.  c.details holds cargo and loose gear
-- that legitimately sits proud of the deck.  c.shadow holds the water shadow only.
-- Nothing but the boat is painted: the background stays transparent for every asset.

local F = {}

-- ux, uy, vx, vy: world direction of +u (bow) and +v (camera-near side)
local DIR = {
  se = { 1, 0, 0, 1 },
  nw = { -1, 0, 0, 1 },
  sw = { 0, 1, 1, 0 },
  ne = { 0, -1, 1, 0 },
}

-- ------------------------------------------------------------------ boat frames
local function frame(heading, A, B)
  local d = assert(DIR[heading], 'unknown boat heading ' .. tostring(heading))
  return { ux = d[1], uy = d[2], vx = d[3], vy = d[4], ci = A / 2, cj = B / 2 }
end

-- world point for the boat-local coordinate (u, v, z)
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

-- Outward normal of a boat-local edge on the world axes. A vertical face is visible when its
-- outward normal points towards +i or +j (the camera side).
local function edgeNormal(f, a, b)
  local nu, nv = b[2] - a[2], -(b[1] - a[1])
  local mu, mv = (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
  if nu * mu + nv * mv < 0 then nu, nv = -nu, -nv end
  return nu * f.ux + nv * f.vx, nu * f.uy + nv * f.vy
end

-- Fixed light from the upper left: +j broadside bright (ramp 3), +i broadside shaded (ramp 2),
-- and a curved face turning away from the light drops one step.
local function faceCol(R, ni, nj)
  if ni + nj <= 0 then return nil end
  if nj >= ni then return (ni == 0) and R[3] or R[2] end
  return (nj == 0) and R[2] or R[3]
end

-- ------------------------------------------------------------------ hull profiles
local SPEC = {
  rowboat = {
    free = 3,
    profile = { { 7, 0 }, { 6, 1 }, { 5, 2 }, { 2, 3 }, { -2, 3 }, { -5, 2 }, { -7, 2 } },
    smashed = { { 5, 1.6 }, { 2, 3 }, { -2, 3 }, { -5, 2 }, { -5.6, 1.2 } },
  },
  work_skiff = {
    free = 3,
    profile = { { 7, 0 }, { 6, 1 }, { 5, 3 }, { 2, 4 }, { -3, 4 }, { -6, 3 }, { -7, 3 } },
    smashed = { { 4, 2.2 }, { 2, 4 }, { -3, 4 }, { -6, 3 }, { -5.6, 2 } },
  },
  cargo_barge = {
    free = 2,
    profile = { { 13, 1 }, { 12, 3 }, { 10, 5 }, { 7, 7 }, { -5, 7 }, { -10, 6 }, { -13, 5 } },
    smashed = { { 10, 4 }, { 7, 7 }, { -5, 7 }, { -10, 6 }, { -11.4, 4 } },
  },
  coastal_sailboat = {
    free = 3,
    profile = { { 15, 0 }, { 14, 1 }, { 12, 3 }, { 9, 5 }, { 4, 6 }, { -6, 6 }, { -12, 5 }, { -15, 4 } },
    smashed = { { 11, 3 }, { 9, 5 }, { 4, 6 }, { -6, 6 }, { -12, 5 }, { -13.4, 3 } },
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

-- Inset plan (gunwale thickness); ends pulled in so the bow does not become a spike.
local function inset(profile, d)
  local out = {}
  for _, p in ipairs(profile) do
    local u, hw = p[1], math.max(0, p[2] - d)
    if u > 0 then u = u - d elseif u < 0 then u = u + d end
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

-- Vertical hull planking. opt.hole = {uLo, uHi} removes visible planking there (damage) so the
-- bilge shows through instead of a recolour.
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
        -- broadside strake: give it a 1-unit shadow line along the waterline for depth
        quad(L, c, f, { { a[1], a[2], free }, { b[1], b[2], free }, { b[1], b[2], 1 }, { a[1], a[2], 1 } }, col)
        quad(L, c, f, { { a[1], a[2], 1 }, { b[1], b[2], 1 }, { b[1], b[2], 0 }, { a[1], a[2], 0 } }, R[1])
      else
        quad(L, c, f, { { a[1], a[2], free }, { b[1], b[2], free }, { b[1], b[2], 0 }, { a[1], a[2], 0 } }, col)
      end
    end
  end
end

-- Small box in boat space: visible sides + top. Thwarts, crates, masts, cabins, barrels, tubs.
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

-- 1 px line in the boat frame (rigging, deck lashings, ropes). The step count follows the
-- steepest axis so consecutive dots stay connected: a 1 px line that steps 2-3 px in z per u step
-- would break into detached specks and read as a floating rope.
local function thinLine(L, c, f, u0, v0, z0, u1, v1, z1, col)
  local n = math.max(1, math.floor(math.abs(u1 - u0) + math.abs(v1 - v0)),
    math.floor(math.abs(z1 - z0)))
  for k = 0, n do
    local t = k / n
    local p = Wp(f, u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, math.floor(z0 + (z1 - z0) * t + 0.5))
    L.dot(c, p[1], p[2], p[3], col)
  end
end

-- Plank seams along u on a deck.
local function deckSeams(L, c, f, profile, vs, z, col)
  local lo = profile[#profile][1]
  for _, v in ipairs(vs) do
    quad(L, c, f, { { -lo, v, z }, { lo, v, z }, { lo, v + 1, z }, { -lo, v + 1, z } }, col)
  end
end

-- Lit outer gunwale edge along the camera-near side.
local function rimHighlight(L, c, f, profile, z, col)
  for k = 1, #profile - 1 do
    local a, b = profile[k], profile[k + 1]
    local ni, nj = edgeNormal(f, { a[1], a[2] }, { b[1], b[2] })
    if ni + nj > 0 then
      quad(L, c, f, { { a[1], a[2] - 1, z }, { b[1], b[2] - 1, z }, { b[1], b[2], z }, { a[1], a[2], z } }, col)
    end
  end
end

-- Hull + gunwale + interior + bilge. Returns nothing; opt.hole punches damaged planking.
local function hullBody(L, c, f, sp, theme, s, opt)
  local R = L.C.WOOD
  local free = sp.free
  local prof = (opt.smashed and sp.smashed) or sp.profile
  hullSide(L, c.building, f, outline(prof), free, R, opt)
  planPoly(L, c.building, f, prof, free, R[4])                      -- gunwale ring (far side reads here)
  planPoly(L, c.building, f, inset(prof, 1), free, opt.deck1 or R[2])   -- inner gunwale / strake
  planPoly(L, c.building, f, inset(prof, 2), free, opt.deck2 or R[1])   -- interior floor / deck
  rimHighlight(L, c.building, f, prof, free, R[5])                  -- lit near gunwale
  if opt.notch then
    local a, b = opt.notch[1], opt.notch[2]
    quad(L, c.building, f, { { a, 1.4, free + 0.5 }, { b, 1.4, free + 0.5 },
      { b, 5, free + 0.5 }, { a, 5, free + 0.5 } }, L.hex('#00000000'))
  end
end

-- Shipped oars: shafts lie on the gunwale, blades project past the transom. Because the blades
-- stand proud of the hull, the damaged state can genuinely remove them.
local function shippedOars(L, c, f, free, vs, snapIdx, sternU)
  local R = L.C.WOOD
  for k, v in ipairs(vs) do
    local snapped = (k == snapIdx)
    local shaftEnd = snapped and (sternU + 4.4) or (sternU + 0.6)
    quad(L, c.building, f, { { 4, v, free + 2 }, { shaftEnd, v, free + 2 },
      { shaftEnd, v + 1, free + 2 }, { 4, v + 1, free + 2 } }, R[3])
    if snapped then
      quad(L, c.building, f, { { shaftEnd - 0.4, v - 0.5, free + 2.4 }, { shaftEnd + 1.2, v, free + 2.4 },
        { shaftEnd + 1.2, v + 1, free + 2.4 }, { shaftEnd - 0.4, v + 0.6, free + 2.4 } }, R[2])
    else
      quad(L, c.building, f, { { shaftEnd, v - 0.5, free + 2.4 }, { sternU - 1.4, v + 0.2, free + 2.4 },
        { sternU - 1.4, v + 1.8, free + 2.4 }, { shaftEnd, v + 1.6, free + 2.4 } }, R[4])
    end
  end
end

-- ------------------------------------------------------------------ rowboat
local function rowboat(L, c, f, sp, theme, s)
  local R = L.C.WOOD
  local free = sp.free
  local st = s.visualState
  hullBody(L, c, f, sp, theme, s, { hole = (st == 'damaged') and { -1.5, 1.5 } or nil,
      notch = (st == 'damaged') and { -0.6, 1.4 } or nil,
      smashed = (st == 'damaged') or nil })

  -- two thwarts; the damaged boat has lost the forward one and splintered its stump
  for k, b in ipairs({ { 2, 2.4 }, { -3, 2.2 } }) do
    local broken = (st == 'damaged') and k == 1
    prism(L, c.building, f, b[1], -b[2], b[1] + 2, broken and 0.2 or b[2], free + 1, free + 2, R, R[4])
  end
  if st == 'damaged' then
    quad(L, c.building, f, { { 4, 0.4, free + 2 }, { 5, 1, free + 1.2 }, { 5, 2.2, free + 1.2 },
      { 4, 2.2, free + 2 } }, R[2])
  end
  -- oarlocks, then oars shipped aft; the damaged boat is missing the starboard oar blade
  for _, v in ipairs({ -2.6, 2.6 }) do
    prism(L, c.building, f, 3, v - 0.5, 3.6, v + 0.5, free + 1, free + 3, R, R[5])
  end
  shippedOars(L, c, f, free, { -2.6, 2.6 }, (st == 'damaged') and 2 or nil, -7)
  -- bow painter over the stem reads which end is forward
  thinLine(L, c.building, f, 7, 0, free + 1, 6, 0, 0, R[3])
  -- painted plank / tarred seam is the whole biome cue at this size: pigment on the hull, not
  -- an extra silhouette blob above the boat
  local pigment = theme.roof[4]
  dotUV(L, c.building, f, -2.5, 3, free - 1, pigment)
  dotUV(L, c.building, f, -1.5, 3, free - 1, pigment)
  dotUV(L, c.building, f, -0.5, 3, free - 1, pigment)

  if st == 'loaded' then
    prism(L, c.details, f, -1.6, -1.8, 1.2, 0.4, free + 1, free + 4, L.C.ADOBE, L.C.ADOBE[4])
    prism(L, c.details, f, -1.2, 0.6, 0.6, 2, free + 1, free + 3.4, L.C.ADOBE, L.C.ADOBE[5])
    prism(L, c.details, f, 1.4, -0.8, 2.6, 0.6, free + 1, free + 2.6, R, R[3])
  end
end

-- ------------------------------------------------------------------ work skiff
local function workSkiff(L, c, f, sp, theme, s)
  local R = L.C.WOOD
  local free = sp.free
  local st = s.visualState
  hullBody(L, c, f, sp, theme, s,
    { hole = (st == 'damaged') and { -4.5, -1.5 } or nil,
      notch = (st == 'damaged') and { -3.6, -1.6 } or nil, smashed = (st == 'damaged') or nil,
      deck1 = theme.roof[3], deck2 = R[3] })
  -- painted sheer strake just inside the gunwale is the biome trim; planked deck inside it
  deckSeams(L, c.building, f, sp.profile, { -1, 1 }, free, R[2])
  if st == 'damaged' then
    quad(L, c.building, f, { { -4.5, 3.4, free - 0.4 }, { -1.5, 3.4, free - 0.4 },
      { -1.5, 2.4, free - 1.6 }, { -4.5, 2.4, free - 1.6 } }, R[2])
    prism(L, c.building, f, -5.4, -0.8, -4, 0.8, free - 1, free, R, R[2])   -- sprung frame head
  end
  -- bailer, rope coil, gaff pole
  prism(L, c.details, f, 3.2, -2.8, 4.8, -1.2, free, free + 2, R, R[5])
  dotUV(L, c.details, f, 4, -2, free + 2, R[1])
  thinLine(L, c.building, f, -3, -3.2, free + 1, -1.2, -3.2, free + 1, R[4])
  thinLine(L, c.building, f, -1.2, -3.2, free + 1, -1.2, -1.4, free + 1, R[4])
  thinLine(L, c.building, f, -1.2, -1.4, free + 1, -3, -1.4, free + 1, R[4])
  thinLine(L, c.building, f, -3, -1.4, free + 1, -3, -3.2, free + 1, R[4])
  -- gaff pole along the starboard sheer; it is snapped in the damaged state
  local poleEnd = (st == 'damaged') and 1.6 or 8.4
  quad(L, c.building, f, { { -5.4, 2.6, free + 1 }, { poleEnd, 2.6, free + 1 },
    { poleEnd, 3, free + 1 }, { -5.4, 3, free + 1 } }, R[4])
  shippedOars(L, c, f, free, { -3.2, 3.2 }, (st == 'damaged') and 1 or nil, -7)
  thinLine(L, c.building, f, 7, 0, free, 7.6, 0, 1, R[4])
  if st == 'loaded' then
    prism(L, c.details, f, -3, -2.4, -0.4, 0.4, free + 1, free + 5, R, R[3])
    prism(L, c.details, f, -3, 0.8, -1, 2.8, free + 1, free + 4, R, R[4])
    prism(L, c.details, f, -0.8, -1.2, 1.2, 0.8, free + 1, free + 4, L.C.ADOBE, L.C.ADOBE[4])
    thinLine(L, c.details, f, -3.4, 0, free + 3.4, 1.6, 0, free + 3.4, R[2])
  end
  if st ~= 'damaged' then
    if theme.biome == 'tropical' then
      dotUV(L, c.details, f, -6.4, 2.2, free + 1, theme.leaf[4])
      dotUV(L, c.details, f, -5.8, 2.6, free + 1, theme.leaf[5])
    elseif theme.biome == 'northern' then
      prism(L, c.details, f, -6.4, 1.4, -4.6, 2.4, free + 1, free + 2, L.C.WHITE, L.C.WHITE[4])
    end
  end
end

-- ------------------------------------------------------------------ cargo barge
local function cargoBarge(L, c, f, sp, theme, s)
  local R = L.C.WOOD
  local free = sp.free
  local prof = sp.profile
  local st = s.visualState
  hullBody(L, c, f, sp, theme, s,
    { hole = (st == 'damaged') and { -10, -8 } or nil,
      notch = (st == 'damaged') and { -9.4, -6.6 } or nil, smashed = (st == 'damaged') or nil,
      deck1 = theme.roof[3], deck2 = R[3] })
  -- low painted bulwark over a planked working deck
  deckSeams(L, c.building, f, prof, { -4, -1, 2, 5 }, free, R[2])
  -- rope lashings marking the cargo bay
  for _, u in ipairs({ -6, 0, 6 }) do
    thinLine(L, c.building, f, u, -6, free + 2, u, 6, free + 2, R[4])
  end
  -- blunt stern transom, raked stem post: both follow the surviving hull ends
  local bowU = (st == 'damaged') and 10 or 13
  local sternU = (st == 'damaged') and -11.4 or -13
  prism(L, c.building, f, sternU - 0.4, -1.4, sternU + 1, 1.4, 0, free + 2, R, R[3])
  prism(L, c.building, f, bowU - 1.4, -1.2, bowU, 1.2, 0, free + 3, R, R[4])
  -- steerage sweep over the transom: hand-worked, no engine
  prism(L, c.building, f, sternU - 0.2, -0.8, sternU + 1.4, 0.8, 0, 3, R, R[2])
  if st == 'damaged' then
    quad(L, c.building, f, { { -14.2, -0.6, 3.2 }, { -12.6, -0.6, 4.2 }, { -12.6, 0.7, 4.2 },
      { -14.2, 0.7, 3.2 } }, R[3])                                    -- snapped sweep shaft
    quad(L, c.building, f, { { -15.4, -1.6, 2.8 }, { -14, -1.2, 3.2 }, { -14, 0.4, 3.2 },
      { -15.4, 0.4, 2.8 } }, R[4])
  else
    quad(L, c.building, f, { { -14.6, -0.6, 3 }, { -11, -0.6, 5.2 }, { -11, 0.7, 5.2 },
      { -14.6, 0.7, 3 } }, R[3])
    quad(L, c.building, f, { { -15.4, -1.6, 2.6 }, { -13.6, -1.2, 3 }, { -13.6, 0.4, 3 },
      { -15.4, 0.4, 2.6 } }, R[4])
  end

  -- tilt over the aft cargo bay: biome material and biome height
  local tiltH = (theme.biome == 'arid') and 3 or 4
  local roof = theme.roof
  local tiltA, tiltB = -13, -5
  if st == 'damaged' then tiltB = -10.5 end                   -- the aft half is ripped away
  for k = 0, 1 do
    local u0, u1 = tiltA + k * (tiltB - tiltA) / 2, tiltA + (k + 1) * (tiltB - tiltA) / 2
    quad(L, c.details, f, { { u0, -5, free + 1 }, { u1, -5, free + 1 },
      { u1, 0, free + 1 + tiltH }, { u0, 0, free + 1 + tiltH } }, roof[3])
    quad(L, c.details, f, { { u0, 0, free + 1 + tiltH }, { u1, 0, free + 1 + tiltH },
      { u1, 5, free + 1 }, { u0, 5, free + 1 } }, roof[2])
  end
  thinLine(L, c.details, f, tiltA, -5, free + 2, tiltB, -5, free + 2, roof[5])
  thinLine(L, c.details, f, tiltA, 5, free + 2, tiltB, 5, free + 2, roof[1])

  if st == 'loaded' then
    prism(L, c.details, f, 1, -4.6, 5.4, -0.6, free + 1, free + 5, R, R[4])
    prism(L, c.details, f, 1.6, -4, 4.8, -1.2, free + 5, free + 6, R, R[5])
    prism(L, c.details, f, 6.4, -3.4, 9.4, -0.4, free + 1, free + 3, L.C.ADOBE, L.C.ADOBE[4])
    prism(L, c.details, f, 6.8, 0.2, 9.8, 3, free + 1, free + 3, L.C.ADOBE, L.C.ADOBE[5])
    prism(L, c.details, f, 1, 0.6, 4.6, 4.2, free + 1, free + 3, R, R[3])
    prism(L, c.details, f, 10.4, -2, 12.6, 2, free + 1, free + 4, R, R[4])
    thinLine(L, c.details, f, 0.6, -4.8, free + 5.4, 10.8, 4.4, free + 3.6, R[2])
    thinLine(L, c.details, f, 0.6, 4.4, free + 4.6, 10.8, -4.8, free + 3.2, R[2])
  end
  if st ~= 'damaged' then
    local b = theme.biome
    if b == 'tropical' then
      dotUV(L, c.details, f, 12, 4, free + 1, theme.leaf[4])
      dotUV(L, c.details, f, 12.8, 4.4, free + 2, theme.leaf[5])
      dotUV(L, c.details, f, 11.4, 4.6, free + 1, theme.leaf[3])
    elseif b == 'arid' then
      prism(L, c.details, f, 10.6, 3, 13, 4.4, free + 1, free + 2, theme.roof, theme.roof[4])
    elseif b == 'northern' then
      prism(L, c.details, f, 10.6, 3, 13, 4.4, free + 1, free + 3, L.C.WHITE, L.C.WHITE[4])
    end
  end
end

-- ------------------------------------------------------------------ coastal sailboat
local function coastalSailboat(L, c, f, sp, theme, s)
  local R = L.C.WOOD
  local free = sp.free
  local prof = sp.profile
  local st = s.visualState
  local mastU, mastTop = 2, 50
  hullBody(L, c, f, sp, theme, s,
    { hole = (st == 'damaged') and { -9.5, -8.5 } or nil,
      notch = (st == 'damaged') and { -8.6, -5.4 } or nil, smashed = (st == 'damaged') or nil,
      deck1 = theme.roof[3], deck2 = R[3] })
  deckSeams(L, c.building, f, prof, { -3, 0, 3 }, free, R[2])

  -- small cabin aft of the mast
  prism(L, c.building, f, -7, -3, -2, 3, free + 1, free + 5, R, R[4])
  quad(L, c.building, f, { { -7.6, -3.6, free + 6 }, { -1.4, -3.6, free + 6 },
    { -1.4, 3.6, free + 6 }, { -7.6, 3.6, free + 6 } }, theme.roof[3])
  quad(L, c.building, f, { { -7.6, 3.6, free + 6 }, { -1.4, 3.6, free + 6 },
    { -1.4, 3.6, free + 5 }, { -7.6, 3.6, free + 5 } }, theme.roof[2])
  dotUV(L, c.building, f, -5, 3.6, free + 4, L.C.GLASS[3])
  dotUV(L, c.building, f, -4, 3.6, free + 4, L.C.GLASS[3])

  -- mast, standing rigging, pennant, lateen sail
  prism(L, c.building, f, mastU, -1, mastU + 2, 1, free + 1, mastTop, R, R[5])
  thinLine(L, c.building, f, mastU + 1, 0, mastTop - 1, 14.6, 0, free + 2, R[2])
  thinLine(L, c.building, f, mastU + 1, 0, mastTop - 1, -14, 0, free + 7, R[2])
  quad(L, c.building, f, { { mastU + 1, -0.4, mastTop }, { mastU - 3.6, -0.4, mastTop - 3 },
    { mastU - 3.6, 0.4, mastTop - 3 }, { mastU + 1, 0.4, mastTop } }, theme.roof[4])

  local sail = (f.vx == 0) and L.C.WHITE[4] or L.C.WHITE[3]
  local seam = (f.vx == 0) and L.C.WHITE[2] or L.C.WHITE[5]
  -- Lateen rig: luff on the mast, foot aft along the boom, long leech up to the masthead, and a
  -- yard outside the leech. A triangle reads as a sail; a parallelogram reads as a box.
  if st == 'damaged' then
    -- torn away above the reef: the upper leech is gone and the yard hangs bare
    quad(L, c.building, f, { { mastU, 0, 25 }, { -3.6, 0, 20 }, { -10, 0, 13 }, { mastU, 0, 11 } }, sail)
    quad(L, c.building, f, { { mastU, 0, 25 }, { -3.6, 0, 20 }, { -4.4, 0, 16 }, { mastU, 0, 13 } }, seam)
    thinLine(L, c.building, f, mastU + 0.4, 0, 45, -10.6, 0, 13.4, R[3])      -- bare yard
    quad(L, c.building, f, { { -6.4, -0.3, 17 }, { -4.6, -0.3, 16.4 }, { -4.6, -0.3, 14.2 },
      { -6.4, -0.3, 15 } }, L.C.WHITE[5])                                    -- patch
  else
    quad(L, c.building, f, { { mastU, 0, 44 }, { -10, 0, 13 }, { mastU, 0, 11 } }, sail)
    quad(L, c.building, f, { { mastU, 0, 44 }, { -5.6, 0, 22 }, { mastU, 0, 11 } }, seam)
    thinLine(L, c.building, f, mastU + 0.4, 0, 45, -10.6, 0, 13.4, R[3])      -- yard
    thinLine(L, c.building, f, -10.6, 0, 13.4, -11, 0, 11, R[2])             -- clew lashing
  end
  -- rudder head and tiller, hung on the surviving stern
  local sternU = (st == 'damaged') and -13.4 or -15.2
  prism(L, c.building, f, sternU, -1, sternU + 1.4, 1, 0, free + 2, R, R[3])
  quad(L, c.building, f, { { sternU + 1.2, -0.6, free + 2 }, { sternU + 4, -0.6, free + 3.4 },
    { sternU + 4, 0.6, free + 3.4 }, { sternU + 1.2, 0.6, free + 2 } }, R[3])

  if st == 'loaded' then
    prism(L, c.details, f, 4.6, -3.4, 8, 0.2, free + 1, free + 5, R, R[4])
    prism(L, c.details, f, 4.6, 1, 7.4, 4.2, free + 1, free + 4, L.C.ADOBE, L.C.ADOBE[4])
    prism(L, c.details, f, 9.6, -2.4, 11.6, 0.4, free + 1, free + 4, R, R[3])
    thinLine(L, c.details, f, 4.2, 0, free + 3.6, 11.4, 0, free + 3.4, R[2])
  end
  if st ~= 'damaged' then
    local b = theme.biome
    if b == 'tropical' then
      dotUV(L, c.details, f, 12.4, 3.4, free + 1, theme.leaf[4])
      dotUV(L, c.details, f, 13, 3.8, free + 2, theme.leaf[5])
    elseif b == 'arid' then
      prism(L, c.details, f, 11, 2.4, 13.4, 3.8, free + 1, free + 2, theme.roof, theme.roof[4])
    elseif b == 'northern' then
      prism(L, c.details, f, 11, 2.4, 13.4, 3.8, free + 1, free + 3, L.C.WHITE, L.C.WHITE[4])
    end
  end
end

-- ------------------------------------------------------------------ dispatch
local DRAW = {
  rowboat = rowboat,
  work_skiff = workSkiff,
  cargo_barge = cargoBarge,
  coastal_sailboat = coastalSailboat,
}

function F.draw(L, B, c, theme, s)
  local sp = assert(SPEC[s.kind], 'unknown boat kind ' .. tostring(s.kind))
  local f = frame(s.orientation, s.A, s.B)
  planPoly(L, c.shadow, f, sp.profile, 0, L.SHADOW, 1)
  DRAW[s.kind](L, c, f, sp, theme, s)
end

return F
