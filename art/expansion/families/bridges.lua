-- art/expansion/families/bridges.lua
-- Finished modular bridges: timber_footbridge, timber_wagon, stone_arch, stone_viaduct.
--
-- Local frame:  t = 0..32 along the crossing axis, w = 0..16 across it, z = 0..(up), waterline z=0,
-- walking surface z=6 for timber, z=10 for stone.  Axis 'i' maps (i,j)=(t,w); axis 'j' maps (i,j)=(w,t).  Both axes are drawn
-- and lit separately (+j faces use ramp[3] lit/base, +i faces use ramp[2] shade/right).
--
-- Piece order along a crossing:   far_bank | span ... | near_bank
-- near_bank keeps its land/stair end at t=32 (the camera-near end of the sprite);
-- far_bank mirrors it to t=0 (the camera-far end).  Every piece keeps the deck cross-section
-- identical at t=0 and t=32 so consecutive modules meet exactly.
--
-- States: intact / construction (open structure, falsework, stored material, no usable deck
-- illusion) / damaged (missing deck boards, broken rails, cracked masonry) / rebuilding (finished
-- deck again, but with local scaffold, props, tarps and fresh repair material).

local F = {}
local LEN, WID, DZ = 32, 16, 6

----------------------------------------------------------------- frame helpers
local function axmap(ax, t, w)
  if ax == 'i' then return t, w end
  return w, t
end

local function P(L, c, ax, t, w, z)
  local i, j = axmap(ax, t, w)
  return L.P(c, i, j, z)
end

local function Q(L, c, ax, pts, col)
  local s = {}
  for k = 1, #pts do s[k] = P(L, c, ax, pts[k][1], pts[k][2], pts[k][3]) end
  return L.poly(c, s, col)
end

-- Even-sized world box in the local frame (library box needs even planar values).
local function BX(L, c, ax, t0, w0, t1, w1, z0, H, ramp, opt)
  local i0, j0 = axmap(ax, t0, w0)
  local A = (ax == 'i') and (t1 - t0) or (w1 - w0)
  local B = (ax == 'i') and (w1 - w0) or (t1 - t0)
  return L.box(c, i0, j0, z0, A, B, H, ramp, opt)
end

local function topF(L, c, ax, t0, w0, t1, w1, z, col)
  return Q(L, c, ax, {{t0, w0, z}, {t1, w0, z}, {t1, w1, z}, {t0, w1, z}}, col)
end

local function nearF(L, c, ax, t0, t1, w, z0, z1, col)
  return Q(L, c, ax, {{t0, w, z0}, {t1, w, z0}, {t1, w, z1}, {t0, w, z1}}, col)
end

local function endF(L, c, ax, t, w0, w1, z0, z1, col)
  return Q(L, c, ax, {{t, w0, z0}, {t, w1, z0}, {t, w1, z1}, {t, w0, z1}}, col)
end

local function pixW(L, c, ax, t, w, z, col)
  local p = P(L, c, ax, t, w, z)
  L.px(c, p[1], p[2], col)
end

-- 1px pixel line inside one constant-w plane (rails ends, braces, cracks, ropes).
local function diagW(L, c, ax, t0, w, z0, t1, z1, col)
  local n = math.abs(t1 - t0)
  if n == 0 then
    pixW(L, c, ax, t0, w, z0, col)
    return
  end
  local st = (t1 > t0) and 1 or -1
  for k = 0, n do
    pixW(L, c, ax, t0 + st * k, w, math.floor(z0 + (z1 - z0) * k / n + 0.5), col)
  end
end

local function nR(ax, r) return (ax == 'i') and r[3] or r[2] end   -- lit / +j face
local function eR(ax, r) return (ax == 'i') and r[2] or r[3] end   -- shaded / +i face end

----------------------------------------------------------------- surface texture
local function courses(L, c, mask, ax, period, col, phase)
  L.stripe(c, mask, (ax == 'i') and 'dr' or 'ur', period, col, phase or 0)
end

local function cavity(L, x, y, w, h)
  return { x, y, w, h }
end

----------------------------------------------------------------- shared deck slab
-- Deck slab: top face + near (+w) side face + high (+t) end face. Shared by spans and banks so the
-- cross-section is identical at every seam.
local function deckSlab(L, ctx, ax, t0, t1, w0, w1, z0, H, ramp)
  local top = topF(L, ctx, ax, t0, w0, t1, w1, z0 + H, ramp[4])
  nearF(L, ctx, ax, t0, t1, w1, z0, z0 + H, nR(ax, ramp))
  endF(L, ctx, ax, t1, w0, w1, z0, z0 + H, eR(ax, ramp))
  L.edge(ctx, top, 'bottom', ramp[5])
  return top
end

-- Plank seams across a timber deck (planks run along w, joints at constant t).
local function plankSeams(L, ctx, ax, t0, t1, w0, w1, z, period, col)
  if t0 > t1 then t0, t1 = t1, t0 end
  for t = t0 + period, t1 - 2, period do
    Q(L, ctx, ax, {{t, w0, z}, {t + 1, w0, z}, {t + 1, w1, z}, {t, w1, z}}, col)
  end
end

-- Long boards running along t (seams at constant w).
local function boardSeams(L, ctx, ax, t0, t1, ws, z, col)
  for _, w in ipairs(ws) do
    Q(L, ctx, ax, {{t0, w, z}, {t1, w, z}, {t1, w + 1, z}, {t0, w + 1, z}}, col)
  end
end

----------------------------------------------------------------- rails
-- Solid rail run (wagon / stone parapets): top, near face and optional visible end face.
local function railRun(L, ctx, ax, t0, t1, w0, w1, z0, z1, ramp, endFace)
  local top = topF(L, ctx, ax, t0, w0, t1, w1, z1, ramp[4])
  nearF(L, ctx, ax, t0, t1, w1, z0, z1, nR(ax, ramp))
  if endFace then endF(L, ctx, ax, t1, w0, w1, z0, z1, eR(ax, ramp)) end
  L.edge(ctx, top, 'bottom', ramp[5])
  return top
end

-- Sagging rope rail: a continuous 1px 2:1 line that dips one pixel mid-span.
local function ropeRun(L, ctx, ax, t0, t1, w, z, col, sag)
  if t0 > t1 then t0, t1 = t1, t0 end
  for t = t0, t1 - 1 do
    local drop = (sag and ((t + 4) % 6 == 3)) and 1 or 0
    pixW(L, ctx, ax, t, w, z - drop, col)
  end
end

local function postRun(L, ctx, ax, ts, w0, w1, z0, z1, ramp)
  for _, t in ipairs(ts) do
    BX(L, ctx, ax, t, w0, t + 2, w1, z0, z1 - z0, ramp, { base = true })
  end
end

----------------------------------------------------------------- biome touches
-- Two or three deliberate pixels so a biome is not only a palette swap.
local function biomeTouch(L, ctx, ax, theme, t, w, z, seed)
  local b = theme.biome
  if b == 'tropical' then
    pixW(L, ctx, ax, t, w, z, theme.leaf[4])
    pixW(L, ctx, ax, t + 1, w, z + 1, theme.leaf[3])
    pixW(L, ctx, ax, t + 2, w, z, theme.leaf[5])
  elseif b == 'arid' then
    pixW(L, ctx, ax, t, w, z, theme.sand[4])
    pixW(L, ctx, ax, t + 2, w, z, theme.sand[3])
    pixW(L, ctx, ax, t + 4, w, z + 1, theme.sand[2])
  elseif b == 'northern' then
    pixW(L, ctx, ax, t, w, z, theme.wall[5])
    pixW(L, ctx, ax, t + 1, w, z, theme.wall[5])
    pixW(L, ctx, ax, t + 2, w, z, theme.wall[4])
  else
    pixW(L, ctx, ax, t, w, z, L.FLOWERS[1])
    pixW(L, ctx, ax, t + 2, w, z, theme.leaf[5])
    pixW(L, ctx, ax, t + 3, w, z + 1, theme.leaf[3])
  end
end

----------------------------------------------------------------- timber footbridge
local FOOT = {
  ramp = 'WOOD', underZ = 5, deckZ0 = 5, dw0 = 2, dw1 = 14,
  farRail = {2, 4}, nearRail = {12, 14}, posts = {2, 8, 14, 20, 26}, railZ = 9,
}

local function footRails(L, c, ax, W, t0, t1, state)
  local farW, nearW = FOOT.farRail, FOOT.nearRail
  if state == 'intact' or state == 'rebuilding' then
    postRun(L, c.props_back, ax, FOOT.posts, farW[1], farW[2], DZ, FOOT.railZ, W)
    ropeRun(L, c.props_back, ax, t0, t1, farW[2] - 1, FOOT.railZ - 1, W[4], true)
    postRun(L, c.details, ax, FOOT.posts, nearW[1], nearW[2], DZ, FOOT.railZ, W)
    ropeRun(L, c.details, ax, t0, t1, nearW[1] + 1, FOOT.railZ - 1, W[4], true)
  elseif state == 'construction' then
    -- only the two temporary posts holding the working line
    postRun(L, c.props_back, ax, {10}, farW[1], farW[2], DZ, FOOT.railZ + 1, W)
    postRun(L, c.details, ax, {20}, nearW[1], nearW[2], DZ, FOOT.railZ + 1, W)
    diagW(L, c.details, ax, 20, nearW[2], DZ + 1, 22, FOOT.railZ, W[4])
  else -- damaged
    postRun(L, c.props_back, ax, {2, 14, 20, 26}, farW[1], farW[2], DZ, FOOT.railZ, W)
    ropeRun(L, c.props_back, ax, t0, 12, farW[2] - 1, FOOT.railZ - 1, W[4], false)
    -- snapped post: one short stub plus a piece lying on the deck
    BX(L, c.details, ax, 8, nearW[1], 10, nearW[2], DZ, 1, W, { base = true })
    Q(L, c.details, ax, {{11, nearW[1], 7}, {14, nearW[1] + 2, 7}, {14, nearW[1] + 2, 8}, {11, nearW[1], 8}}, W[3])
    postRun(L, c.details, ax, {2, 20, 26}, nearW[1], nearW[2], DZ, FOOT.railZ, W)
    ropeRun(L, c.details, ax, 14, t1, nearW[1], FOOT.railZ - 1, W[4], true)
    diagW(L, c.details, ax, 14, nearW[1], FOOT.railZ - 1, 15, FOOT.railZ - 3, W[2])
  end
end

local function spanFoot(L, c, ax, theme, s)
  local W = L.C.WOOD
  local st = s.visualState
  local b = c.building
  -- sub-structure: two stringers and two cross beams; water stays visible between them
  BX(L, b, ax, 0, 2, LEN, 4, 3, 2, W, { base = true })
  BX(L, b, ax, 0, 12, LEN, 14, 3, 2, W, { base = true })
  BX(L, b, ax, 2, 2, 4, 14, 4, 1, W, {})
  BX(L, b, ax, 28, 2, 30, 14, 4, 1, W, {})

  if st == 'construction' then
    -- half-laid decking: far boards only, plus open stringers on the near half
    local top = deckSlab(L, b, ax, 0, LEN, FOOT.dw0, 10, FOOT.deckZ0, 1, W)
    plankSeams(L, b, ax, 0, LEN, FOOT.dw0, 10, DZ, 4, W[3])
    L.edge(b, top, 'left', W[5])
    -- loose boards stacked at the working end
    BX(L, b, ax, 22, 2, 28, 8, DZ, 1, W, { base = true })
    BX(L, b, ax, 22, 2, 28, 8, DZ + 1, 1, W, { base = true })
    BX(L, b, ax, 26, 10, 30, 14, DZ, 2, W, { base = true })
    -- falsework props under the open half
    BX(L, b, ax, 8, 2, 10, 4, 0, 5, W, { base = true })
    BX(L, b, ax, 18, 10, 20, 12, 0, 5, W, { base = true })
  elseif st == 'damaged' then
    -- a two-board hole: stringers and water show through
    local t1 = deckSlab(L, b, ax, 0, 12, FOOT.dw0, FOOT.dw1, FOOT.deckZ0, 1, W)
    local t2 = deckSlab(L, b, ax, 18, LEN, FOOT.dw0, FOOT.dw1, FOOT.deckZ0, 1, W)
    plankSeams(L, b, ax, 0, 12, FOOT.dw0, FOOT.dw1, DZ, 4, W[3])
    plankSeams(L, b, ax, 18, LEN, FOOT.dw0, FOOT.dw1, DZ, 4, W[3])
    -- splintered board tips at both broken edges
    Q(L, b, ax, {{12, FOOT.dw0, DZ}, {14, 5, DZ + 1}, {14, 9, DZ + 1}, {12, FOOT.dw1, DZ}}, W[2])
    Q(L, b, ax, {{18, FOOT.dw1, DZ}, {16, 11, DZ + 1}, {16, 7, DZ + 1}, {18, FOOT.dw0, DZ}}, W[2])
    L.edge(b, t1, 'left', W[5])
    L.edge(b, t2, 'right', W[5])
  elseif st == 'rebuilding' then
    local top = deckSlab(L, b, ax, 0, LEN, FOOT.dw0, FOOT.dw1, FOOT.deckZ0, 1, W)
    plankSeams(L, b, ax, 0, LEN, FOOT.dw0, FOOT.dw1, DZ, 4, W[3])
    -- fresh patch boards, cut and laid across the older deck
    for k = 0, 1 do
      Q(L, b, ax, {{12, 5 + 2 * k, DZ}, {18, 5 + 2 * k, DZ}, {18, 7 + 2 * k, DZ}, {12, 7 + 2 * k, DZ}}, W[5])
    end
    L.edge(b, top, 'bottom', W[5])
    -- trestle scaffolding straddling the new patch
    BX(L, c.details, ax, 12, 12, 14, 16, DZ, 4, W, { base = true })
    BX(L, c.details, ax, 16, 12, 18, 16, DZ, 4, W, { base = true })
    BX(L, c.details, ax, 10, 12, 20, 16, DZ + 3, 1, W, { base = true })
    -- canvas tarp tied over the rail
    Q(L, c.details, ax, {{4, 14, 9}, {10, 14, 8}, {11, 14, 5}, {5, 14, 6}}, L.C.WHITE[3])
    Q(L, c.details, ax, {{5, 15, 6}, {11, 15, 5}, {11, 15, 8}, {5, 15, 9}}, L.C.WHITE[2])
  else
    local top = deckSlab(L, b, ax, 0, LEN, FOOT.dw0, FOOT.dw1, FOOT.deckZ0, 1, W)
    plankSeams(L, b, ax, 0, LEN, FOOT.dw0, FOOT.dw1, DZ, 4, W[3])
    L.edge(b, top, 'bottom', W[5])
  end
  if st ~= 'construction' then footRails(L, c, ax, W, 0, LEN, st) end
  if st == 'construction' then footRails(L, c, ax, W, 0, LEN, st) end
  if st == 'intact' then biomeTouch(L, c.props_back, ax, theme, 24, FOOT.farRail[2] - 1, DZ + 4, s.seed) end
end

----------------------------------------------------------------- timber wagon bridge
local WAG = {
  ramp = 'WOOD', underZ = 4, deckZ0 = 4, dw0 = 0, dw1 = 16,
  farRail = {0, 2}, nearRail = {14, 16}, posts = {2, 10, 18, 26}, railZ = 10,
}

local function wagonRails(L, c, ax, W, state, t0, t1)
  local farW, nearW = WAG.farRail, WAG.nearRail
  local under = DZ + 1
  if state == 'intact' then
    postRun(L, c.props_back, ax, WAG.posts, farW[1], farW[2], under, WAG.railZ, W)
    railRun(L, c.props_back, ax, t0, t1, farW[1], farW[2], WAG.railZ - 1, WAG.railZ, W, false)
    railRun(L, c.props_back, ax, t0, t1, farW[1], farW[2], under + 1, under + 2, W, false)
    postRun(L, c.details, ax, WAG.posts, nearW[1], nearW[2], under, WAG.railZ, W)
    railRun(L, c.details, ax, t0, t1, nearW[1], nearW[2], WAG.railZ - 1, WAG.railZ, W, false)
    railRun(L, c.details, ax, t0, t1, nearW[1], nearW[2], under + 1, under + 2, W, false)
    for k = 0, 2 do
      local a = WAG.posts[k + 1] + 2
      diagW(L, c.details, ax, a, 15, under + 2, a + 6, WAG.railZ - 1, W[2])
    end
  elseif state == 'construction' then
    postRun(L, c.props_back, ax, {6}, farW[1], farW[2], under, WAG.railZ, W)
    postRun(L, c.details, ax, {24}, nearW[1], nearW[2], under, WAG.railZ, W)
    diagW(L, c.details, ax, 24, 16, under + 2, 26, WAG.railZ - 1, W[4])
  elseif state == 'damaged' then
    postRun(L, c.props_back, ax, {2, 18, 26}, farW[1], farW[2], under, WAG.railZ, W)
    railRun(L, c.props_back, ax, t0, 16, farW[1], farW[2], WAG.railZ - 1, WAG.railZ, W, true)
    postRun(L, c.details, ax, {2, 10, 26}, nearW[1], nearW[2], under, WAG.railZ, W)
    railRun(L, c.details, ax, t0, 4, nearW[1], nearW[2], WAG.railZ - 1, WAG.railZ, W, true)
    railRun(L, c.details, ax, 24, t1, nearW[1], nearW[2], WAG.railZ - 1, WAG.railZ, W, true)
    -- broken rail hanging from the mid post
    diagW(L, c.details, ax, 12, 16, WAG.railZ - 1, 17, WAG.railZ - 4, W[2])
    diagW(L, c.details, ax, 13, 16, WAG.railZ - 1, 18, WAG.railZ - 4, W[2])
  else -- rebuilding
    postRun(L, c.props_back, ax, WAG.posts, farW[1], farW[2], under, WAG.railZ, W)
    railRun(L, c.props_back, ax, t0, t1, farW[1], farW[2], WAG.railZ - 1, WAG.railZ, W, false)
    postRun(L, c.details, ax, {2, 10}, nearW[1], nearW[2], under, WAG.railZ, W)
    railRun(L, c.details, ax, t0, 12, nearW[1], nearW[2], WAG.railZ - 1, WAG.railZ, W, true)
    -- new rail section laid loose next to the opening
    Q(L, c.details, ax, {{14, 14, 9}, {24, 14, 9}, {24, 16, 9}, {14, 16, 9}}, W[4])
    Q(L, c.details, ax, {{14, 16, 8}, {24, 16, 8}, {24, 16, 9}, {14, 16, 9}}, W[3])
    -- prop under the loose rail
    BX(L, c.details, ax, 22, 12, 24, 16, under, 3, W, { base = true })
    Q(L, c.details, ax, {{18, 16, 10}, {24, 16, 9}, {24, 16, 6}, {18, 16, 7}}, L.C.WHITE[3])
  end
end

local function spanWagon(L, c, ax, theme, s)
  local W = L.C.WOOD
  local st = s.visualState
  local b = c.building
  -- heavy sub-structure
  BX(L, b, ax, 4, 0, 6, 16, 2, 2, W, { base = true })
  BX(L, b, ax, 14, 0, 16, 16, 2, 2, W, { base = true })
  BX(L, b, ax, 24, 0, 26, 16, 2, 2, W, { base = true })
  BX(L, b, ax, 0, 6, LEN, 10, 3, 1, W, { base = true })

  if st == 'construction' then
    -- far half boarded, near half open over the cross beams
    local top = deckSlab(L, b, ax, 0, 20, 0, 8, WAG.deckZ0, 2, W)
    boardSeams(L, b, ax, 0, 20, {2, 6}, DZ, W[3])
    L.edge(b, top, 'left', W[5])
    BX(L, b, ax, 4, 0, 12, 8, DZ, 1, W, { base = true })   -- stacked beams
    BX(L, b, ax, 6, 2, 10, 6, DZ + 1, 1, W, { base = true })
    BX(L, b, ax, 26, 2, 30, 14, DZ, 2, W, { base = true }) -- beam pile at the far working end
  elseif st == 'damaged' then
    local t1 = deckSlab(L, b, ax, 0, 14, 0, 16, WAG.deckZ0, 2, W)
    local t2 = deckSlab(L, b, ax, 22, LEN, 0, 16, WAG.deckZ0, 2, W)
    boardSeams(L, b, ax, 0, 14, {4, 8, 12}, DZ, W[3])
    boardSeams(L, b, ax, 22, LEN, {4, 8, 12}, DZ, W[3])
    -- torn boards hanging into the gap
    Q(L, b, ax, {{14, 0, DZ}, {18, 4, DZ - 2}, {18, 10, DZ - 2}, {14, 16, DZ}}, W[2])
    Q(L, b, ax, {{22, 16, DZ}, {19, 12, DZ - 1}, {19, 6, DZ - 1}, {22, 0, DZ}}, W[3])
    L.edge(b, t1, 'left', W[5])
    L.edge(b, t2, 'right', W[5])
    -- broken kerb stone fallen on the deck
    BX(L, b, ax, 4, 2, 8, 6, DZ, 1, W, { base = true })
  elseif st == 'rebuilding' then
    local top = deckSlab(L, b, ax, 0, LEN, 0, 16, WAG.deckZ0, 2, W)
    boardSeams(L, b, ax, 0, LEN, {4, 8, 12}, DZ, W[3])
    -- replacement boards laid across the damaged bay, lighter timber
    for k = 0, 2 do
      Q(L, b, ax, {{14, 2 + 4 * k, DZ}, {22, 2 + 4 * k, DZ}, {22, 6 + 4 * k, DZ}, {14, 6 + 4 * k, DZ}}, W[5])
    end
    L.edge(b, top, 'bottom', W[5])
    -- scaffold frame on the near edge and stored timber
    BX(L, c.details, ax, 14, 12, 16, 16, DZ, 5, W, { base = true })
    BX(L, c.details, ax, 20, 12, 22, 16, DZ, 5, W, { base = true })
    BX(L, c.details, ax, 12, 12, 24, 16, DZ + 4, 1, W, { base = true })
    BX(L, c.details, ax, 24, 2, 28, 8, DZ, 2, W, { base = true })
  else
    local top = deckSlab(L, b, ax, 0, LEN, 0, 16, WAG.deckZ0, 2, W)
    boardSeams(L, b, ax, 0, LEN, {4, 8, 12}, DZ, W[3])
    L.edge(b, top, 'bottom', W[5])
  end
  -- kerb beams (stout gunwale) - all states except the stripped construction frame
  if st ~= 'construction' then
    BX(L, b, ax, 0, 0, LEN, 2, DZ, 1, W, { base = true })
    BX(L, c.details, ax, 0, 14, LEN, 16, DZ, 1, W, { base = true })
    if st == 'intact' then biomeTouch(L, c.props_back, ax, theme, 6, 1, DZ + 1, s.seed) end
  end
  wagonRails(L, c, ax, W, st, 0, LEN)
end

----------------------------------------------------------------- stone spans
-- Stone decks stand at z10. The9px masonry soffit gives real clearance under the arches,
-- with matching9px support piers and bank steps. Never mix stone/timber heights in one crossing.
local ARCH_A, ARCH_B, ARCH_TC = 6, 9, 16
local VIA_A, VIA_B = 2.5, 9
local VIA_TC = { 8, 16, 24 }

local function archZ(t, tc, a, b)
  local u = (t - tc) / a
  if u <= -1 or u >= 1 then return 0 end
  return b * math.sqrt(1 - u * u)
end

-- Cut a see-through opening out of the near spandrel wall, then light its voussoir ring.
-- skip0..skip1 omits the ring there (fallen voussoirs on a damaged span).
local function archOpening(L, ctx, ax, tc, a, b, C, w, skip0, skip1)
  local t0, t1 = math.ceil(tc - a), math.floor(tc + a)
  local pts = {}
  for t = t0, t1 do pts[#pts + 1] = { t, w, archZ(t, tc, a, b) } end
  pts[#pts + 1] = { t1, w, -1 }
  pts[#pts + 1] = { t0, w, -1 }
  Q(L, ctx, ax, pts, L.hex('#00000000'))
  for t = t0 + 1, t1 - 1 do
    local zc = math.floor(archZ(t, tc, a, b)) + 1
    if not (skip0 and t >= skip0 and t <= skip1) then
      pixW(L, ctx, ax, t, w, zc, ((t - tc) % 3 == 0) and C[4] or C[5])
      pixW(L, ctx, ax, t, w, zc + 1, C[2])
    end
  end
end

-- Recessed blind arch on a pier face: shadowed inset with a reveal shadow under the head.
-- Opaque masonry, so it can never be mistaken for a see-through opening.
local function blindArch(L, ctx, ax, C, tc, a, zb, zt, w)
  local function head(u)
    return zt - (zt - zb) * (1 - math.sqrt(math.max(0, 1 - u * u)))
  end
  local pts = {}
  for t = tc - a, tc + a do pts[#pts + 1] = { t, w, head((t - tc) / a) } end
  pts[#pts + 1] = { tc + a, w, zb }
  pts[#pts + 1] = { tc - a, w, zb }
  Q(L, ctx, ax, pts, C[2])
  for t = tc - a + 1, tc + a - 1 do
    pixW(L, ctx, ax, t, w, math.floor(head((t - tc) / a)), C[1])
  end
end

-- Continuous spandrel wall with coursing and staggered joints (reads as masonry, not a slab).
local function stoneWall(L, ctx, ax, C, t0, t1, w, z0, z1)
  local m = nearF(L, ctx, ax, t0, t1, w, z0, z1, nR(ax, C))
  courses(L, ctx, m, ax, 4, C[2], 0)
  for t = t0 + 2, t1 - 4, 8 do
    pixW(L, ctx, ax, t, w, z0 + 2, C[2])
    pixW(L, ctx, ax, t + 4, w, z0 + 4, C[2])
  end
  return m
end

-- Parapet run with optional broken ends (real cut faces, so a missing bay has masonry edges).
local function parapetRun(L, ctx, ax, C, t0, t1, w0, w1, z0, z1, cutA, cutB)
  local top = topF(L, ctx, ax, t0, w0, t1, w1, z1, C[4])
  nearF(L, ctx, ax, t0, t1, w1, z0, z1, nR(ax, C))
  L.edge(ctx, top, 'bottom', C[5])
  for t = t0 + 2, t1 - 2, 4 do pixW(L, ctx, ax, t, w1, z1, C[5]) end
  if cutA then endF(L, ctx, ax, t0, w0, w1, z0, z1, eR(ax, C)) end
  if cutB then endF(L, ctx, ax, t1, w0, w1, z0, z1, eR(ax, C)) end
end

local function spanStone(L, c, ax, theme, s, viaduct)
  local DZ = assert(s.deckZ)
  assert(DZ == 10, "stone deck contract must be z10")
  local C = L.C.CONCRETE
  local W = L.C.WOOD
  local st = s.visualState
  local b = c.building
  local wall = WID
  local underZ = DZ - 1
  local damaged = (st == 'damaged')
  local parH = viaduct and 5 or 4
  local pz0, pz1 = DZ, DZ + parH
  local gapA, gapB = 12, 18

  if st == 'construction' then
    -- piers and falsework only: no road surface, no usable deck illusion
    if viaduct then
      for _, t in ipairs({ 0, 10, 18, 26 }) do
        BX(L, b, ax, t, 0, t + 6, wall, 0, underZ, C, { base = true })
      end
      BX(L, b, ax, 6, 0, 26, wall, underZ - 1, 1, W, { base = true })
      for _, t in ipairs({ 6, 12, 18, 24 }) do
        BX(L, b, ax, t, 2, t + 2, 4, 0, underZ - 1, W, { base = true })
        BX(L, b, ax, t, 12, t + 2, 14, 0, underZ - 1, W, { base = true })
      end
    else
      BX(L, b, ax, 0, 0, 8, wall, 0, underZ, C, { base = true })
      BX(L, b, ax, 24, 0, 32, wall, 0, underZ, C, { base = true })
      Q(L, b, ax, { { 8, wall, 0 }, { 10, wall, 3 }, { 14, wall, 4 }, { 18, wall, 3 },
        { 20, wall, 0 }, { 20, wall, 1 }, { 18, wall, 4 }, { 14, wall, 5 }, { 10, wall, 4 },
        { 8, wall, 1 } }, W[3])
      for t = 10, 18, 4 do
        BX(L, b, ax, t, 2, t + 2, 4, 0, underZ - 1, W, { base = true })
        BX(L, b, ax, t, 12, t + 2, 14, 0, underZ - 1, W, { base = true })
      end
    end
    BX(L, b, ax, 2, 2, 6, 8, underZ, 1, C, { base = true })      -- delivered blocks
    BX(L, b, ax, 26, 6, 30, 14, underZ, 1, C, { base = true })
    return
  end

  -- ---- lower masonry: one continuous coursed spandrel, cut by real openings ----
  stoneWall(L, b, ax, C, 0, LEN, wall, 0, underZ)
  endF(L, b, ax, LEN, 0, wall, 0, underZ, eR(ax, C))
  if viaduct then
    for _, tc in ipairs(VIA_TC) do
      archOpening(L, b, ax, tc, VIA_A, VIA_B, C, wall,
        damaged and 14 or nil, damaged and 18 or nil)
    end
    -- thin piers read as buttress strips: lit edge one side, shadow the other
    for _, tc in ipairs({ 12, 20 }) do
      for z = 1, underZ - 1 do
        pixW(L, b, ax, tc - 2, wall, z, C[4])
        pixW(L, b, ax, tc + 1, wall, z, C[2])
      end
    end
  else
    archOpening(L, b, ax, ARCH_TC, ARCH_A, ARCH_B, C, wall,
      damaged and 17 or nil, damaged and 21 or nil)
    blindArch(L, b, ax, C, 5, 3, 1, 4, wall)
    blindArch(L, b, ax, C, 27, 3, 1, 4, wall)
    -- waterline plinth course gives the piers a base
    for t = 0, 4, 2 do pixW(L, b, ax, t, wall, 0, C[5]) end
    for t = 28, 32, 2 do pixW(L, b, ax, t, wall, 0, C[5]) end
  end

  if damaged then
    -- shelled masonry: genuinely missing wall, not a tint over a complete wall
    if viaduct then
      Q(L, b, ax, { { 11, wall, 2 }, { 12, wall, 4.5 }, { 14, wall, 4.4 },
        { 15, wall, 2.5 }, { 13, wall, 1 } }, L.hex('#00000000'))
    else
      Q(L, b, ax, { { 24, wall, 3.5 }, { 25, wall, 4.4 }, { 28, wall, 4.4 },
        { 30, wall, 2.5 }, { 27, wall, 1.5 } }, L.hex('#00000000'))
      Q(L, b, ax, { { 1, wall, 2.5 }, { 2, wall, 4 }, { 4, wall, 4 }, { 5, wall, 2 },
        { 3, wall, 1.5 } }, L.hex('#00000000'))
    end
  end

  -- ---- road slab and string course ----
  local road = deckSlab(L, b, ax, 0, LEN, 0, wall, underZ, 1, C)
  L.speckle(b, road, 0.05, C[3], (s.seed % 89) + 7)
  if damaged then
    -- collapsed road bay over the missing parapet section: a real hole through the deck, so the
    -- damage removes opaque geometry instead of repainting it (cleared at two z levels because the
    -- road is a surface, not a solid, and the camera sees its top plane only)
    for _, zz in ipairs({ DZ - 0.9, DZ + 0.9 }) do
      Q(L, b, ax, { { 12, 4, zz }, { 14, 12, zz }, { 17, 13, zz }, { 19, 4, zz } },
        L.hex('#00000000'))
    end
  end
  -- lit road edge + its shadow, drawn ABOVE the opening apex so it can never close an arch
  nearF(L, b, ax, 0, LEN, wall, underZ, underZ + 1, C[4])
  nearF(L, c.details, ax, 0, LEN, wall, underZ - 1, underZ, C[2])

  -- ---- parapets ----
  if damaged then
    parapetRun(L, b, ax, C, 0, gapA, 0, 2, pz0, pz1, false, true)
    parapetRun(L, b, ax, C, gapB, LEN, 0, 2, pz0, pz1, true, false)
    parapetRun(L, c.details, ax, C, 0, gapA, 14, 16, pz0, pz1, false, true)
    parapetRun(L, c.details, ax, C, gapB, LEN, 14, 16, pz0, pz1, true, false)
    -- rubble from the missing bay: coping blocks on the road, one in the water
    BX(L, c.details, ax, 12, 8, 16, 12, DZ, 1, C, { base = true })
    BX(L, c.details, ax, 8, 12, 12, 16, DZ, 1, C, { base = true })
    BX(L, b, ax, 4, 0, 8, 4, 0, 1, C, { base = true })
  else
    parapetRun(L, b, ax, C, 0, LEN, 0, 2, pz0, pz1, false, false)
    parapetRun(L, c.details, ax, C, 0, LEN, 14, 16, pz0, pz1, false, false)
  end
  -- string course separating spandrel from parapet on both edges
  nearF(L, b, ax, 0, LEN, 2, pz0 - 1, pz0, C[2])
  nearF(L, c.details, ax, 0, LEN, 16, pz0 - 1, pz0, C[2])

  if viaduct then
    -- pilaster over every pier: the viaduct's parapet rhythm and its taller silhouette
    for _, tc in ipairs({ 2, 12, 20, 30 }) do
      BX(L, b, ax, tc - 2, 0, tc + 2, 2, DZ, parH + 2, C, { base = true })
      BX(L, c.details, ax, tc - 2, 14, tc + 2, 16, DZ, parH + 2, C, { base = true })
    end
    for t = 0, LEN - 2, 4 do pixW(L, c.details, ax, t, 16, DZ + 3, C[5]) end
  else
    -- quoins at the arch piers
    for _, t in ipairs({ 0, 2, 30 }) do
      pixW(L, b, ax, t, wall, 2, C[5])
      pixW(L, b, ax, t, wall, 4, C[4])
    end
  end

  if st == 'rebuilding' then
    -- finished deck again, with a local working platform and a canvas tarp over the repaired bay
    BX(L, c.details, ax, 12, 12, 14, 16, DZ, 4, W, { base = true })
    BX(L, c.details, ax, 18, 12, 20, 16, DZ, 4, W, { base = true })
    BX(L, c.details, ax, 10, 12, 22, 16, DZ + 3, 1, W, { base = true })
    Q(L, c.details, ax, { { 13, 15, DZ + 4 }, { 19, 15, DZ + 3 }, { 19, 15, DZ },
      { 13, 15, DZ + 1 } }, L.C.WHITE[3])
    BX(L, c.details, ax, 22, 2, 26, 8, DZ, 1, C, { base = true })  -- new block waiting
  end
  if st == 'intact' then biomeTouch(L, c.props_back, ax, theme, 4, 1, pz1, s.seed) end
end

----------------------------------------------------------------- piers
local function pierTimber(L, c, ax, theme, s, heavy)
  local W = L.C.WOOD
  local st = s.visualState
  local b = c.building
  local top = heavy and WAG.underZ or FOOT.underZ
  local t0, t1 = heavy and 8 or 10, heavy and 24 or 22
  local wA, wB = 2, 14
  if st == 'construction' then
    BX(L, b, ax, t0 + 2, wA, t0 + 6, wA + 4, 0, 2, W, { base = true })
    BX(L, b, ax, t1 - 6, wB - 4, t1 - 2, wB, 0, 2, W, { base = true })
    BX(L, b, ax, t0, 0, t1, 16, top - 1, 1, W, { base = true })
    BX(L, b, ax, t0 + 4, 2, t0 + 10, 8, 0, 1, W, { base = true })   -- stacked planks at the waterline
    return
  end
  local legs = heavy and { t0, t0 + 6, t1 - 10, t1 - 4 } or { t0, t1 - 4 }
  local skip = st == 'damaged' and legs[2] or nil
  for _, t in ipairs(legs) do
    if t ~= skip then
      BX(L, b, ax, t, 2, t + 4, 6, 0, top - 1, W, { base = true })
      BX(L, b, ax, t, 10, t + 4, 14, 0, top - 1, W, { base = true })
    end
  end
  BX(L, b, ax, t0, 0, t1, 16, top - 1, 1, W, { base = true })   -- cap beam
  BX(L, b, ax, t0, 2, t1, 6, 1, 1, W, { base = true })          -- ledger
  BX(L, b, ax, t0, 10, t1, 14, 1, 1, W, { base = true })
  -- X bracing on the near bent
  diagW(L, b, ax, t0 + 1, 14, 2, t1 - 1, top - 2, W[2])
  diagW(L, b, ax, t0 + 1, 14, top - 2, t1 - 1, 2, W[3])
  if st == 'damaged' then
    -- missing leg braced by a rough prop; splintered ledger end
    diagW(L, b, ax, legs[2] + 2, 13, 0, legs[2] + 4, 3, W[3])
    BX(L, b, ax, t1 - 4, 2, t1 - 2, 6, 0, 1, W, { base = true })
    pixW(L, b, ax, t1 - 2, 6, 2, W[1])
  elseif st == 'rebuilding' then
    -- scaffold tower around the repaired bent plus a canvas wrap
    BX(L, c.details, ax, t0 - 2, 12, t0, 16, 0, top + 2, W, { base = true })
    BX(L, c.details, ax, t1, 12, t1 + 2, 16, 0, top + 2, W, { base = true })
    BX(L, c.details, ax, t0 - 2, 12, t1 + 2, 16, top + 2, 1, W, { base = true })
    Q(L, c.details, ax, {{t0, 15, top - 2}, {t1, 15, top - 2}, {t1, 15, 2}, {t0, 15, 2}}, L.C.WHITE[3])
    Q(L, c.details, ax, {{t0, 16, 2}, {t1, 16, 2}, {t1, 16, top - 2}, {t0, 16, top - 2}}, L.C.WHITE[2])
  elseif st == 'intact' and theme then
    biomeTouch(L, c.details, ax, theme, t0 + 2, 14, top + 1, s.seed)
  end
end

local function pierStone(L, c, ax, theme, s, slender)
  local C = L.C.CONCRETE
  local st = s.visualState
  local b = c.building
  local top = assert(s.supportTopZ)
  assert(top == s.deckZ - 1, "stone pier must meet deck soffit")
  local p0, p1 = slender and 10 or 8, slender and 22 or 24
  local s0, s1 = slender and 14 or 12, slender and 18 or 20
  if st == 'construction' then
    BX(L, b, ax, p0, 2, p1, 14, 0, 2, C, { base = true })
    BX(L, b, ax, s0, 4, s1, 12, 2, 1, C, { base = true })
    BX(L, b, ax, p0, 2, p0 + 4, 8, 0, 1, C, { base = true })   -- delivered blocks
    BX(L, b, ax, p1 - 4, 6, p1, 12, 0, 1, C, { base = true })
    BX(L, b, ax, s0 - 2, 0, s1 + 2, 4, top - 1, 1, L.C.WOOD, { base = true })  -- centring beam
    return
  end
  BX(L, b, ax, p0, 2, p1, 14, 0, 2, C, { base = true })
  BX(L, b, ax, s0, 4, s1, 12, 2, top - 3, C, { base = true })
  BX(L, b, ax, p0, 2, p1, 14, top - 1, 1, C, { base = true })   -- corbel cap
  -- vertical coursing and a pilaster shadow on the near face
  local shaft = nearF(L, b, ax, s0, s1, 12, 2, top - 3, C[3])
  courses(L, b, shaft, ax, 4, C[2], 0)
  nearF(L, b, ax, s0, s0 + 2, 12, 2, top - 1, C[2])
  if st == 'damaged' then
    Q(L, b, ax, {{s0 + 2, 14, 3}, {s1 - 4, 14, 2}, {s1 - 2, 14, 1}, {s0 + 4, 14, 1}}, C[2])
    BX(L, b, ax, p0, 4, p0 + 2, 6, 0, 1, C, { base = true })
    diagW(L, b, ax, s1, 12, 4, s1 - 2, 1, C[1])
  elseif st == 'rebuilding' then
    BX(L, c.details, ax, p0 - 2, 12, p0, 16, 0, top + 2, C, { base = true })
    BX(L, c.details, ax, p1, 12, p1 + 2, 16, 0, top + 2, C, { base = true })
    BX(L, c.details, ax, p0 - 2, 12, p1 + 2, 16, top + 2, 1, C, { base = true })
    Q(L, c.details, ax, {{p0, 16, 1}, {p1, 16, 1}, {p1, 16, top - 1}, {p0, 16, top - 1}}, L.C.WHITE[3])
  elseif st == 'intact' then
    biomeTouch(L, c.details, ax, theme, p0 + 2, 14, top, s.seed)
  end
end

----------------------------------------------------------------- banks (near / far)
-- Built canonically with the land end at t=32, then mirrored for far_bank.
local function bank(L, c, ax, theme, s, mir, cfg)
  local DZ = s.deckZ or 6
  local b, det, back = c.building, c.details, c.props_back
  local st = s.visualState
  local ramp = L.C[cfg.ramp]
  local M = function(t) return mir and (LEN - t) or t end
  local function bx(ctx, t0, w0, t1, w1, z0, H, r, opt)
    local a, bb = M(t0), M(t1)
    if a > bb then a, bb = bb, a end
    return BX(L, ctx, ax, a, w0, bb, w1, z0, H, r, opt)
  end
  -- strip() takes FINAL world t values (already mirrored by the caller).
  local function strip(ctx, t0, t1, w, z0, z1, col)
    return nearF(L, ctx, ax, t0, t1, w, z0, z1, col)
  end
  local under = cfg.underZ
  local deckEnd = 22
  local deckTop = DZ

  -- masonry abutment + stair treads (canonical: high at t<=26, ground at t=32)
  local stoneRamp = L.C.CONCRETE
  if st ~= 'construction' then
    if cfg.stoneDeck then
      -- Five2px drops across the final10world units. Every tread is backed by solid masonry.
      -- Land endpoint t32 is z0; the crossing endpoint t0 stays at deckZ10.
      for step = 0, 4 do
        local start = 22 + step * 2
        local height = DZ - step * 2
        bx(b, start, 0, start + 2, 16, 0, height, stoneRamp, {base=true})
        if not mir then
          endF(L,b,ax,M(start+2),0,16,math.max(0,height-2),height,eR(ax,stoneRamp))
        else
          strip(b,M(start+1),M(start+2),16,height-1,height,stoneRamp[1])
        end
      end
      -- Low stepped coping follows the stairs instead of a floating constant-height kerb.
      for step=0,4 do
        local t=22+step*2
        local z=DZ-step*2
        bx(b,t,0,t+2,2,z,1,stoneRamp,{base=true})
        bx(det,t,14,t+2,16,z,1,stoneRamp,{base=true})
      end
    else
      bx(b, 24, 0, 32, 16, 0, 2, stoneRamp, { base = true })
      bx(b, 20, 0, 30, 16, 2, 2, stoneRamp, { base = true })
      if under > 4 then bx(b, 20, 0, 26, 16, 4, under - 4, stoneRamp, { base = true }) end
      -- risers / tread edges: visible face when the stair descends toward +t, shadow line otherwise
      local levels = { { 26, under, 4 }, { 30, 4, 2 }, { 32, 2, 0 } }
      for _, lv in ipairs(levels) do
        if not mir then
          endF(L, b, ax, M(lv[1]), 0, 16, lv[3], lv[2], eR(ax, stoneRamp))
        else
          strip(b, M(lv[1] - 1), M(lv[1]), 16, lv[3], lv[3] + 1, stoneRamp[1])
        end
      end
      -- kerbs along the stair
      bx(b, 22, 0, 32, 2, 2, 2, stoneRamp, { base = true })
      bx(det, 22, 14, 32, 16, 2, 2, stoneRamp, { base = true })
    end
    -- bollard anchoring the handrail at the foot of the stair
    bx(det, 28, 12, 32, 16, 0, 3, ramp, { base = true })
    strip(b, M(30), M(32), 16, 0, 2, stoneRamp[2])
  else
    -- only the footings and the bottom riser exist
    bx(b, 26, 0, 32, 16, 0, 2, stoneRamp, { base = true })
    bx(b, 24, 2, 30, 14, 0, 1, stoneRamp, { base = true })
  end

  -- deck: identical cross-section to the matching span type
  local gap = (st == 'damaged' or st == 'rebuilding')
  if cfg.stoneDeck then
    if st == 'construction' then
      bx(b, 0, 0, 20, 16, under - 1, 1, L.C.WOOD, { base = true })
      bx(b, 0, 2, 16, 14, 0, under - 1, L.C.WOOD, { base = true })
      bx(b, 4, 2, 8, 6, 0, 2, stoneRamp, { base = true })
      if cfg.wing then
        bx(b, 24, 0, 32, 4, 0, 2, stoneRamp, { base = true })
        bx(det, 24, 12, 32, 16, 0, 2, stoneRamp, { base = true })
      else
        bx(det, 20, 12, 22, 16, 0, 2, stoneRamp, { base = true })
      end
    else
      local top = deckSlab(L, b, ax, M(0), M(deckEnd), 0, WID, under, deckTop - under, stoneRamp)
      L.speckle(b, top, 0.05, stoneRamp[3], (s.seed % 71) + 3)
      bx(b, 0, 0, 20, 16, 0, under, stoneRamp, { base = true })
      -- parapet return; the damaged/rebuilding states lose the bay at the stair mouth
      local pa, pb = M(0), M(gap and 16 or 22)
      railRun(L, b, ax, pa, pb, 0, 2, DZ, DZ + 4, stoneRamp, false)
      railRun(L, det, ax, pa, pb, 14, 16, DZ, DZ + 4, stoneRamp, false)
      strip(b, pa, pb, 2, DZ - 1, DZ, stoneRamp[2])
      strip(det, pa, pb, 16, DZ - 1, DZ, stoneRamp[2])
      for t = 0, 20, 4 do
        if not (gap and t >= 14) then pixW(L, det, ax, M(t), 16, DZ + 4, stoneRamp[5]) end
      end
      if cfg.wing then
        -- viaduct abutment: wing walls flanking the stair (distinct bank silhouette)
        bx(b, 24, 0, 32, 4, 0, under + 2, stoneRamp, { base = true })
        bx(det, 24, 12, 32, 16, 0, under + 2, stoneRamp, { base = true })
        bx(det, 26, 12, 28, 16, under + 2, 1, stoneRamp, { base = true })
      else
        -- arch abutment: quoin pillar at the corner
        bx(det, 20, 12, 22, 16, 0, under + 1, stoneRamp, { base = true })
      end
      if st == 'damaged' then
        bx(det, 16, 4, 20, 10, DZ, 1, stoneRamp, { base = true })   -- fallen coping on the road
        bx(det, 18, 10, 20, 12, DZ + 1, 1, stoneRamp, { base = true })
      elseif st == 'rebuilding' then
        bx(det, 16, 12, 18, 16, DZ, 4, L.C.WOOD, { base = true })
        bx(det, 20, 12, 22, 16, DZ, 4, L.C.WOOD, { base = true })
        bx(det, 14, 12, 22, 16, DZ + 4, 1, L.C.WOOD, { base = true })
        bx(b, 16, 2, 20, 8, DZ, 1, stoneRamp, { base = true })      -- new block waiting
        Q(L, det, ax, {{M(16), 16, DZ + 4}, {M(22), 16, DZ + 3}, {M(22), 16, DZ}, {M(16), 16, DZ + 1}}, L.C.WHITE[3])
      end
    end
  else
    if st == 'construction' then
      bx(b, 0, cfg.dw0, 16, cfg.dw1, under, 1, ramp, { base = true })
      bx(b, 0, 4, 20, 12, 0, under, ramp, { base = true })
      bx(b, 4, 2, 10, 8, 0, 1, ramp, { base = true })
      bx(b, 4, 2, 8, 6, 1, 1, ramp, { base = true })
    else
      local top = deckSlab(L, b, ax, M(0), M(deckEnd), cfg.dw0, cfg.dw1, under, deckTop - under, ramp)
      plankSeams(L, b, ax, M(0), M(deckEnd), cfg.dw0, cfg.dw1, DZ, 4, ramp[3])
      L.edge(b, top, 'bottom', ramp[5])
      if st == 'damaged' then
        -- torn-out boards at the stair mouth: stringers and water show through
        Q(L, b, ax, {{M(14), cfg.dw0, DZ}, {M(20), cfg.dw0 + 2, DZ - 2},
          {M(20), cfg.dw1, DZ - 2}, {M(14), cfg.dw1, DZ}}, ramp[2])
        bx(b, 0, cfg.dw0, 14, cfg.dw1, under, 1, ramp, { base = true })
        plankSeams(L, b, ax, M(0), M(14), cfg.dw0, cfg.dw1, DZ, 4, ramp[3])
      end
      bx(b, 0, 2, 20, 4, 3, 2, ramp, { base = true })
      bx(b, 0, 10, 20, 12, 3, 2, ramp, { base = true })
      if cfg.heavy then
        bx(b, 0, 0, 20, 2, DZ, 1, ramp, { base = true })
        bx(det, 0, 14, 20, 16, DZ, 1, ramp, { base = true })
      end
    end
  end

  -- continuous handrail across the bank deck, matching the span's rail pattern and pitch so the
  -- rail runs unbroken through the seam. Construction pieces have no finished rail.
  local pw = cfg.nearRail
  if not cfg.stoneDeck and (st == 'intact' or st == 'rebuilding') then
    if cfg.rope then
      postRun(L, back, ax, { 2, 8, 14 }, cfg.farRail[1], cfg.farRail[2], DZ, FOOT.railZ, ramp)
      ropeRun(L, back, ax, M(0), M(20), cfg.farRail[2] - 1, FOOT.railZ - 1, ramp[4], true)
      postRun(L, det, ax, { 2, 8, 14 }, pw[1], pw[2], DZ, FOOT.railZ, ramp)
      ropeRun(L, det, ax, M(0), M(20), pw[1] + 1, FOOT.railZ - 1, ramp[4], true)
    else
      postRun(L, back, ax, { 2, 10, 18 }, cfg.farRail[1], cfg.farRail[2], DZ + 1, WAG.railZ, ramp)
      railRun(L, back, ax, M(0), M(20), cfg.farRail[1], cfg.farRail[2], WAG.railZ - 1, WAG.railZ, ramp, false)
      railRun(L, back, ax, M(0), M(20), cfg.farRail[1], cfg.farRail[2], DZ + 2, DZ + 3, ramp, false)
      postRun(L, det, ax, { 2, 10, 18 }, pw[1], pw[2], DZ + 1, WAG.railZ, ramp)
      railRun(L, det, ax, M(0), M(20), pw[1], pw[2], WAG.railZ - 1, WAG.railZ, ramp, false)
      railRun(L, det, ax, M(0), M(20), pw[1], pw[2], DZ + 2, DZ + 3, ramp, false)
      diagW(L, det, ax, M(4), pw[2] - 1, DZ + 3, M(10), WAG.railZ - 1, ramp[2])
    end
  elseif not cfg.stoneDeck and st == 'damaged' then
    -- one missing rail bay between posts: the rail is torn out, not merely darkened
    if cfg.rope then
      postRun(L, back, ax, { 2, 14 }, cfg.farRail[1], cfg.farRail[2], DZ, FOOT.railZ, ramp)
      ropeRun(L, back, ax, M(0), M(6), cfg.farRail[2] - 1, FOOT.railZ - 1, ramp[4], true)
      ropeRun(L, back, ax, M(14), M(20), cfg.farRail[2] - 1, FOOT.railZ - 1, ramp[4], true)
      postRun(L, det, ax, { 2, 14 }, pw[1], pw[2], DZ, FOOT.railZ, ramp)
      ropeRun(L, det, ax, M(0), M(6), pw[1] + 1, FOOT.railZ - 1, ramp[4], true)
      ropeRun(L, det, ax, M(14), M(20), pw[1] + 1, FOOT.railZ - 1, ramp[4], true)
    else
      postRun(L, back, ax, { 2, 14 }, cfg.farRail[1], cfg.farRail[2], DZ + 1, WAG.railZ, ramp)
      railRun(L, back, ax, M(0), M(6), cfg.farRail[1], cfg.farRail[2], WAG.railZ - 1, WAG.railZ, ramp, true)
      railRun(L, back, ax, M(14), M(20), cfg.farRail[1], cfg.farRail[2], WAG.railZ - 1, WAG.railZ, ramp, true)
      postRun(L, det, ax, { 2, 14 }, pw[1], pw[2], DZ + 1, WAG.railZ, ramp)
      railRun(L, det, ax, M(0), M(6), pw[1], pw[2], WAG.railZ - 1, WAG.railZ, ramp, true)
      railRun(L, det, ax, M(14), M(20), pw[1], pw[2], WAG.railZ - 1, WAG.railZ, ramp, true)
    end
  end
  if st == 'intact' or st == 'rebuilding' then
    bx(det, 20, pw[1], 22, pw[2], DZ, 4, ramp, { base = true })
    bx(back, 20, cfg.farRail[1], 22, cfg.farRail[2], DZ, 4, ramp, { base = true })
    if cfg.rope then
      diagW(L, det, ax, M(22), pw[2] - 1, DZ + 3, M(29), pw[2] - 1, 3, ramp[4])
      diagW(L, det, ax, M(23), pw[2] - 1, DZ + 3, M(30), pw[2] - 1, 3, ramp[3])
    else
      diagW(L, det, ax, M(22), pw[2] - 1, DZ + 2, M(29), 15, 3, ramp[3])
    end
    if st == 'intact' then
      biomeTouch(L, back, ax, theme, M(24), cfg.farRail[2] - 1, DZ + 4, s.seed)
    else
      -- rebuilding: scaffold tower on the stair, platform and a canvas tarp
      bx(det, 24, 12, 26, 16, 2, 4, L.C.WOOD, { base = true })
      bx(det, 28, 12, 30, 16, 0, 4, L.C.WOOD, { base = true })
      bx(det, 22, 12, 32, 16, DZ - 1, 1, L.C.WOOD, { base = true })
      Q(L, det, ax, {{M(20), 16, DZ + 4}, {M(24), 16, DZ + 2}, {M(24), 16, 2}, {M(20), 16, 3}}, L.C.WHITE[3])
      Q(L, det, ax, {{M(20), 16, 3}, {M(24), 16, 2}, {M(24), 16, DZ + 2}, {M(20), 16, DZ + 4}}, L.C.WHITE[2])
      bx(det, 24, 10, 28, 12, DZ, 1, L.C.WOOD, { base = true })   -- stacked new planks
    end
  elseif st == 'damaged' then
    -- leaning/broken termination post and scattered kerb stone
    Q(L, det, ax, {{M(20), pw[1], DZ}, {M(23), pw[1] + 2, DZ + 4},
      {M(23), pw[2], DZ + 4}, {M(20), pw[2], DZ}}, ramp[2])
    bx(det, 26, 4, 30, 8, 2, 1, stoneRamp, { base = true })
    diagW(L, b, ax, M(28), 16, 2, M(26), 0, stoneRamp[2])
  end
end

----------------------------------------------------------------- dispatch
local cfgFoot = {
  ramp = 'WOOD', underZ = 5, dw0 = 2, dw1 = 14, heavy = false, rope = true,
  farRail = { 2, 4 }, nearRail = { 12, 14 }, stoneDeck = false,
}
local cfgWag = {
  ramp = 'WOOD', underZ = 4, dw0 = 0, dw1 = 16, heavy = true, rope = false,
  farRail = { 0, 2 }, nearRail = { 14, 16 }, stoneDeck = false,
}
local cfgStone = {
  ramp = 'CONCRETE', underZ = 9, dw0 = 0, dw1 = 16, heavy = true, rope = false,
  farRail = { 0, 2 }, nearRail = { 14, 16 }, stoneDeck = true, wing = false,
}
local cfgVia = {
  ramp = 'CONCRETE', underZ = 9, dw0 = 0, dw1 = 16, heavy = true, rope = false,
  farRail = { 0, 2 }, nearRail = { 14, 16 }, stoneDeck = true, wing = true,
}

function F.draw(L, B, c, theme, s)
  local ax = s.orientation
  local st = s.visualState
  local part = s.part
  assert(ax == 'i' or ax == 'j', 'bridge orientation must be i or j')
  local mir = (part == 'far_bank')
  if s.kind == 'timber_footbridge' then
    if part == 'span' then spanFoot(L, c, ax, theme, s)
    elseif part == 'pier' then pierTimber(L, c, ax, theme, s, false)
    else bank(L, c, ax, theme, s, mir, cfgFoot) end
  elseif s.kind == 'timber_wagon' then
    if part == 'span' then spanWagon(L, c, ax, theme, s)
    elseif part == 'pier' then pierTimber(L, c, ax, theme, s, true)
    else bank(L, c, ax, theme, s, mir, cfgWag) end
  elseif s.kind == 'stone_arch' then
    if part == 'span' then spanStone(L, c, ax, theme, s, false)
    elseif part == 'pier' then pierStone(L, c, ax, theme, s, false)
    else bank(L, c, ax, theme, s, mir, cfgStone) end
  elseif s.kind == 'stone_viaduct' then
    if part == 'span' then spanStone(L, c, ax, theme, s, true)
    elseif part == 'pier' then pierStone(L, c, ax, theme, s, true)
    else bank(L, c, ax, theme, s, mir, cfgVia) end
  else
    error('unknown bridge kind ' .. tostring(s.kind))
  end
end

return F
