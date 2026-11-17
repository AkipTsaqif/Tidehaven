-- art/expansion/families/water.lua
-- Water-detail markers: fish_school / fish_shadow / ripples / net_floats, three variants each.
--
-- These are decorative surface markers on the water plane (z = 0).  They are deliberately NOT
-- outlined: assetClass == 'water_detail' and the runner skips the outline pass for it, which is
-- exactly what a submerged fish shadow and a broken ripple need.  Nothing here is a tile: every
-- unpainted pixel stays fully transparent so the ocean, the beach and the boats behind show
-- through.  A marker never implies cargo, a catch or production.
--
-- Palette: painted out of the biome water ramp (theme.water) so a marker reads on that biome's sea
-- without shouting over the boats, plus a little shared material for the physical net floats
-- (theme.roof paint / cork, WOOD rope).  No L.OUTLINE and no black anywhere: a heavy dark edge
-- would read as an object sitting on top of the water instead of something in it.

local F = {}

-- ------------------------------------------------------------------ water-plane helpers
local function plot(L, c, x, y, col)
  L.px(c, x, y, col)
end

local function dot(L, c, i, j, col)
  L.dot(c, i, j, 0, col)
end

-- 1 px line between two world points, stepped in SCREEN space: rounding i and j independently
-- makes a world-space rope break into dashes at 1x, while a screen-space line stays connected.
local function waterLine(L, c, i0, j0, i1, j1, col)
  local a, b = L.P(c, i0, j0, 0), L.P(c, i1, j1, 0)
  local x0, y0 = math.floor(a[1] + 0.5), math.floor(a[2] + 0.5)
  local x1, y1 = math.floor(b[1] + 0.5), math.floor(b[2] + 0.5)
  local dx, dy = x1 - x0, y1 - y0
  local n = math.max(math.abs(dx), math.abs(dy))
  if n == 0 then plot(L, c, x0, y0, col) return end
  for k = 0, n do
    local t = k / n
    plot(L, c, math.floor(x0 + dx * t + 0.5), math.floor(y0 + dy * t + 0.5), col)
  end
end

-- A ripple is a 2:1 ring with one gap. The far half takes the lit water step, the near half the
-- shaded one, and a couple of crest pixels sit on the far arc: that is what makes a flat ring read
-- as water rather than as a wire loop. Sampling per screen COLUMN keeps the ring connected; sampling
-- by angle leaves dotted gaps at these radii.
local function rippleRing(L, c, ci, cj, rx, phase, w)
  local p = L.P(c, ci, cj, 0)
  local cx, cy = math.floor(p[1] + 0.5), math.floor(p[2] + 0.5)
  local ry = rx / 2
  local gapLen = math.max(1, math.floor(rx / 2))
  local gapStart = -rx + ((phase * (rx + 2)) % math.max(1, 2 * rx - gapLen))
  -- one pixel per column is not enough where the ellipse turns steep (its flanks): the run is
  -- filled between the previous column's row and this one so the ring stays continuous at 1x
  local prevTop, prevNear
  for x = -rx, rx do
    local t = x / rx
    local dy = ry * math.sqrt(math.max(0, 1 - t * t))
    local top = math.floor(cy - dy + 0.5)
    local near = math.floor(cy + dy + 0.5)
    local inGap = (x >= gapStart) and (x < gapStart + gapLen)
    if not inGap then
      if prevTop then
        for yy = math.min(prevTop, top), math.max(prevTop, top) do plot(L, c, cx + x, yy, w[4]) end
        for yy = math.min(prevNear, near), math.max(prevNear, near) do plot(L, c, cx + x, yy, w[2]) end
      else
        plot(L, c, cx + x, top, w[4])
        plot(L, c, cx + x, near, w[2])
      end
      prevTop, prevNear = top, near
    else
      prevTop, prevNear = nil, nil
    end
  end
  -- crest: brightest step, two pixels on the far arc opposite the gap
  local crestX = math.floor(-(gapStart + gapLen / 2))
  if math.abs(crestX) < rx then
    local dyr = ry * math.sqrt(math.max(0, 1 - (crestX / rx) ^ 2))
    plot(L, c, cx + crestX, math.floor(cy - dyr + 0.5), w[5])
    if math.abs(crestX) + 1 < rx then
      local d2 = ry * math.sqrt(math.max(0, 1 - ((crestX + 1) / rx) ^ 2))
      plot(L, c, cx + crestX + 1, math.floor(cy - d2 + 0.5), w[5])
    end
  end
end

-- A disturbed patch of water around a floating object: one small ring plus a lit fleck.
local function waterRuffle(L, c, ci, cj, w)
  rippleRing(L, c, ci, cj, 4, 2, w)
  local p = L.P(c, ci, cj, 0)
  plot(L, c, math.floor(p[1] + 0.5), math.floor(p[2] + 0.5) - 2, w[5])
end

-- ------------------------------------------------------------------ fish silhouettes
-- Authored as pixel patterns so a fish reads at 1x: two separated tail prongs, a full body and a
-- pointed head.  1 = lit body, 2 = shaded flank/tail, 3 = head glint.
local FISH = {
  right = {
    '2.111..',
    '.11111.',
    '2.111..',
  },
  small = {
    '2.11.',
    '.1111',
    '2.11.',
  },
}

local function fishAt(L, c, ci, cj, pattern, mirror, body, flank, shade)
  local p = L.P(c, ci, cj, 0)
  local x0, y0 = math.floor(p[1] + 0.5), math.floor(p[2] + 0.5)
  local wmax = 0
  for _, r in ipairs(pattern) do wmax = math.max(wmax, #r) end
  for ry, row in ipairs(pattern) do
    for rx = 1, #row do
      local ch = row:sub(rx, rx)
      if ch ~= '.' then
        local x = mirror and (x0 + (wmax - rx)) or (x0 + rx - 1)
        plot(L, c, x, y0 + ry - 1, (ch == '2') and flank or body)
      end
    end
  end
  -- darker water directly beneath the body: seats the fish on the surface without an outline
  for rx = 3, wmax - 1 do
    local x = mirror and (x0 + (wmax - rx)) or (x0 + rx - 1)
    plot(L, c, x, y0 + #pattern, shade)
  end
end

-- ------------------------------------------------------------------ variant layouts
-- Every variant is an explicit composition: count, facing and cluster shape all differ.

local SCHOOLS = {
  -- v1: five fish in a loose shoal running down-right, all heading the same way. Anchors are
  -- spaced in world units so no two fish silhouettes touch: each stays countable at 1x.
  { { 1, 19, false }, { 5, 11, false }, { 14, 10, false }, { 25, 15, false }, { 17, 27, false } },
  -- v2: three in a tight arrow, plus one straggler heading back the other way
  { { 1, 15, false }, { 2, 6, false }, { 14, 18, false }, { 15, 5, true } },
  -- v3: seven small fish in two clusters going opposite ways
  { { 6, 22, true }, { 7, 13, true }, { 10, 6, true }, { 16, 28, false },
    { 17, 19, false }, { 20, 12, false }, { 29, 15, false } },
}

local SHADOWS = {
  -- v1: two decent fish cruising side by side, the larger one deeper
  { { 8, 10, 5, 1, 1 }, { 20, 21, 4, -1, 2 } },
  -- v2: a scatter of four small fish
  { { 8, 11, 3, 1, 2 }, { 14, 9, 3, -1, 2 }, { 18, 14, 4, 1, 2 }, { 11, 19, 3, -1, 1 } },
  -- v3: one long shadow crossing a shorter one
  { { 13, 15, 6, 1, 1 }, { 17, 11, 4, -1, 2 } },
}

local RIPPLES = {
  -- v1: three concentric rings from a single rise
  { { 15, 14, 5, 0 }, { 15, 14, 9, 1 }, { 15, 14, 13, 2 } },
  -- v2: four separate rings drifting down-right
  { { 6, 12, 4, 0 }, { 14, 20, 4, 1 }, { 22, 8, 4, 2 }, { 10, 24, 4, 0 } },
  -- v3: one wide ring with two small ones beside it
  { { 12, 16, 11, 1 }, { 23, 10, 4, 2 }, { 7, 20, 4, 0 } },
}

-- Ropes run ACROSS the diamond (i up, j down) so they lie horizontally on screen and read as a
-- line floating on water rather than a steep wire.
local FLOATS = {
  -- v1: four cork floats strung on one rope
  { rope = { { 6, 24 }, { 26, 6 } }, floats = { { 9, 21 }, { 14, 16 }, { 19, 12 }, { 24, 7 } } },
  -- v2: three floats bunched inside a rope hoop, one of them half sunk
  { rope = { { 11, 21 }, { 18, 22 }, { 22, 15 }, { 16, 9 }, { 11, 13 }, { 11, 21 } },
    floats = { { 13, 18 }, { 19, 17 }, { 15, 12 } }, sunk = { 12, 15 } },
  -- v3: a long mooring line with floats at both ends and a marker buoy trailing aft
  { rope = { { 5, 21 }, { 27, 9 } }, floats = { { 6, 20 }, { 26, 10 } }, buoy = { 22, 22 } },
}

-- ------------------------------------------------------------------ type renderers
local function drawSchool(L, c, theme, v)
  local w = theme.water
  local body, flank, shade = w[5], w[4], w[2]
  local pattern = (v == 3) and FISH.small or FISH.right
  for _, f in ipairs(SCHOOLS[v]) do
    fishAt(L, c, f[1], f[2], pattern, f[3], body, flank, shade)
  end
end

local function drawShadow(L, c, theme, v)
  local w = theme.water
  for _, s in ipairs(SHADOWS[v]) do
    local ci, cj, rx, dir, depth = s[1], s[2], s[3], s[4], s[5]
    local body = (depth == 1) and w[1] or w[2]
    local fine = (depth == 1) and w[2] or w[3]
    local p = L.P(c, ci, cj, 0)
    local cx, cy = math.floor(p[1] + 0.5), math.floor(p[2] + 0.5)
    -- soft 2:1 body with no outline: this reads as depth under the surface, not as an object on it
    L.ellipse(c, cx, cy, rx, rx / 2, body)
    -- tail lobe set back along the body axis
    L.poly(c, { { cx - rx * dir - 1, cy }, { cx - rx * dir + 1, cy - 2 },
      { cx - rx * dir + 1, cy + 2 } }, body)
    -- pale break at the gill so the shape is recognisably a fish, not a blob
    plot(L, c, math.floor(cx + rx * dir * 0.5 + 0.5), math.floor(cy + 0.5), fine)
  end
end

local function drawRipples(L, c, theme, v)
  local w = theme.water
  for _, r in ipairs(RIPPLES[v]) do
    rippleRing(L, c, r[1], r[2], r[3], r[4], w)
  end
end

local function drawFloats(L, c, theme, v)
  local spec = FLOATS[v]
  local paint, cork, rope = theme.roof, L.C.WHEAT, L.C.WOOD
  if spec.rope then
    for k = 1, #spec.rope - 1 do
      waterLine(L, c, spec.rope[k][1], spec.rope[k][2], spec.rope[k + 1][1], spec.rope[k + 1][2], rope[3])
    end
  end
  local function floatAt(i, j, col, hi, shadeCol)
    dot(L, c, i, j + 1, shadeCol)            -- waterline, not an outline
    dot(L, c, i - 1, j, shadeCol)
    dot(L, c, i, j, col)
    dot(L, c, i + 1, j, col)
    dot(L, c, i, j - 1, hi)
    dot(L, c, i + 1, j + 1, shadeCol)
  end
  for k, f in ipairs(spec.floats) do
    if k % 2 == 1 then
      floatAt(f[1], f[2], paint[4], paint[5], theme.water[2])
    else
      floatAt(f[1], f[2], cork[4], cork[5], theme.water[2])
    end
  end
  if spec.sunk then waterRuffle(L, c, spec.sunk[1], spec.sunk[2], theme.water) end
  if spec.buoy then
    -- small marker buoy with a short trailing line, still transparent around it
    local b = spec.buoy
    waterRuffle(L, c, b[1], b[2], theme.water)
    dot(L, c, b[1], b[2] - 1, paint[3])
    dot(L, c, b[1] + 1, b[2] - 1, paint[4])
    dot(L, c, b[1], b[2] - 2, paint[5])
    dot(L, c, b[1] + 1, b[2], theme.water[2])
    waterLine(L, c, b[1], b[2], b[1] - 4, b[2] + 3, rope[3])
  end
end

local DRAW = {
  fish_school = drawSchool,
  fish_shadow = drawShadow,
  ripples = drawRipples,
  net_floats = drawFloats,
}

function F.draw(L, B, c, theme, s)
  local v = assert(tonumber(s.variant), 'water detail needs a numeric variant')
  local fn = assert(DRAW[s.kind], 'unknown water detail kind ' .. tostring(s.kind))
  fn(L, c.building, theme, math.max(1, math.min(3, math.floor(v))))
end

return F
