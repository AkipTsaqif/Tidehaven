-- EXPANSION OVERLAYS. Fire scorch: the CONSEQUENCES of a fire, never an active burning state.
--
-- These are transparent components, not buildings. `requiresMask` is true in the catalog, so
-- nothing here may be stamped unmasked onto an arbitrary building: every mark is a separate soot /
-- char cluster that the integrator clips to a wall/roof material mask (see the accepted
-- art/generated/damage-proof proof for the face/material/depth contract).
--
-- No flames, no glow, no invented collapse, no large uniform black rectangles. Severity grows by
-- COUNT and SIZE of discrete clusters and by how far staining runs down the facade, never by
-- raising opacity of one shape.
--
-- Every colour is an indexed palette entry from iso_lib.L.C (the builder asserts palette
-- membership). There is no LIT / BEACON use anywhere, so no flame or glow can appear.

local F = {}

-- ---------------------------------------------------------------- deterministic RNG
-- Small Park-Miller generator: no globals, no wall clock, reproducible for a given seed.
local function rng(seed)
  local s = math.floor(seed or 1) % 2147483647
  if s <= 0 then s = s + 2147483646 end
  return function(n)
    s = (s * 16807) % 2147483647
    return (s - 1) % math.max(1, n)
  end
end

local function palette(L)
  return {
    deep = L.C.ASPHALT[1],
    soot = L.C.WOOD[1],
    char = L.C.RUST[1],
    smoke = L.C.CONCRETE[2],
    haze = L.C.CONCRETE[3],
  }
end

-- ---------------------------------------------------------------- screen-space clusters
-- One irregular soot cluster. Rows vary in width, the core is darkest and the rim lighter, so the
-- result is a crisp pixel shape rather than a disc or a rectangle.
-- Draw a pixel only when it is safely inside the canvas. The builder rejects any clipped pixel and
-- any pixel on the outer row/column, so every mark goes through this guard.
local function safePx(L, c, x, y, col)
  if x >= 2 and y >= 2 and x <= c.w - 3 and y <= c.h - 3 then L.px(c, x, y, col) end
end

local function cluster(L, c, x, y, r, pal, rnd, density)
  density = density or 100
  for dy = -r, r do
    local t = math.abs(dy) / math.max(1, r)
    local half = math.max(0, math.floor(r * (1 - t * t) + rnd(3) - 1))
    for dx = -half, half do
      if rnd(100) < density then
        local d = (math.abs(dx) / math.max(1, half)) * 0.6 + t * 0.8
        local col
        if d > 0.86 then
          col = pal.haze
        elseif d > 0.62 then
          col = pal.smoke
        elseif d > 0.34 then
          col = pal.soot
        else
          col = pal.deep
        end
        safePx(L, c, x + dx, y + dy, col)
      end
    end
  end
  -- a couple of embedded char flecks so the cluster is not a smooth gradient
  for _ = 1, 1 + rnd(3) do
    local dx = rnd(r * 2 + 1) - r
    local dy = rnd(r * 2 + 1) - r
    safePx(L, c, x + dx, y + dy, rnd(2) == 0 and pal.deep or pal.char)
  end
end

-- A soot streak running DOWN a facade: irregular 1-2 px wide run with a darker head.
local function streak(L, c, x, y, len, pal, rnd)
  for k = 0, len do
    local xx = x + (rnd(3) - 1)
    local col = (k < len / 4) and pal.deep or (rnd(3) == 0 and pal.char or pal.soot)
    safePx(L, c, xx, y + k, col)
    if rnd(3) == 0 then safePx(L, c, xx + 1, y + k, pal.soot) end
  end
end

-- A char run along a roof edge: a broken line of char pixels, thicker where it burned hottest.
local function charRun(L, c, x0, y0, steps, sx, sy, pal, rnd)
  local x, y = x0, y0
  for k = 0, steps do
    if rnd(7) ~= 0 then
      safePx(L, c, x, y, pal.deep)
      if rnd(3) == 0 then safePx(L, c, x, y + 1, pal.char) end
      if rnd(4) == 0 then safePx(L, c, x, y - 1, pal.soot) end
    end
    if rnd(11) == 0 then
      -- a short vertical wear mark hanging off the edge
      for j = 1, 1 + rnd(3) do safePx(L, c, x, y + j, pal.soot) end
    end
    x = x + sx
    y = y + sy
  end
end

-- ---------------------------------------------------------------- severity plan
-- The marks live in the UPPER envelope of a notional box that fits the reserved lot, because that
-- is where fire damage concentrates and because the integrator masks them onto real roofs and
-- upper walls. `visualState` drives count/size, never opacity.
local SEVERITY = {
  light = { clusters = 2, radius = 3, drips = 2, runs = 1, runSteps = 0.30, reach = 0.16 },
  moderate = { clusters = 5, radius = 4, drips = 4, runs = 2, runSteps = 0.45, reach = 0.30 },
  severe = { clusters = 9, radius = 5, drips = 7, runs = 3, runSteps = 0.60, reach = 0.46 },
}

-- Biome handling is a different deterministic ARRANGEMENT and a slightly different tone balance of
-- the same effect, not a recolour of one shape: dry biomes keep more grey smoke haze, the cold
-- north keeps deeper char.
local BIOME_SEED = { tropical = 17, temperate = 29, arid = 41, northern = 53 }
local BIOME_DENSITY = { tropical = 96, temperate = 100, arid = 88, northern = 104 }


-- ---------------------------------------------------------------- storm debris
-- The AFTERMATH of a storm: broken timber, shingles, small roof fragments and torn hanging fabric.
-- No flames, char, floodwater, active wind/rain or invented collapse.
--
-- Two SEPARATE classes are produced, and the split is written out as review metadata so
-- integration can place each correctly:
--   GROUND   debris resting on the lot ground plane (world z = 0 inside the footprint). It must NOT
--            be clipped to building alpha - it belongs on the terrain.
--   ATTACHED fabric and shingles anchored on a real receiving surface (a wall plane or the roof
--            edge at a stated world z). These are clipped to WALL/ROOF with known depth.
-- `band` is the fraction of the facade height the attached damage spans: a light incident hangs
-- over a small band near the eaves, severe damage runs far down the wall. That is what makes the
-- vertical EXTENT grow with severity, not opacity.
local STORM_SEVERITY = {
  light = { ground = 3, attached = 1, spread = 0.30, tilt = 1, band = 0.16 },
  moderate = { ground = 6, attached = 3, spread = 0.55, tilt = 2, band = 0.40 },
  severe = { ground = 12, attached = 8, spread = 0.85, tilt = 3, band = 0.70 },
}

local STORM_BIOME = {
  tropical = { seed = 23, tilt = 1, fabric = 2 },
  temperate = { seed = 37, tilt = 2, fabric = 3 },
  arid = { seed = 41, tilt = 3, fabric = 1 },
  northern = { seed = 59, tilt = 2, fabric = 3 },
}

-- Per-piece PIXEL OWNERSHIP recorded at draw time.
--
-- A bounding box cannot express ownership when pieces overlap, and an isometric rectangle's screen
-- extrema are not its two diagonal corners. Instead every piece records each pixel it PAINTS, in
-- DRAW ORDER, so the later piece wins exactly as it does in the sprite. The runner rebuilds
-- per-class masks from these stamps and must reproduce the delivered sprite exactly.
local STORM_STAMPS = { pieces = {} }
local STORM_PIECE = nil

local function stormBegin(class, kind, anchor)
  STORM_PIECE = { class = class, kind = kind, anchor = anchor, sx = {}, n = 0 }
end

local function stormEnd()
  if STORM_PIECE then
    -- EVERY painted pixel must stay owned, so no piece may be dropped after painting. Slivers are
    -- avoided at DRAW time instead (segments are at least 3 units wide and tested before drawing).
    if STORM_PIECE.n > 0 then
      STORM_STAMPS.pieces[#STORM_STAMPS.pieces + 1] = STORM_PIECE
    end
    STORM_PIECE = nil
  end
end

-- Same even-odd pixel-centre test the library uses, so the stamp list is exactly what is painted.
local function stormInPoly(pts, px, py)
  local n, inside, k = #pts, false, #pts
  for i = 1, n do
    local xi, yi = pts[i][1], pts[i][2]
    local xk, yk = pts[k][1], pts[k][2]
    if (yi > py) ~= (yk > py) then
      local xc = (xk - xi) * (py - yi) / (yk - yi) + xi
      if px < xc then inside = not inside end
    end
    k = i
  end
  return inside
end

-- Fill a world-space quad exactly like L.quad, recording every painted pixel against the current
-- piece. Returns false when the quad would leave the canvas (the caller then skips it).
local function stormQuad(L, c, pts, col)
  local sp = {}
  local x0, x1, y0, y1 = math.huge, -math.huge, math.huge, -math.huge
  for k, q in ipairs(pts) do
    local p = L.P(c, q[1], q[2], q[3])
    sp[k] = p
    x0 = math.min(x0, p[1]); x1 = math.max(x1, p[1])
    y0 = math.min(y0, p[2]); y1 = math.max(y1, p[2])
  end
  if x0 < 2 or y0 < 2 or x1 > c.w - 3 or y1 > c.h - 3 then return 0 end
  local painted = 0
  for y = math.floor(y0), math.ceil(y1) - 1 do
    for x = math.floor(x0), math.ceil(x1) - 1 do
      if stormInPoly(sp, x + 0.5, y + 0.5) then
        L.px(c, x, y, col)
        painted = painted + 1
        if STORM_PIECE then
          local piece = STORM_PIECE
          piece.n = piece.n + 1
          piece.sx[piece.n] = { x, y }
        end
      end
    end
  end
  return painted
end

-- Write the ownership record. A required metadata write failure is an ERROR, never a silent return,
-- and there are no shell-outs here: this runs once per sprite inside Aseprite.
local function stormMeta(key, biome, outDir, w, h, gx, gy)
  if not outDir then
    error('storm_debris: no metadata destination (pass --script-param meta=<dir>)')
  end
  local fh = io.open(outDir .. '/' .. key .. '_' .. biome .. '.json', 'w')
  if not fh then
    error('storm_debris: cannot write metadata to ' .. outDir .. ' (create the directory first)')
  end
  local parts = {}
  for _, p in ipairs(STORM_STAMPS.pieces) do
    local xy = {}
    for i = 1, p.n do
      xy[#xy + 1] = p.sx[i][1]
      xy[#xy + 1] = p.sx[i][2]
    end
    parts[#parts + 1] = string.format(
      '{"class":"%s","kind":"%s","anchor":[%s,%s,%s],"px":%d,"stamps":[%s],"face":%s}',
      p.class, p.kind, p.anchor[1], p.anchor[2], p.anchor[3], p.n, table.concat(xy, ','),
      p.face and string.format(
        '{"plane":"%s","at":%s,"z":%s,"edge":"%s","span":[%s,%s]}',
        p.face.plane, p.face.at, p.face.z, p.face.edge, p.face.span[1], p.face.span[2])
        or 'null')
  end
  fh:write('{"key":"' .. key .. '","biome":"' .. biome .. '","size":[' .. w .. ',' .. h
    .. '],"gx":' .. gx .. ',"gy":' .. gy
    .. ',"pieces":[' .. table.concat(parts, ',') .. ']}')
  fh:close()
end

-- A broken timber plank lying flat on the ground plane at world z = 0.
local function stormPlank(L, c, i, j, len, wide, dmg, pal, rnd)
  c = c.details
  stormQuad(L, c, { { i, j, 0 }, { i + len, j, 0 }, { i + len, j + wide, 0 }, { i, j + wide, 0 } },
    pal.plank)
  local n = 1 + rnd(2)
  for k = 0, n do
    stormQuad(L, c, { { i + len - 1, j + k, 0 }, { i + len, j + k, 0 },
                { i + len, j + k + 1, 0 }, { i + len - 1, j + k + 1, 0 } },
      (k % 2 == 0) and pal.grit or pal.plankDark)
  end
  stormQuad(L, c, { { i, j, 0 }, { i + len - n, j, 0 }, { i + len - n, j + 1, 0 }, { i, j + 1, 0 } },
    pal.plankLit)
  stormQuad(L, c, { { i, j + wide, 0 }, { i + len, j + wide, 0 }, { i + len, j + wide - 1, 0 },
              { i, j + wide - 1, 0 } }, pal.plankDark)
  for _ = 1, dmg do
    local a, b = i + rnd(len), j + rnd(wide)
    stormQuad(L, c, { { a, b, 0 }, { a + 1, b, 0 }, { a + 1, b + 1, 0 }, { a, b + 1, 0 } }, pal.grit)
  end
end

-- A shingle / roof fragment: a small tile patch with a torn edge.
local function stormShingle(L, c, i, j, z, w, d, pal, rnd)
  c = c.details
  stormQuad(L, c, { { i, j, z }, { i + w, j, z }, { i + w, j + d, z + 1 }, { i, j + d, z + 1 } },
    pal.tile)
  stormQuad(L, c, { { i, j, z }, { i + w, j, z }, { i + w, j + 1, z + 1 }, { i, j + 1, z + 1 } },
    pal.tileLit)
  -- Torn edge: the teeth are drawn INSIDE the tile's last row, overlapping it by one unit, so the
  -- fragment stays one continuous piece. Drawing them a row beyond the body left single-pixel
  -- islands floating clear of the tile (a real defect the ground validator surfaced).
  for k = 0, w - 1, 2 do
    if rnd(3) ~= 0 then
      stormQuad(L, c, { { i + k, j + d - 1, z + 1 }, { i + k + 1, j + d - 1, z + 1 },
                  { i + k + 1, j + d, z + 1 }, { i + k, j + d, z + 1 } }, pal.tileDark)
    end
  end
end

-- Torn cloth hanging from an anchor on a wall plane (j = j). The top edge is the anchor and lies
-- on the wall plane, so the piece is attached rather than floating.
local function stormCloth(L, c, i, j, z, w, h, pal, rnd)
  c = c.details
  stormQuad(L, c, { { i, j, z }, { i + w, j, z }, { i + w, j, z - h }, { i, j, z - h } }, pal.cloth)
  for k = 0, w - 1 do
    if rnd(3) == 0 then
      stormQuad(L, c, { { i + k, j, z - h }, { i + k + 1, j, z - h },
                  { i + k + 1, j, z - h + 1 }, { i + k, j, z - h + 1 } }, pal.clothTorn)
    end
  end
  stormQuad(L, c, { { i, j, z }, { i + w, j, z }, { i + w, j, z - 1 }, { i, j, z - 1 } }, pal.clothLit)
end

local function stormDraw(L, c, theme, s)
  local A, D = s.A, s.B
  local gx = s.pivot.x - A + D
  local gy = s.pivot.y - (A + D) / 2
  local sev = STORM_SEVERITY[s.visualState] or STORM_SEVERITY.moderate
  local bio = STORM_BIOME[s.biome] or STORM_BIOME.temperate
  local rnd = rng(bio.seed * 7919 + s.width * 31 + s.height * 17
    + (s.visualState == 'severe' and 3 or s.visualState == 'light' and 1 or 2))

  local pal = {
    plank = L.C.WOOD[3], plankDark = L.C.WOOD[1], plankLit = L.C.WOOD[4],
    tile = theme.roof[4], tileDark = theme.roof[2], tileLit = theme.roof[5],
    cloth = theme.roof[3], clothTorn = theme.roof[2], clothLit = theme.roof[5],
    grit = L.C.CONCRETE[2],
  }

  local inset = math.max(6, math.floor(math.min(A, D) / 8))
  local i0, j0 = inset, inset
  local i1, j1 = A - inset, D - inset
  -- ---- GROUND debris: flat on the lot ground plane at world z = 0, inside the footprint
  for n = 1, sev.ground do
    local reach = math.max(2, math.floor((j1 - j0) * sev.spread))
    -- the first piece is pinned to the OUTER edge of the band, so the debris field genuinely
    -- extends further from the building as severity rises instead of varying by luck
    local far = (n == 1)
    if n % 3 == 1 then
      local len, wide = 5 + rnd(4), 2 + rnd(2)
      local i = i0 + rnd(math.max(2, i1 - i0 - len))
      local j = math.max(j0 + 2, j1 - 3 - (far and reach or rnd(reach)))
      stormBegin('ground', 'plank', { i, j, 0 })
      stormPlank(L, c, i, j, len, wide, 1 + rnd(2), pal, rnd)
      stormEnd()
    else
      local w, d = 3 + rnd(3), 2 + rnd(2)
      local i = i0 + rnd(math.max(2, i1 - i0 - w))
      local j = math.max(j0 + 2, j1 - 3 - (far and reach or rnd(reach)))
      stormBegin('ground', 'shingle', { i, j, 0 })
      stormShingle(L, c, i, j, 0, w, d, pal, rnd)
      stormEnd()
    end
  end

  -- ---- ATTACHED pieces: hung on a wall plane or resting on the roof edge at a stated world z.
  -- `face` names the receiving surface so the validator can prove the connection survives clipping.
  local zTop = math.floor((gy + A / 2 - 8) * 0.94)
  for n = 1, sev.attached do
    if n % 2 == 1 then
      local i = i0 + 2 + rnd(math.max(2, i1 - i0 - 8))
      local jw = j0 + 2 + rnd(math.max(2, math.floor((j1 - j0) * 0.5)))
      -- Each cloth has a bounded size; the SEVERITY band decides how far down the facade the
      -- damage reaches and where each hanging piece sits. Total attached area therefore grows with
      -- the piece COUNT, and the deepest anchor is ordered by the band, both by construction.
      local zFloor = 6
      local bandMax = math.max(2, math.min(math.floor(zTop * sev.band), zTop - 4 - zFloor - 8))
      local deepest = (n == 1)
      local z = deepest and (zTop - 4 - bandMax) or (zTop - 4 - rnd(bandMax))
      local w = 3 + rnd(2 + bio.fabric)
      local h = math.max(4, math.min(5 + rnd(3 + sev.tilt * 2), z - zFloor))
      stormBegin('attached', 'cloth', { i, jw, z })
      -- the attachment edge is the TOP row of the cloth, on the wall plane j = jw
      STORM_PIECE.face = { plane = 'j', at = jw, z = z, edge = 'top', span = { i, i + w } }
      stormCloth(L, c, i, jw, z, w, h, pal, rnd)
      stormEnd()
    else
      local i = i0 + 2 + rnd(math.max(2, i1 - i0 - 8))
      local je = j1 - 2
      local z = zTop - rnd(3)
      stormBegin('attached', 'roofedge', { i, je, z })
      -- roof-edge shingles rest on the roof edge plane j = je at world z
      STORM_PIECE.face = { plane = 'j', at = je, z = z, edge = 'bottom', span = { i, i + 6 } }
      stormShingle(L, c, i, je, z, 4 + rnd(2), 2 + rnd(2), pal, rnd)
      stormEnd()
    end
  end

  stormMeta(s.key, s.biome, app.params.meta, s.width, s.height, gx, gy)
end


-- ---------------------------------------------------------------- flood stain
-- The AFTERMATH of flooding, not live water: a tide line and mud staining LOW on walls, silt and damp
-- streaks running down from that line, shallow mud/puddles on verified ground, and a few small pieces
-- of washed-up debris at ground level. No standing water animation, no high-floor inundation.
--
-- Two classes, exactly as storm debris: WALL marks (tide line, streaks) and GROUND marks (silt,
-- puddles, debris). Ownership is recorded per pixel at draw time so the runner can rebuild the
-- delivered sprite exactly.
--
-- HEIGHT RULE: a wall stain's world z comes from the FACE it sits on, never from screen y. Light
-- stays well below the ceiling; severe may reach z24 but never exceed it.
local FLOOD_CEILING = 24

-- tideTop  : highest world z the tide line reaches (must be <= FLOOD_CEILING)
-- band     : vertical world thickness of the stained band below the line
-- ground   : number of ground marks
-- debris   : washed-up pieces (a kind of ground mark)
local FLOOD_SEVERITY = {
  light = { tideTop = 8, band = 6, ground = 3, debris = 1 },
  moderate = { tideTop = 15, band = 9, ground = 6, debris = 2 },
  severe = { tideTop = 24, band = 13, ground = 10, debris = 3 },
}

local FLOOD_BIOME = {
  tropical = { seed = 19, silt = 3, damp = 2 },
  temperate = { seed = 31, silt = 2, damp = 3 },
  arid = { seed = 43, silt = 4, damp = 1 },
  northern = { seed = 61, silt = 2, damp = 3 },
}

-- Flood reuses the storm stamping machinery: same stormBegin/stormEnd and stormQuad, so ownership,
-- metadata shape and exact recomposition are identical and already proven.
local function floodPalette(L, theme)
  return {
    tide = L.C.CONCRETE[2],        -- dark tide line
    tideLit = L.C.CONCRETE[4],     -- silt highlight just under the line
    silt = L.C.CONCRETE[3],        -- dried silt band
    damp = theme.water[2],         -- damp streak (dark water tone)
    dampLit = theme.water[3],      -- shallow puddle
    mud = L.C.DIRT[3],             -- mud / washed-up silt
    mudDark = L.C.DIRT[2],
    drift = L.C.WOOD[3],           -- washed-up timber fragment
  }
end

-- A rectangular patch on a wall PLANE at constant j, spanning world z. Used for the tide line and
-- the stained band beneath it. Every pixel stamped is owned by the current piece.
local function floodWallPatch(L, ctx, i0, i1, j, zTop, zBot, col)
  local c = ctx.details
  stormQuad(L, c, { { i0, j, zTop }, { i1, j, zTop }, { i1, j, zBot }, { i0, j, zBot } }, col)
end

-- A damp streak running DOWN the wall from the tide line, in world z (so it stays vertical).
local function floodStreak(L, ctx, i, j, zTop, len, col, rnd)
  local c = ctx.details
  local z = zTop
  local steps = math.max(2, len)
  local ii = i
  for k = 0, steps do
    -- a 2-wide column, drifting by at most one unit so every row still touches the one above it:
    -- a damp streak is one continuous mark, not a shower of specks
    stormQuad(L, c, { { ii, j, z }, { ii + 2, j, z }, { ii + 2, j, z - 1 },
                      { ii, j, z - 1 } }, col)
    if rnd(2) == 0 then ii = ii + 1 else ii = ii - 1 end
    if ii < i - 1 then ii = i - 1 elseif ii > i + 1 then ii = i + 1 end
    z = z - 1
    if z <= 0 then break end
  end
end

-- A flat ground patch (silt / puddle) on the lot ground plane at world z = 0.
local function floodGroundPatch(L, ctx, i, j, w, d, col)
  local c = ctx.details
  stormQuad(L, c, { { i, j, 0 }, { i + w, j, 0 }, { i + w, j + d, 0 }, { i, j + d, 0 } }, col)
end

-- A washed-up timber fragment lying on the ground.
local function floodDrift(L, ctx, i, j, len, pal)
  local c = ctx.details
  stormQuad(L, c, { { i, j, 0 }, { i + len, j, 0 }, { i + len, j + 2, 0 }, { i, j + 2, 0 } },
    pal.drift)
  stormQuad(L, c, { { i, j, 0 }, { i + len - 1, j, 0 }, { i + len - 1, j + 1, 0 }, { i, j + 1, 0 } },
    pal.mudDark)
end

local function floodDraw(L, c, theme, s)
  local A, D = s.A, s.B
  local gx = s.pivot.x - A + D
  local gy = s.pivot.y - (A + D) / 2
  local sev = FLOOD_SEVERITY[s.visualState] or FLOOD_SEVERITY.moderate
  local bio = FLOOD_BIOME[s.biome] or FLOOD_BIOME.temperate
  local rnd = rng(bio.seed * 7919 + s.width * 31 + s.height * 17
    + (s.visualState == 'severe' and 3 or s.visualState == 'light' and 1 or 2))
  local pal = floodPalette(L, theme)

  -- the stain lives in the LOW part of the envelope: near the lot, not up the tower
  local inset = math.max(6, math.floor(math.min(A, D) / 8))
  local i0, j0 = inset, inset
  local i1, j1 = A - inset, D - inset

  local tideTop = math.min(sev.tideTop, FLOOD_CEILING)
  local bandBot = math.max(1, tideTop - sev.band)

  -- The stain occupies the CENTRAL LOW band of the facade, not the full lot width: a waterline is a
  -- horizontal band near the ground, and a narrower span lets whole segments land on one contiguous
  -- low-wall run (the lot's low wall is much narrower than its full face).
  local halfSpan = math.max(4, math.floor((i1 - i0) * 0.28))
  local ci = math.floor((i0 + i1) / 2)
  i0 = math.max(i0, ci - halfSpan)
  i1 = math.min(i1, ci + halfSpan)

  -- ---- WALL class: tide line + silt band + damp streaks, all on the front wall plane j = j1
  local jw = j1
  local span = i1 - i0
  -- The tide line is drawn as SEPARATE RUNS, each its own piece, so a run that cannot land whole is
  -- omitted on its own instead of taking the entire line with it. That is both better art (a broken
  -- waterline is correct) and compatible with intact-or-omitted placement.
  local x = i0
  while x < i1 do
    local run = 4 + rnd(2)
    local x2 = math.min(i1, x + run)
    if rnd(5) ~= 0 and x2 - x >= 2 then
      stormBegin('wall', 'tideLine', { x, jw, tideTop })
      STORM_PIECE.face = { plane = 'j', at = jw, z = tideTop, edge = 'top', span = { x, x2 } }
      floodWallPatch(L, c, x, x2, jw, tideTop, tideTop - 1, pal.tide)
      floodWallPatch(L, c, x, x2, jw, tideTop - 1, tideTop - 2, pal.tideLit)
      stormEnd()
    end
    x = x2 + rnd(3)
  end

  -- The stained band is drawn as separate row SEGMENTS, each its own piece, for the same reason:
  -- dried silt is patchy, and a segment that cannot land whole is dropped on its own.
  local rows = math.max(1, tideTop - bandBot)
  for r = 0, rows - 1 do
    local z = tideTop - 2 - r
    if z <= bandBot then break end
    local seg = i0
    while seg < i1 do
      local w = 5 + rnd(2 + bio.silt // 2)
      local seg2 = math.min(i1, seg + w)
      if rnd(4) ~= 0 and seg2 - seg >= 2 then
        stormBegin('wall', 'siltBand', { seg, jw, z })
        STORM_PIECE.face = { plane = 'j', at = jw, z = z, edge = 'top', span = { seg, seg2 } }
        -- ONE solid quad of world height 2, not two abutting 1-unit rows: a single-row quad at 2:1
        -- projects to a diagonal chain, and stacking them left a seam that broke the segment into
        -- islands. A 2-unit-tall patch is one connected band.
        floodWallPatch(L, c, seg, seg2, jw, z, z - 2,
          (r % 3 == 0) and pal.silt or pal.mud)
        stormEnd()
      end
      seg = seg2 + rnd(3)
    end
  end

  for n = 1, bio.damp do
    stormBegin('wall', 'dampStreak', { i0, jw, bandBot })
    STORM_PIECE.face = { plane = 'j', at = jw, z = tideTop, edge = 'top', span = { i0, i1 } }
    local i = i0 + 2 + rnd(math.max(2, span - 6))
    floodStreak(L, c, i, jw, math.max(3, tideTop - 2 - rnd(4)), 3 + rnd(4 + sev.band // 3),
      (n % 2 == 0) and pal.damp or pal.dampLit, rnd)
    stormEnd()
  end

  -- ---- GROUND class: silt / puddles / washed-up debris on the lot ground plane
  for n = 1, sev.ground do
    stormBegin('ground', 'silt', { i0, j1, 0 })
    local w, d = 3 + rnd(4), 2 + rnd(3)
    local i = i0 + rnd(math.max(2, i1 - i0 - w))
    local j = j1 - 4 - rnd(math.max(2, math.floor((j1 - j0) * 0.45)))
    floodGroundPatch(L, c, i, j, w, d, (n % 2 == 0) and pal.mud or pal.silt)
    stormEnd()
  end
  for n = 1, sev.debris do
    stormBegin('ground', 'drift', { i0, j1, 0 })
    local len = 4 + rnd(4)
    local i = i0 + rnd(math.max(2, i1 - i0 - len))
    local j = j1 - 6 - rnd(math.max(2, math.floor((j1 - j0) * 0.4)))
    floodDrift(L, c, i, j, len, pal)
    stormEnd()
  end

  stormMeta(s.key, s.biome, app.params.meta, s.width, s.height, gx, gy)
end


-- ---------------------------------------------------------------- drought ground
-- What the simulation's drought actually does: it lowers one building's condition and can injure
-- occupants. It does NOT destroy stock, kill crops or collapse anything. So this effect draws dry,
-- stressed GROUND and plants AROUND a building - cracked soil, bleached earth, thin dust drifts,
-- wilted plants, dry split timber - and never ruin, flames, mud, water or debris piles.
--
-- GROUND CLASS ONLY: nothing here may touch WALL or ROOF material, and the building is not tinted.
--
-- Reuses the storm/flood ownership-stamping helpers (stormBegin/stormEnd/stormQuad/stormMeta) so
-- exact per-pixel provenance and the per-biome metadata sidecar come for free. No existing helper's
-- behaviour is changed; the helpers below are new.
--
-- Severity changes the AREA of dry ground, the NUMBER and SIZE of crack clusters and how many plants
-- are affected - never opacity.
local DROUGHT_SEVERITY = {
  light = { patches = 4, cracks = 2, crackLen = 3, plants = 1, reach = 0.40 },
  moderate = { patches = 8, cracks = 4, crackLen = 4, plants = 2, reach = 0.68 },
  severe = { patches = 14, cracks = 6, crackLen = 5, plants = 3, reach = 1.00 },
}

-- Arid ground is ALREADY dry, so its drought cannot read as "more brown". It reads through a
-- distinct PALE tone (bleached earth + wheat straw), DEEPER and THICKER cracks, more dust and dead
-- scrub. Each biome therefore has its own dry-earth ramp as well as its own shape parameters, and
-- the arid ramp is the only one that is genuinely pale.

local DROUGHT_BIOME = {
  tropical = { seed = 13, crackDepth = 2, crackWidth = 1, dust = 2, scrub = 1, bleached = 3 },
  temperate = { seed = 29, crackDepth = 2, crackWidth = 1, dust = 3, scrub = 1, bleached = 2 },
  arid = { seed = 37, crackDepth = 5, crackWidth = 2, dust = 5, scrub = 4, bleached = 1 },
  northern = { seed = 47, crackDepth = 1, crackWidth = 1, dust = 2, scrub = 2, bleached = 2 },
}

local function even(n) return n - (n % 2) end

local function droughtPalette(L, theme, tone)
  -- DRY EARTH MUST READ LIGHTER THAN THE GRASS IT SITS ON. Grass under a lot is GRASS[4]
  -- (luminance ~135), so the dry ground has to sit ABOVE that: DIRT[4]/[5] or the pale WHEAT ramp.
  -- Before this revision the "soil" tone was DIRT[3] (lum 97) -- DARKER than the grass -- and the
  -- cracks were filled 2x2 cells in DIRT[1], so 61% of every mark was one dark brown. Dark tones are
  -- now reserved for the crack LINES, which cover a small share of the mark.
  tone = tone or {}
  local base = tone.tone or L.C.DIRT[4]
  local light = tone.toneLight or L.C.DIRT[5]
  return {
    soil = base,                 -- dry earth: the bulk of the mark, lighter than grass
    bleached = light,            -- the palest, sun-bleached earth
    pale = L.C.WHEAT[4],         -- dusty straw highlight
    crack = L.C.DIRT[1],         -- crack line ONLY
    crackLit = L.C.DIRT[2],      -- crack line edge ONLY
    dead = L.C.BARN[2],          -- dead leaf / dead scrub
    deadLit = L.C.BARN[3],
    trunk = L.C.WOOD[2],         -- dry split timber
    trunkLit = L.C.WOOD[3],
    drv = theme.leaf,            -- a still-alive leaf tone, used sparingly
  }
end

-- A single stamped pixel. Every drought helper must go through stormQuad or droughtDot, otherwise
-- painted pixels would have no owner and exact recomposition would fail.
local function droughtDot(L, ctx, i, j, z, col)
  local c = ctx.details
  stormQuad(L, c, { { i, j, z }, { i + 1, j, z }, { i + 1, j + 1, z }, { i, j + 1, z } }, col)
end

-- One flat ground patch on the lot ground plane (world z = 0): dry, bleached or dusty earth.
local function droughtPatch(L, ctx, i, j, w, d, col)
  local c = ctx.details
  stormQuad(L, c, { { i, j, 0 }, { i + w, j, 0 }, { i + w, j + d, 0 }, { i, j + d, 0 } }, col)
end

-- A crack run: a jagged dark line across the dry ground, with a lit edge on one side so it reads as
-- a fissure rather than a smear. Runs in world i/j on the ground plane.
local function droughtCrack(L, ctx, i, j, len, depth, width, pal, rnd)
  local c = ctx.details
  local ci, cj = even(i), even(j)
  -- A crack is a THIN LINE, not a filled cell. Painting a 2x2 world cell solid made the cracks the
  -- dominant colour of the whole mark (61% of pixels in the 8x8 sprites). The line is therefore
  -- built from 2-wide, 1-tall strips: long in screen x, one row deep, so a fissure reads as a hair
  -- line through pale earth. `width` is how many screen rows deep it bites (arid bites deeper).
  local steps = len * 2
  local wide = math.max(1, width or 1)
  for k = 0, steps do
    for w = 0, wide - 1 do
      stormQuad(L, c, { { ci, cj + w * 2, 0 }, { ci + 2, cj + w * 2, 0 },
                        { ci + 2, cj + w * 2 + 1, 0 }, { ci, cj + w * 2 + 1, 0 } },
        (w == wide - 1 and k % 6 == 0) and pal.crackLit or pal.crack)
    end
    -- advance by half a world unit (one world i is two screen x), with a shallow adjacent wander
    ci = ci + 1
    if k % 6 == 5 then cj = cj + 2 end
    -- occasional deeper fissure: a short SECOND line offset from the main one, still adjacent
    if k % 11 == 10 and depth > 1 then
      stormQuad(L, c, { { ci, cj + 2, 0 }, { ci + 2, cj + 2, 0 },
                        { ci + 2, cj + 3, 0 }, { ci, cj + 3, 0 } }, pal.crack)
    end
  end
end

-- A thin dust drift: a very sparse pale scatter, never a solid block.
local function droughtDust(L, ctx, i, j, w, d, pal, rnd, density)
  local c = ctx.details
  -- Dust drifts are CONNECTED thin streaks, not confetti: each row's run always overlaps the run
  -- behind it, so the mark is one piece.
  local x = 1 + rnd(math.max(1, w - 3))
  for y = 0, d - 1 do
    local run = 2 + rnd(3)
    local col = (rnd(3) == 0) and pal.pale or pal.bleached
    stormQuad(L, c, { { i + x, j + y, 0 }, { i + x + run, j + y, 0 },
                      { i + x + run, j + y + 1, 0 }, { i + x, j + y + 1, 0 } }, col)
    if rnd(2) == 0 then x = math.max(0, x - 1) else x = math.min(w - run, x + 1) end
  end
end

-- A WILTED PALM: the crown droops and the trunk leans hard, unlike the healthy palm helper whose
-- four straight leaf quads stand out. New helper - the shared plant helper is untouched.
local function droughtWiltedPalm(L, ctx, i, j, size, pal, rnd)
  local c = ctx.details
  -- leaning trunk, 2 px per step, drawn as stacked dots so it stays on the ground plane's footprint
  local height = 5 + size
  local lean = (rnd(2) == 0) and 1 or -1
  for k = 0, height - 1 do
    local shift = lean * math.floor(k / 3)
    droughtDot(L, ctx, i + shift, j, k, pal.trunk)
    if k % 2 == 0 then droughtDot(L, ctx, i + shift + 1, j, k, pal.trunkLit) end
  end
  -- Drooping crown: a CONNECTED dead head at the trunk tip, with leaves hanging from cells that
  -- OVERLAP the head by one unit (a world unit is 2 screen px, so a 2-unit-wide cell is needed for
  -- consecutive cells to touch).
  local tip = i + lean * math.floor(height / 3)
  stormQuad(L, c, { { tip, j, height - 1 }, { tip + 4, j, height - 1 },
                    { tip + 4, j + 4, height - 1 }, { tip, j + 4, height - 1 } }, pal.dead)
  for k = 0, 3 do
    local dx = (k - 1) * 2
    stormQuad(L, c, { { tip + dx, j, height - 1 }, { tip + dx + 2, j, height - 1 },
                      { tip + dx + 2, j + 2, height - 1 - (k % 2) },
                      { tip + dx, j + 2, height - 1 - (k % 2) } }, pal.dead)
  end
  droughtDot(L, ctx, tip + 1, j + 1, height, pal.deadLit)
end

-- Dead scrub / dry brush: a low clump of dead twigs. Arid gets more of these.
local function droughtScrub(L, ctx, i, j, size, pal, rnd)
  local c = ctx.details
  for k = 0, 2 + size do
    local ii = i + rnd(size + 1) - 1
    local jj = j + rnd(2)
    local h = 1 + rnd(2)
    for z = 0, h do
      stormQuad(L, c, { { ii, jj, z }, { ii + 1, jj, z }, { ii + 1, jj + 1, z },
                        { ii, jj + 1, z } }, (z == h) and pal.deadLit or pal.dead)
    end
  end
end

-- A CACTUS STILL ALIVE in arid: drought makes cacti look dry at the ribs but they survive, so this
-- is a green body with bleached rib lines, not a dead stump.
local function droughtLiveCactus(L, ctx, i, j, size, pal, rnd)
  local c = ctx.details
  local green = pal.drv
  local h = 6 + size
  i, j = even(i), even(j)
  -- Same footprint as the shared cactus helper, but the rib dots are BLEACHED: the drought read is
  -- dry ribs on a plant that SURVIVES, not a dead stump. Built from stamped quads rather than L.box,
  -- because an L.box pixel would have no owner and exact recomposition would fail.
  for z = 0, h - 1 do
    stormQuad(L, c, { { i - 2, j - 2, z }, { i + 2, j - 2, z },
                      { i + 2, j + 2, z }, { i - 2, j + 2, z } }, green)
  end
  for z = 1, h - 1, 2 do
    droughtDot(L, ctx, i - 2, j - 2, z, pal.pale)
  end
  if rnd(2) == 0 then
    for z = 2, 4 do
      stormQuad(L, c, { { i + 2, j - 2, z }, { i + 4, j - 2, z },
                        { i + 4, j, z }, { i + 2, j, z } }, green)
    end
  end
end

-- A BARE PINE: the northern drought read is a conifer with a thinned, browning canopy, not a pile of
-- timber. Trunk plus sparse dead needles.
local function droughtBarePine(L, ctx, i, j, size, pal, rnd)
  local c = ctx.details
  local h = 7 + size
  for z = 0, h do
    droughtDot(L, ctx, i, j, z, pal.trunk)
    if z % 3 == 0 then droughtDot(L, ctx, i + 1, j, z, pal.trunkLit) end
  end
  for tier = 0, 2 do
    local z = h - tier * 3
    local span = 2 + tier
    for k = -span, span, 2 do
      if rnd(4) ~= 0 then droughtDot(L, ctx, i + k, j, z, pal.dead) end
    end
  end
end

-- Dry, split timber at ground level: a pale cracked plank, no storm-style breakage.
local function droughtSplitTimber(L, ctx, i, j, len, pal, rnd)
  local c = ctx.details
  stormQuad(L, c, { { i, j, 0 }, { i + len, j, 0 }, { i + len, j + 2, 0 }, { i, j + 2, 0 } },
    pal.trunk)
  stormQuad(L, c, { { i, j, 0 }, { i + len, j, 0 }, { i + len, j + 1, 0 }, { i, j + 1, 0 } },
    pal.trunkLit)
  -- a split running along the grain, and one splinter lifted
  local k = 1 + rnd(math.max(1, len - 2))
  stormQuad(L, c, { { i + k, j, 0 }, { i + k + 1, j, 0 }, { i + k + 1, j + 2, 0 },
                    { i + k, j + 2, 0 } }, pal.crack)
  if rnd(2) == 0 then
    stormQuad(L, c, { { i + len - 1, j, 0 }, { i + len, j, 0 }, { i + len, j + 1, 0 },
                      { i + len - 1, j + 1, 0 } }, pal.dead)
  end
end

local function droughtDraw(L, c, theme, s)
  local A, D = s.A, s.B
  local gx = s.pivot.x - A + D
  local gy = s.pivot.y - (A + D) / 2
  local sev = DROUGHT_SEVERITY[s.visualState] or DROUGHT_SEVERITY.moderate
  local bio = DROUGHT_BIOME[s.biome] or DROUGHT_BIOME.temperate
  local rnd = rng(bio.seed * 7919 + s.width * 31 + s.height * 17
    + (s.visualState == 'severe' and 3 or s.visualState == 'light' and 1 or 2))
  -- biome dry-earth ramp, built from the live palette table (iso_lib is only available at draw time)
  local TONE = {
    tropical = { tone = L.C.DIRT[5], toneLight = L.C.WHEAT[4] },
    temperate = { tone = L.C.DIRT[5], toneLight = L.C.WHEAT[4] },
    arid = { tone = L.C.WHEAT[4], toneLight = L.C.WHEAT[5] },
    northern = { tone = L.C.DIRT[5], toneLight = L.C.WHEAT[4] },
  }
  local pal = droughtPalette(L, theme, TONE[s.biome] or TONE.temperate)

  -- Everything lives inside the reserved lot footprint, on the ground plane.
  local inset = math.max(6, math.floor(math.min(A, D) / 8))
  local i0, j0 = inset, inset
  local i1, j1 = A - inset, D - inset
  local span = i1 - i0
  local depthSpan = j1 - j0

  -- the dry area grows with severity: a band measured from the FRONT of the lot inward
  local reach = math.max(4, math.floor(depthSpan * sev.reach))
  local jFront = j1 - 2
  local jBack = math.max(j0 + 2, j1 - 2 - reach)

  -- ---- 1. DRY / BLEACHED EARTH: the base of the effect, one piece per patch so each can be
  -- omitted on its own rather than taking the whole ground with it.
  for n = 1, sev.patches do
    local w = 4 + rnd(5)
    local d = 2 + rnd(3)
    local i = i0 + rnd(math.max(2, span - w))
    local j = jBack + rnd(math.max(2, reach - d))
    stormBegin('ground', 'dryEarth', { i, j, 0 })
    droughtPatch(L, c, i, j, w, d, (n % 3 == 0) and pal.bleached or pal.soil)
    stormEnd()
  end

  -- ---- 2. CRACK CLUSTERS: irregular fissure networks, each cluster its own piece
  for n = 1, sev.cracks do
    local len = math.max(3, sev.crackLen - rnd(4))
    local i = i0 + rnd(math.max(2, span - len - 2))
    local j = jBack + rnd(math.max(2, reach - 2))
    stormBegin('ground', 'crack', { i, j, 0 })
    -- One call: the fissure forks INTERNALLY (see the depth branch inside droughtCrack). A second
    -- droughtCrack call would start at a detached point and break the piece into islands.
    droughtCrack(L, c, i, j, len, bio.crackDepth, bio.crackWidth, pal, rnd)
    stormEnd()
  end

  -- ---- 3. DUST DRIFTS: thin pale scatter, never a solid block
  for n = 1, bio.dust do
    local w, d = 5 + rnd(5), 2 + rnd(2)
    local i = i0 + rnd(math.max(2, span - w))
    local j = jBack + rnd(math.max(2, reach - d))
    stormBegin('ground', 'dust', { i, j, 0 })
    droughtDust(L, c, i, j, w, d, pal, rnd, 26)
    stormEnd()
  end

  -- ---- 4. DRY SPLIT TIMBER at ground level
  for n = 1, 1 + bio.scrub do
    local len = 4 + rnd(3)
    local i = i0 + rnd(math.max(2, span - len))
    local j = jBack + rnd(math.max(2, reach - 2))
    stormBegin('ground', 'dryTimber', { i, j, 0 })
    droughtSplitTimber(L, c, i, j, len, pal, rnd)
    stormEnd()
  end

  -- ---- 5. AFFECTED PLANTS: wilted / dead, one piece each, biome-appropriate form
  for n = 1, sev.plants do
    local i = i0 + 3 + rnd(math.max(2, span - 6))
    local j = jBack + 2 + rnd(math.max(2, reach - 3))
    if s.biome == 'arid' then
      -- arid keeps its cactus ALIVE: the drought read is dry ribs plus dead scrub around it
      stormBegin('ground', 'cactus', { i, j, 0 })
      droughtLiveCactus(L, c, i, j, 3, pal, rnd)
      stormEnd()
      for k = 1, bio.scrub do
        stormBegin('ground', 'scrub', { i + 4 + k, j + 2, 0 })
        droughtScrub(L, c, i + 4 + k, j + 2, 2, pal, rnd)
        stormEnd()
      end
    elseif s.biome == 'northern' then
      stormBegin('ground', 'pine', { i, j, 0 })
      droughtBarePine(L, c, i, j, 3, pal, rnd)
      stormEnd()
    else
      stormBegin('ground', 'palm', { i, j, 0 })
      droughtWiltedPalm(L, c, i, j, 3, pal, rnd)
      stormEnd()
      if n == 1 then
        stormBegin('ground', 'scrub', { i + 4, j + 2, 0 })
        droughtScrub(L, c, i + 4, j + 2, 2, pal, rnd)
        stormEnd()
      end
    end
  end

  stormMeta(s.key, s.biome, app.params.meta, s.width, s.height, gx, gy)
end

-- The outbreak helpers take the ctx table and draw on the details layer, like every other effect.
local function ctx_of(c) return c end


-- ---------------------------------------------------------------- outbreak sign
-- What an outbreak actually is in this game (src/domain/events/health.ts, startOutbreak): a health
-- case on a RESIDENT, "harbour fever", infectious for 7-14 days, emitted with `targetId: null`.
-- No building is involved and nothing is damaged. So this overlay is a PRESENTATION of "someone here
-- is ill / under care": a small public-health notice standing on the ground at a building's entrance.
-- It is NOT a statement that the building is ruined, condemned or unsafe.
--
-- Nothing here may touch the building: no rubble, char, mud, water, cracked ground, damage, bodies,
-- boarded openings or window changes. The mark is a plain board with a simple ABSTRACT device, never
-- a cross or any real-world organisation emblem.
--
-- Reuses the storm/flood/drought ownership-stamping helpers (stormBegin/stormEnd/stormQuad/stormMeta)
-- so exact per-pixel provenance and the per-biome metadata sidecar come for free. Every helper below
-- is NEW; no existing helper's behaviour is changed.
--
-- Severity changes ARRANGEMENT, never opacity:
--   light    one small notice board on a post
--   moderate board + a tied cloth marker
--   severe   board + a short rope barrier between two posts + one more marker
local OUTBREAK_SEVERITY = {
  light = { posts = 1, cloth = 0, barrier = 0, stake = 0 },
  moderate = { posts = 2, cloth = 1, barrier = 0, stake = 1 },
  severe = { posts = 4, cloth = 1, barrier = 2, stake = 1 },
}

-- Biome differences are material and SHAPE, not recolour: a palm-thatch tie in the tropics, a timber
-- notice in temperate, adobe-and-cloth in the arid belt, tarred pine posts in the north.
local OUTBREAK_BIOME = {
  -- Board spans are given in WORLD units; one world unit is 2 screen px, so a board of 4 is ~8 px
  -- across screen. The delivered lots expose only a narrow sliver of free paving in front of the
  -- building, so the notice has to be a SMALL street-level object to stand on real ground.
  tropical = { seed = 71, post = 'thatch', h = 5, wide = 4, tall = 3 },
  temperate = { seed = 73, post = 'timber', h = 5, wide = 4, tall = 3 },
  arid = { seed = 79, post = 'adobe', h = 4, wide = 3, tall = 3 },
  northern = { seed = 83, post = 'pine', h = 6, wide = 4, tall = 3 },
}

local function outbreakPalette(L, theme, bio)
  local post, trim
  if bio.post == 'thatch' then
    post, trim = L.C.WHEAT, L.C.WOOD          -- lashed thatch bundle on a wood stake
  elseif bio.post == 'adobe' then
    post, trim = L.C.CONCRETE, L.C.PLASTER     -- sun-dried adobe pier
  elseif bio.post == 'pine' then
    post, trim = L.C.WOOD, L.C.CONCRETE        -- tarred pine, dark and slim
  else
    post, trim = L.C.WOOD, L.C.CONCRETE        -- ordinary timber
  end
  return {
    post = post[3],
    postDark = post[2],
    trim = trim[3],
    board = L.C.PLASTER[5],        -- pale notice board face
    boardEdge = L.C.PLASTER[3],
    boardDark = L.C.PLASTER[2],
    ink = L.C.WOOD[1],             -- the abstract mark and lettering strokes
    inkLight = L.C.WOOD[3],
    cloth = theme.roof[4],         -- tied cloth marker
    clothDark = theme.roof[2],
    rope = L.C.WHEAT[3],           -- cordage
    ropeDark = L.C.WHEAT[2],
    herb = theme.leaf[3],          -- sealed bundle of herbs
  }
end

-- A single upright post standing ON the ground: foot at world z = 0, so it can never float. Returns
-- nothing; ownership is tracked by the enclosing stormBegin/stormEnd.
-- Projected screen bbox of a post standing at (i, j) with height h, used by the validator to
-- prove elevated pieces hang from a real post and that ropes meet their posts at both ends.
local function postBBox(L, c, i, j, h, thick)
  -- Real projected bbox of a post: sample its four vertical corners at z = 0 and z = h and take the
  -- screen extrema. A hand-guessed box would make the "is it attached" test meaningless.
  local w = thick or 2
  local x0, x1, y0, y1 = math.huge, -math.huge, math.huge, -math.huge
  for _, corner in ipairs({ { i, j }, { i + w, j }, { i + w, j + w }, { i, j + w } }) do
    for _, z in ipairs({ 0, h }) do
      local p = L.P(c, corner[1], corner[2], z)
      x0 = math.min(x0, p[1]); x1 = math.max(x1, p[1])
      y0 = math.min(y0, p[2]); y1 = math.max(y1, p[2])
    end
  end
  return { math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1) }
end

local function outbreakPost(L, ctx, i, j, h, pal, thick)
  local c = ctx.details
  i, j = even(i), even(j)
  local w = thick or 2
  -- the post itself, foot on the ground plane
  stormQuad(L, c, { { i, j, 0 }, { i + w, j, 0 }, { i + w, j + w, h }, { i, j + w, h } },
    pal.post)
  -- a darker shaded edge so it reads as a round-ish stake rather than a flat card
  stormQuad(L, c, { { i + w, j, 0 }, { i + w + 1, j, 0 }, { i + w + 1, j + w, h },
                    { i + w, j + w, h } }, pal.postDark)
  -- a footing band where it meets the earth
  stormQuad(L, c, { { i, j, 0 }, { i + w + 1, j, 0 }, { i + w + 1, j + w, 1 },
                    { i, j + w, 1 } }, pal.trim)
end

-- The notice board: a small pale panel with a dark rim, hung on a post at world height z. The panel
-- carries a simple ABSTRACT device (a ring of dots) - deliberately not a cross or any real emblem.
local function outbreakBoard(L, ctx, i, j, z, wide, tall, pal)
  local c = ctx.details
  i, j, z = even(i), even(j), even(z)
  -- rim, then the face inset by one unit on each side
  stormQuad(L, c, { { i, j, z }, { i + wide, j, z }, { i + wide, j + 1, z + tall },
                    { i, j + 1, z + tall } }, pal.boardEdge)
  stormQuad(L, c, { { i + 1, j, z + 1 }, { i + wide - 1, j, z + 1 },
                    { i + wide - 1, j + 1, z + tall - 1 }, { i + 1, j + 1, z + tall - 1 } },
    pal.board)
  -- abstract device: a small ring of dots, four around an empty centre. No cross, no lettering.
  local cx, cz = i + math.floor(wide / 2), z + math.floor(tall / 2)
  for _, o in ipairs({ { -1, 0 }, { 1, 0 }, { 0, -1 }, { 0, 1 } }) do
    stormQuad(L, c, { { cx + o[1], j, cz + o[2] }, { cx + o[1] + 1, j, cz + o[2] },
                      { cx + o[1] + 1, j + 1, cz + o[2] }, { cx + o[1], j + 1, cz + o[2] } },
      pal.ink)
  end
  -- two short strokes below the device, suggesting a written notice without spelling anything
  for k = 0, 1 do
    stormQuad(L, c, { { i + 2, j, z + 2 - k }, { i + wide - 2, j, z + 2 - k },
                      { i + wide - 2, j + 1, z + 2 - k }, { i + 2, j + 1, z + 2 - k } },
      pal.inkLight)
  end
end

-- A tied cloth marker hanging from a post: gathered at the top where it is tied, ragged at the
-- bottom. The gather lies ON the post, so the cloth is attached rather than floating.
local function outbreakCloth(L, ctx, i, j, z, wide, tall, pal, rnd)
  local c = ctx.details
  i, j, z = even(i), even(j), even(z)
  -- the tie: a narrow band wrapped around the post at this height
  stormQuad(L, c, { { i - 1, j, z + tall }, { i + 2, j, z + tall },
                    { i + 2, j + 2, z + tall + 1 }, { i - 1, j + 2, z + tall + 1 } }, pal.rope)
  -- the cloth falls from the tie
  stormQuad(L, c, { { i, j, z + tall }, { i + wide, j, z + tall },
                    { i + wide, j + 2, z }, { i, j + 2, z } }, pal.cloth)
  stormQuad(L, c, { { i, j, z + tall }, { i + wide, j, z + tall },
                    { i + wide, j + 1, z + tall - 1 }, { i, j + 1, z + tall - 1 } },
    pal.clothDark)
  -- a ragged hem: knock single pixels out of the last rows
  for k = 0, wide - 1 do
    if rnd(3) == 0 then
      stormQuad(L, c, { { i + k, j, z }, { i + k + 1, j, z },
                        { i + k + 1, j + 2, z + 1 }, { i + k, j + 2, z + 1 } }, pal.clothDark)
    end
  end
end

-- A sealed bundle of herbs tied to a post: a compact parcel bound with cord. Small, at head height.
local function outbreakBundle(L, ctx, i, j, z, pal, rnd)
  local c = ctx.details
  i, j, z = even(i), even(j), even(z)
  stormQuad(L, c, { { i, j, z }, { i + 3, j, z }, { i + 3, j + 2, z + 3 }, { i, j + 2, z + 3 } },
    pal.herb)
  -- cord binding, two wraps
  for k = 0, 1 do
    stormQuad(L, c, { { i - 1, j, z + 1 + k }, { i + 4, j, z + 1 + k },
                      { i + 4, j + 2, z + 2 + k }, { i - 1, j + 2, z + 2 + k } }, pal.rope)
  end
  if rnd(2) == 0 then
    stormQuad(L, c, { { i, j, z + 3 }, { i + 2, j, z + 3 }, { i + 2, j + 1, z + 4 },
                      { i, j + 1, z + 4 } }, pal.herb)
  end
end

-- A rope strung between TWO real posts. Every pixel of the rope lies between the two, and the
-- validator checks both ends actually meet a post: a ladder of short quads, never a floating curve.
local function outbreakRope(L, ctx, ia, ja, ib, jb, z, pal, rnd)
  local c = ctx.details
  local steps = math.max(math.abs(ib - ia), math.abs(jb - ja)) * 2
  if steps <= 0 then return end
  for k = 0, steps do
    local t = k / steps
    local i = even(math.floor(ia + (ib - ia) * t))
    local j = math.floor(ja + (jb - ja) * t)
    -- one unit of slack: the rope dips slightly in the middle, which is what a real cord does
    local sag = math.floor(math.sin(t * math.pi) * 1.5)
    stormQuad(L, c, { { i, j, z - sag }, { i + 1, j, z - sag },
                      { i + 1, j + 1, z - sag + 1 }, { i, j + 1, z - sag + 1 } },
      (k % 2 == 0) and pal.rope or pal.ropeDark)
  end
end

-- A stake: a short pointed post driven into the ground, for the rope barrier.
local function outbreakStake(L, ctx, i, j, h, pal)
  local c = ctx.details
  i, j = even(i), even(j)
  stormQuad(L, c, { { i, j, 0 }, { i + 2, j, 0 }, { i + 2, j + 2, h }, { i, j + 2, h } },
    pal.postDark)
  stormQuad(L, c, { { i, j, 0 }, { i + 2, j, 0 }, { i + 2, j + 2, 1 }, { i, j + 2, 1 } },
    pal.trim)
end


-- Outbreak metadata: the same record shape as stormMeta, plus the post bboxes and rope endpoints the
-- outbreak validator needs to prove support. Kept as a SEPARATE helper so stormMeta stays
-- byte-for-byte identical for storm/flood/drought.
local function outbreakMeta(key, biome, outDir, w, h, gx, gy)
  if not outDir then
    error('outbreak_sign: no metadata destination (pass --script-param meta=<dir>)')
  end
  local fh = io.open(outDir .. '/' .. key .. '_' .. biome .. '.json', 'w')
  if not fh then
    error('outbreak_sign: cannot write metadata to ' .. outDir)
  end
  local parts = {}
  for _, p in ipairs(STORM_STAMPS.pieces) do
    local xy = {}
    for k = 1, p.n do
      xy[#xy + 1] = p.sx[k][1]
      xy[#xy + 1] = p.sx[k][2]
    end
    local extra = ''
    if p.posts then
      local bs = {}
      for _, post in ipairs(p.posts) do
        local b = post.bbox
        bs[#bs + 1] = string.format('[%d,%d,%d,%d]', b[1], b[2], b[3], b[4])
      end
      extra = ',"posts":[' .. table.concat(bs, ',') .. ']'
    end
    if p.rope_ends then
      local es = {}
      for _, e in ipairs(p.rope_ends) do es[#es + 1] = e and 'true' or 'false' end
      extra = extra .. ',"rope_ends":[' .. table.concat(es, ',') .. ']'
    end
    parts[#parts + 1] = string.format(
      '{"class":"%s","kind":"%s","anchor":[%s,%s,%s],"px":%d,"stamps":[%s]%s}',
      p.class, p.kind, p.anchor[1], p.anchor[2], p.anchor[3], p.n,
      table.concat(xy, ','), extra)
  end
  fh:write('{"key":"' .. key .. '","biome":"' .. biome .. '","size":[' .. w .. ',' .. h
    .. '],"gx":' .. gx .. ',"gy":' .. gy
    .. ',"pieces":[' .. table.concat(parts, ',') .. ']}')
  fh:close()
end

-- ---------------------------------------------------------------- repair scaffold
-- What repair actually is in this game (src/domain/events/disasters.ts, the 'rebuilding' stage):
-- each funded step spends 1 timber and 120 cents of labour and restores 800 condition points; with
-- no timber or no funds the repair STALLS and a 'repair_blocked' event fires. So a scaffold means
-- "this building is being repaired", and it must read as standing idle while the work waits. It is
-- NOT a statement that the building is ruined, and it must never hide or replace it.
--
-- Therefore: no fire, soot, flood stain, mud, rubble, collapse, cracks, bodies or workers. No active
-- animation. Nothing is cut into the building - no boarding, no window changes, no holes.
--
-- Geometry is built in WORLD coordinates, as the accepted art/generated/damage-proof proof
-- established after review: explicit world (i, j, z) for footings, posts, platforms, rails and
-- braces, and ONE CONSTANT WORLD z per platform projected with the 2:1 projection. The original
-- draft forced one SCREEN y for every platform endpoint, which is not level in world space on a 2:1
-- frontage - measured platform heights came out 121/131/141/133/125 across five posts.
--
-- ---- THE SHAPE: bays running ALONG a facade, not a single column
-- A scaffold is a lattice: a row of uprights with platforms, toe rails and diagonal bracing spanning
-- between them. The first cut of this branch drew one narrow column (10/14/18 px wide) which read as
-- a ladder or a mast, and the review was right. The row of uprights now runs along the world i axis,
-- which on screen runs diagonally across the frontage, so N posts read as a frame rather than a pole.
--
-- ---- THE HEIGHT: measured from the building that will receive it
-- A 3x3 cottage must not get a scaffold taller than itself. The recipe cannot see a mask, so the cap
-- comes from the OVERLAY's own canvas, which is what actually limits how much building this sprite
-- has to cover: profile[h] is the lot depth the canvas can show at screen row h, and the row where
-- profile[h] drops below the lot's footprint depth is exactly where the camera plane rises above the
-- ground. Above that row the wall is behind the camera plane, so a scaffold may rise until it would
-- leave the canvas. The drawn top is then held to TOP_FRACTION of the room above the foot, which
-- keeps a small lot's single-platform repair at roughly half the building's height and a megatall
-- tower's scaffold on its LOWER STOREYS - never an invented full-height cage.
--
-- ---- IN FRONT, AND PROVABLE
-- x = gx + i - j and y = gy + (i + j)/2 - z. Along the view ray both x and y are fixed only when
-- (di, dj, dz) = (t, t, t), so at a shared pixel the surface with the LARGER world z is the NEARER
-- one. That is a derivation from the projection, not a convention, and compose.py uses it to prove
-- every wall/roof pixel the scaffold covers is genuinely in front of it.
--
-- Reuses the accepted ownership-stamping helpers (stormBegin/stormEnd/stormQuad) so exact per-pixel
-- provenance comes for free. Every helper below is NEW.

-- Severity is legible in WIDTH first and height second: bays grow 2 -> 3 -> 4, levels 1 -> 2 -> 2.
-- Height also grows but stays inside the measured cap, so severe is a bigger frame, not a taller pole.
local REPAIR_SEVERITY = {
  light    = { bays = 2, levels = 1, tarp = 0, store = 1, frac = 0.55, span = 0.60 },
  moderate = { bays = 3, levels = 2, tarp = 1, store = 2, frac = 0.78, span = 0.80 },
  severe   = { bays = 4, levels = 2, tarp = 2, store = 3, frac = 1.00, span = 1.00 },
}

-- Biome differences are material AND SHAPE, never a recolour: lashed bamboo in the tropics, squared
-- timber in temperate, mud-brick pier and timber in the arid belt, tarred pine in the north.
local REPAIR_BIOME = {
  tropical  = { seed = 131, post = 'bamboo', brace = 'x', tie = 'lash' },
  temperate = { seed = 137, post = 'timber', brace = 'diag', tie = 'nail' },
  arid      = { seed = 139, post = 'mudbrick', brace = 'diag', tie = 'lash' },
  northern  = { seed = 149, post = 'pine', brace = 'x', tie = 'nail' },
}

local function repairPalette(L, theme, bio)
  local post, deck, deckLit, tie
  if bio.post == 'bamboo' then
    post = L.C.WHEAT
    deck, deckLit = L.C.WOOD[3], L.C.WOOD[4]
    tie = L.C.FOLIAGE[3]
  elseif bio.post == 'mudbrick' then
    post = L.C.CONCRETE
    deck, deckLit = L.C.DIRT[4], L.C.DIRT[5]
    tie = L.C.WHEAT[3]
  elseif bio.post == 'pine' then
    post = L.C.WOOD
    deck, deckLit = L.C.WOOD[2], L.C.WOOD[3]
    tie = L.C.STEEL[3]
  else
    post = L.C.WOOD
    deck, deckLit = L.C.WOOD[3], L.C.WOOD[4]
    tie = L.C.WHEAT[3]
  end
  return {
    post = post[3], postDark = post[2], postLit = post[4],
    deck = deck, deckLit = deckLit, deckDark = L.C.WOOD[2],
    tie = tie, rope = L.C.WHEAT[3],
    tarp = theme.roof[4], tarpDark = theme.roof[2],
    stone = L.C.CONCRETE[3], stoneDark = L.C.CONCRETE[2],
    tool = L.C.STEEL[4], toolDark = L.C.STEEL[2],
  }
end

-- Record the world box a piece occupies, so the review tool can solve for the piece's depth at any
-- pixel it paints (see validate_facade_relation) instead of trusting a number the recipe chose.
-- Boxes are padded by one world unit on every side. The quads are rasterised by pixel-centre
-- inclusion, so a quad's boundary pixels belong to the piece even though its world corner stops at
-- the edge; a box recorded exactly to the corner therefore calls the piece's own edge pixels "outside
-- its geometry" and makes the front-ness proof fail on correct art. The pad is the honest statement
-- of what the rasteriser actually paints, and it is uniform so it cannot hide a real mismatch.
local function repairBox(cur, i0, i1, j0, j1, z0, z1)
  if cur then cur.box = { i0 - 1, i1 + 1, j0 - 1, j1 + 1, z0, z1 + 1 } end
  return cur
end

-- ---- world-space pieces. Everything is a quad at explicit (i, j, z) so nothing can float.
-- Returns the world box ACTUALLY DRAWN. The even() snap below is easy to forget when recording
-- metadata, and a box that disagrees with the geometry makes the front-ness proof meaningless.
local function repairPost(L, c, i, j, z0, z1, w, pal)
  i, j = even(i), even(j)
  -- two faces of a square post, so it reads as timber rather than a flat card
  stormQuad(L, c, { { i, j, z0 }, { i + w, j, z0 }, { i + w, j, z1 }, { i, j, z1 } }, pal.post)
  stormQuad(L, c, { { i + w, j, z0 }, { i + w, j + w, z0 }, { i + w, j + w, z1 },
                    { i + w, j, z1 } }, pal.postDark)
  -- a footing plate on the ground: the post visibly rests on something
  stormQuad(L, c, { { i - 1, j - 1, 0 }, { i + w + 1, j - 1, 0 }, { i + w + 1, j + w + 1, 0 },
                    { i - 1, j + w + 1, 0 } }, pal.stoneDark)
  return { i - 1, i + w + 1, j - 1, j + w + 1, 0, z1 }
end

local function repairDeck(L, c, i0, i1, j0, j1, z, pal)
  -- ONE constant world z for the whole platform: level by construction
  stormQuad(L, c, { { i0, j0, z }, { i1, j0, z }, { i1, j1, z }, { i0, j1, z } }, pal.deck)
  -- a lit front lip so the deck reads as a plank surface with thickness
  stormQuad(L, c, { { i0, j1, z }, { i1, j1, z }, { i1, j1, z - 1 }, { i0, j1, z - 1 } }, pal.deckLit)
  stormQuad(L, c, { { i1, j0, z }, { i1, j1, z }, { i1, j1, z - 1 }, { i1, j0, z - 1 } }, pal.deckDark)
  -- plank seams across the deck, so a flat platform does not read as a solid slab
  local n = math.max(1, math.floor((i1 - i0) / 4))
  for k = 1, n do
    local i = i0 + (i1 - i0) * k / (n + 1)
    stormQuad(L, c, { { i, j0, z }, { i + 1, j0, z }, { i + 1, j1, z }, { i, j1, z } },
      (k % 2 == 0) and pal.deckDark or pal.deckLit)
  end
end

local function repairRail(L, c, i0, i1, j, z, pal)
  stormQuad(L, c, { { i0, j, z }, { i1, j, z }, { i1, j + 1, z }, { i0, j + 1, z } }, pal.deckDark)
  -- a second, thinner rail below the top one: the toe board a real scaffold carries
  stormQuad(L, c, { { i0, j, z - 3 }, { i1, j, z - 3 }, { i1, j + 1, z - 3 }, { i0, j + 1, z - 3 } },
    pal.deckLit)
end

local function repairBrace(L, c, i0, j0, z0, i1, j1, z1, pal)
  -- A real diagonal between two distinct world points, sampled along the true 3-D line. The original
  -- draft interpolated identical platform y values, so its "braces" merely redrew horizontal rails.
  local n = math.max(4, math.floor(math.abs(z1 - z0) + math.abs(i1 - i0) + math.abs(j1 - j0)))
  for k = 0, n do
    local t = k / n
    local i = i0 + (i1 - i0) * t
    local j = j0 + (j1 - j0) * t
    local z = z0 + (z1 - z0) * t
    stormQuad(L, c, { { i, j, z }, { i + 1, j, z }, { i + 1, j + 1, z }, { i, j + 1, z } },
      (k % 2 == 0) and pal.postLit or pal.post)
  end
end

local function repairTarp(L, c, i0, i1, j, zTop, pal)
  -- a draped tarp hanging from the top rail, with a slack fold at the hem
  stormQuad(L, c, { { i0, j, zTop }, { i1, j, zTop }, { i1, j + 1, zTop - 5 },
                    { i0, j + 1, zTop - 5 } }, pal.tarp)
  stormQuad(L, c, { { i0, j + 1, zTop - 5 }, { i1, j + 1, zTop - 5 }, { i1, j + 2, zTop - 6 },
                    { i0, j + 2, zTop - 6 } }, pal.tarpDark)
end

local function repairStore(L, c, i, j, pal, rnd)
  -- stacked planks waiting to be used: flat on the ground, so they need no support
  local n = 1 + rnd(2)
  for k = 0, n do
    stormQuad(L, c, { { i, j - k, 1 + k * 2 }, { i + 8, j - k, 1 + k * 2 },
                      { i + 8, j - k + 2, 1 + k * 2 }, { i, j - k + 2, 1 + k * 2 } },
      (k % 2 == 0) and pal.deckLit or pal.deck)
  end
  -- one tool leaning on the pile: a haft and a head, kept within the stack's own depth so nothing
  -- pokes through the lot's near boundary wall (a wall the scaffold must stay behind, not cover)
  stormQuad(L, c, { { i + 1, j, 1 }, { i + 2, j, 1 }, { i + 2, j, 7 },
                    { i + 1, j, 7 } }, pal.toolDark)
  stormQuad(L, c, { { i, j, 7 }, { i + 3, j, 7 }, { i + 3, j + 1, 8 },
                    { i, j + 1, 8 } }, pal.tool)
end

-- How tall this overlay is allowed to be.
--
-- The recipe cannot read a building mask, so it needs a defensible proxy for "the building that will
-- receive this sprite". The best one available is the OVERLAY'S OWN CANVAS: the catalog sizes each
-- overlay to the building class it serves, so canvas height is the only statement the recipe has
-- about how much building it has to cover. World z is in screen pixels (the projection subtracts z
-- directly), so a cap expressed as a fraction of canvas height converts straight to world units.
--
-- Calibrated against the buildings this overlay actually serves, measured from their masks:
--   canvas  1024px-> building    cap @ severe    ratio
--   3x3_104  cottage 60px  ->  ~21            35%   (a low local repair)
--   3x3_224  cottage 60px  ->  ~45            75%   (still shorter than the building)
--   4x4_352  home_4 112px  ->  ~70            63%
--   8x8_768  tower  660px  ->  ~154            23%   (lower storeys only)
-- Every one stays below its building, and the small lot never gets a scaffold taller than itself.
-- Two independent bounds, because either alone over- or under-shoots on one of the classes:
--   * canvas height  - tells us the building class the sprite was cut for, but the two 3x3 canvases
--                      (104 and 224) serve the SAME cottage, so on its own it lets the 224 variant
--                      build taller than the building it covers (measured: 71 px against 60 px);
--   * lot size (A)   - a 3x3 lot is a cottage whatever canvas it is drawn on, so lot depth stops that.
-- The smaller of the two is used. Measured screen heights against the delivered buildings:
--   3x3_104 47px vs cottage 60px | 3x3_224 47px vs 60px | 4x4_352 ~60px vs home_4 112px
--   6x6/8x8 ~80-105px vs tower 660px  (lower storeys only, never a full-height cage)
local function repairHeightCap(Hc, A, sev)
  local byCanvas = Hc * 0.20
  local byLot = A * 0.42
  local base = math.min(byCanvas, byLot)
  return math.max(8, math.floor(base * sev.frac))
end

local function repairMeta(key, biome, outDir, w, h, gx, gy, world)
  if not outDir then
    error('repair_scaffold: no metadata destination (pass --script-param meta=<dir>)')
  end
  local fh = io.open(outDir .. '/' .. key .. '_' .. biome .. '.json', 'w')
  if not fh then
    error('repair_scaffold: cannot write metadata to ' .. outDir)
  end
  local parts = {}
  for _, p in ipairs(STORM_STAMPS.pieces) do
    local xy = {}
    for k = 1, p.n do
      xy[#xy + 1] = p.sx[k][1]
      xy[#xy + 1] = p.sx[k][2]
    end
    local extra = ''
    if p.posts then
      local ps = {}
      for _, post in ipairs(p.posts) do
        if post[3] ~= nil then
          ps[#ps + 1] = string.format('[%s,%s,%s,%s]', post[1], post[2], post[3], post[4])
        else
          ps[#ps + 1] = string.format('[%s,%s]', post[1], post[2])
        end
      end
      extra = ',"posts":[' .. table.concat(ps, ',') .. ']'
    end
    if p.box then
      extra = extra .. string.format(',"box":[%s,%s,%s,%s,%s,%s]',
        p.box[1], p.box[2], p.box[3], p.box[4], p.box[5], p.box[6])
    end
    parts[#parts + 1] = string.format(
      '{"class":"%s","kind":"%s","anchor":[%s,%s,%s],"px":%d,"stamps":[%s]%s}',
      p.class, p.kind, p.anchor[1], p.anchor[2], p.anchor[3], p.n,
      table.concat(xy, ','), extra)
  end
  local wl = {}
  for _, q in ipairs(world.verts) do
    wl[#wl + 1] = string.format('{"i":%s,"j":%s,"z":%s,"kind":"%s"}', q[1], q[2], q[3], q[4])
  end
  local plats = {}
  for _, pl in ipairs(world.platforms) do
    local sup = {}
    for _, s2 in ipairs(pl.supports) do sup[#sup + 1] = string.format('[%s,%s]', s2[1], s2[2]) end
    plats[#plats + 1] = string.format(
      '{"z":%s,"i0":%s,"i1":%s,"j0":%s,"j1":%s,"supports":[%s]}',
      pl.z, pl.i0, pl.i1, pl.j0, pl.j1, table.concat(sup, ','))
  end
  local braces = {}
  for _, b in ipairs(world.braces) do
    braces[#braces + 1] = string.format('[[%s,%s,%s],[%s,%s,%s]]',
      b[1], b[2], b[3], b[4], b[5], b[6])
  end
  -- `near` records, for every piece, a world point ON that piece: the receiver test uses it to prove
  -- the piece really is in front of whatever wall pixel it covers.
  fh:write('{"key":"' .. key .. '","biome":"' .. biome .. '","size":[' .. w .. ',' .. h
    .. '],"gx":' .. gx .. ',"gy":' .. gy
    .. ',"lot":[' .. world.lotA .. ',' .. world.lotD .. ']'
    .. ',"facade_j":' .. world.facadeJ
    .. ',"standoff":' .. world.standoff
    .. ',"height_cap":' .. world.heightCap
    .. ',"platforms":[' .. table.concat(plats, ',') .. ']'
    .. ',"braces":[' .. table.concat(braces, ',') .. ']'
    .. ',"world":[' .. table.concat(wl, ',') .. ']'
    .. ',"pieces":[' .. table.concat(parts, ',') .. ']}')
  fh:close()
end

-- The repair scaffold itself.
local function repairDraw(L, c, theme, s)
  local A, D = s.A, s.B
  local gx = s.pivot.x - A + D
  local gy = s.pivot.y - (A + D) / 2
  local sev = REPAIR_SEVERITY[s.visualState] or REPAIR_SEVERITY.moderate
  local bio = REPAIR_BIOME[s.biome] or REPAIR_BIOME.temperate
  local rnd = rng(bio.seed * 7919 + s.width * 31 + s.height * 17
    + (s.visualState == 'severe' and 3 or s.visualState == 'light' and 1 or 2))
  local pal = repairPalette(L, theme, bio)

  -- ---- WHERE IT STANDS. build.lua puts the lot corner at maximum (i + j) on the sprite's pivot, so
  -- LARGER i + j projects LOWER on screen and is NEARER the viewer. Depth is therefore i + j + z, and
  -- larger is nearer. A screen row is shared by points differing by t*(1,1,1), whose depth differs by
  -- 3t, so at a shared pixel the larger z (or the larger j) is the nearer surface.
  --
  -- The buildings these overlays serve present a front wall at constant j set back inside the lot
  -- (measured: j ~ 118 of 128 on the towers, j ~ 42 of 48 on the cottages), and the verified ground in
  -- front of that face is at LARGER j, on the near apron. Standing the scaffold on that apron is both
  -- physically right and what makes "in front" provable.
  --
  -- A post spans j..j+2 and its footing plate reaches j+3, so jp names the upright's near column and
  -- jp + 3 the bottom-most drawn row. jp = D - 6 keeps that row on the apron at D - 3.
  local DECK_D = 2
  local OFFSET_J = 6
  local jp = even(D - OFFSET_J)
  local facadeJ = jp - 2

  -- ---- HEIGHT, measured against the building this sprite has to cover.
  -- The drawn top is limited so it never towers over its own building: the overlay canvas already
  -- encodes how much building it covers, so the cap is the fraction of the addressable screen room
  -- above the foot that this severity is allowed to use.
  -- rows of canvas above the foot, so the scaffold can never leave the sprite
  local footY = gy + (A / 2 + jp) / 2
  local room = math.max(8, math.floor(footY) - 6)
  local zTopCap = math.min(repairHeightCap(s.height, A, sev), room)

  local nLevels = sev.levels
  local levels = {}
  for k = 1, nLevels do
    local z = math.floor(zTopCap * (k / nLevels))
    z = z - (z % 2)
    if z < 8 then z = 8 end
    levels[#levels + 1] = z
  end
  local zTop = levels[#levels]

  -- ---- BAYS ALONG THE FACADE. Several uprights spread across the frontage, not one column: the
  -- review measured the previous attempt at 10/14/18 px wide and called it a ladder. Spacing grows
  -- with severity so severe is unmistakably wider on screen, and the row is kept inside the lot.
  -- The span is capped by the LOT, not only by a fraction of it: on a 3x3 cottage the free apron is a
  -- run of about 16 world units before the building's own wing splits it, so a span wider than that
  -- puts posts on the building. Moderate therefore uses a shorter span than its bay count would
  -- otherwise suggest, keeping 3 bays inside the available frontage.
  -- Bay count is also capped by the apron: with a span of ~16 world units a small cottage can carry
  -- three uprights comfortably and five only by crowding them onto the building's own wing. The bay
  -- count therefore never exceeds what the span can space evenly at >= 4 units per bay.
  -- Severity must be legible in WIDTH, so the span itself grows with severity, but it is still
  -- capped by the apron: on a small cottage the frame cannot spread past the free run in front of the
  -- building without standing on it. Light/Moderate/Severe therefore step 60% -> 80% -> 100% of the
  -- available width, which is a visible widening on every class.
  local apronCap = even(math.floor(A * 0.42))
  local span = even(math.floor(apronCap * sev.span))
  if span < 10 then span = 10 end
  if span > A - 6 then span = even(A - 6) end
  -- bays are spaced at >= 6 units so the frame reads as a lattice, not a picket fence
  local bays = math.min(sev.bays, math.max(2, math.floor(span / 6)))
  if bays < 2 then bays = 2 end
  local i0 = even(math.floor((A - span) / 2))
  local i1 = i0 + span
  if i1 > A - 2 then i1 = A - 2 end
  local postI = {}
  for k = 0, bays do
    postI[#postI + 1] = even(i0 + math.floor(span * k / bays))
  end

  local world = { verts = {}, platforms = {}, braces = {}, lotA = A, lotD = D,
                  facadeJ = facadeJ, standoff = OFFSET_J, heightCap = zTopCap }

  -- ---- draw order: posts first, then decks (a deck must never hide its own posts' feet)
  for _, i in ipairs(postI) do
    stormBegin('ground', 'post', { i, jp, 0 })
    local pbox = repairPost(L, c.details, i, jp, 0, zTop + 6, 2, pal)
    STORM_PIECE.posts = { { i, jp, 0, zTop + 6 } }
    repairBox(STORM_PIECE, pbox[1], pbox[2], pbox[3], pbox[4], pbox[5], pbox[6])
    stormEnd()
    world.verts[#world.verts + 1] = { i, jp, 0, 'foot' }
    world.verts[#world.verts + 1] = { i, jp, zTop + 6, 'posthead' }
  end

  -- diagonal bracing in every bay: a real 3-D brace with both ends on a post
  for k = 1, bays do
    local ia, ib = postI[k], postI[k + 1]
    local za, zb
    if bio.brace == 'x' and #levels > 1 then
      za, zb = levels[1], levels[#levels]
    else
      za, zb = 0, zTop
    end
    stormBegin('ground', 'brace', { ia, jp, za })
    repairBrace(L, c.details, ia, jp, za, ib, jp, zb, pal)
    repairBox(STORM_PIECE, ia, ib, jp, jp + 1, math.min(za, zb), math.max(za, zb))
    stormEnd()
    world.braces[#world.braces + 1] = { ia, jp, za, ib, jp, zb }
  end

  -- ---- a full deck and toe rail at every level
  for _, z in ipairs(levels) do
    stormBegin('ground', 'deck', { i0, jp, z })
    repairDeck(L, c.details, i0, i1, jp, jp + DECK_D, z, pal)
    local sup = {}
    for _, i in ipairs(postI) do sup[#sup + 1] = { i, jp } end
    STORM_PIECE.posts = sup
    -- the deck paints its top face at z and a lit/thickness lip at j1 dropping to z-1, and its plank
    -- seams are 1 unit wide in i, so the honest box is one unit proud on every side of the surface
    repairBox(STORM_PIECE, i0, i1 + 1, jp, jp + DECK_D + 1, z - 1, z)
    stormEnd()
    world.platforms[#world.platforms + 1] =
      { z = z, i0 = i0, i1 = i1, j0 = jp, j1 = jp + DECK_D, supports = sup }

    stormBegin('ground', 'rail', { i0, jp, z + 6 })
    repairRail(L, c.details, i0, i1, jp, z + 6, pal)
    STORM_PIECE.posts = { { i0, jp, 0, z + 6 } }
    -- repairRail paints the top rail at z and a toe board three units below it, so the box spans both
    repairBox(STORM_PIECE, i0, i1 + 1, jp, jp + 2, z - 3, z + 6)
    stormEnd()
    world.verts[#world.verts + 1] = { i0, jp, z + 6, 'rail' }
    world.verts[#world.verts + 1] = { i1, jp, z + 6, 'rail' }
  end

  -- ---- tarps over the upper bays
  for k = 1, sev.tarp do
    local ia = postI[k]
    local ib = postI[k + 1] or postI[#postI]
    if ia and ib and ib > ia then
      stormBegin('ground', 'tarp', { ia, jp, zTop + 6 })
      repairTarp(L, c.details, ia, ib, jp, zTop + 6, pal)
      STORM_PIECE.posts = { { ia, jp, 0, zTop + 6 }, { ib, jp, 0, zTop + 6 } }
      repairBox(STORM_PIECE, ia, ib, jp, jp + 2, zTop, zTop + 6)
      stormEnd()
    end
  end

  -- ---- stored material at the base, on the ground BESIDE the uprights.
  -- It sits at the same near-side j as the frame (not further out), because anything placed nearer
  -- than the apron row would have to stand on ground the apron does not have, and the front-ness test
  -- rightly refuses a stack whose depth is behind the wall it overlaps.
  for k = 1, sev.store do
    local i = i0 + (k - 1) * 10
    if i + 8 <= A - 2 then
      stormBegin('ground', 'store', { i, jp, 1 })
      repairStore(L, c.details, i, jp, pal, rnd)
      -- the stack grows backward (j - k) but the leaning tool reaches j + 2, so the box must span that
      repairBox(STORM_PIECE, i, i + 9, jp - 3, jp + 1, 1, 9)
      stormEnd()
    end
  end

  repairMeta(s.key, s.biome, app.params.meta, s.width, s.height, gx, gy, world)
end

local function outbreakDraw(L, c, theme, s)
  local A, D = s.A, s.B
  local gx = s.pivot.x - A + D
  local gy = s.pivot.y - (A + D) / 2
  local sev = OUTBREAK_SEVERITY[s.visualState] or OUTBREAK_SEVERITY.moderate
  local bio = OUTBREAK_BIOME[s.biome] or OUTBREAK_BIOME.temperate
  local rnd = rng(bio.seed * 7919 + s.width * 31 + s.height * 17
    + (s.visualState == 'severe' and 3 or s.visualState == 'light' and 1 or 2))
  local pal = outbreakPalette(L, theme, bio)

  -- The marker stands on the ground in FRONT of the building: the near corner of the reserved lot,
  -- where an entrance faces the street. Everything is at world z >= 0, growing upward only.
  local inset = math.max(6, math.floor(math.min(A, D) / 8))
  local mid = math.floor(A / 2)

  -- ---- the notice board on its post: the piece that is present at EVERY severity
  local bi = mid - math.floor(bio.wide / 2)
  -- The OUTER front edge of the lot, so the marker stands clear of the building mass on the
  -- paving by the entrance. bj = D-2 is the near corner row, the frontmost ground available.
  local bj = D - 2
  stormBegin('ground', 'post', { bi, bj, 0 })
  outbreakPost(L, ctx_of(c), bi, bj, bio.h, pal)
  stormEnd()

  -- The board hangs LOW on its post. At head height it interpenetrated the building mass behind the
  -- lot; a street-level notice is both more legible from the isometric camera and clear of the wall.
  local boardZ = 2
  stormBegin('ground', 'board', { bi - 1, bj, boardZ })
  -- record the post this board hangs from, so the validator can prove it is not floating
  STORM_PIECE.posts = { { bbox = postBBox(L, c.details, bi, bj, bio.h) } }
  outbreakBoard(L, ctx_of(c), bi - 1, bj, boardZ, bio.wide, bio.tall, pal)
  stormEnd()

  -- ---- severity ARRANGEMENT: cloth marker, herb bundle, then a rope barrier between stakes
  if sev.cloth > 0 then
    -- The cloth is TIED TO the notice post and hangs in the SAME column. Drawing it a few units to
    -- one side put it off the lot's narrow front paving, where it could not be placed at all; tied
    -- here it occupies the post's own columns, so wherever the post can stand, the cloth can hang.
    -- It hangs at STREET level (z = 0, a short drop), hugging the post's own columns. Hung higher,
    -- the cloth projected up into the building that rises behind the lot and interpenetrated it: an
    -- elevated mark at the lot's FRONT row lands on the storeys behind it in an isometric view.
    stormBegin('ground', 'cloth', { bi, bj, 0 })
    STORM_PIECE.posts = { { bbox = postBBox(L, c.details, bi, bj, bio.h) } }
    outbreakCloth(L, ctx_of(c), bi, bj, 0, 2, 2, pal, rnd)
    stormEnd()
  end

  if sev.stake > 0 then
    local hi = bi                     -- bundle ON the post column, like the cloth
    stormBegin('ground', 'bundle', { hi, bj, 1 })
    STORM_PIECE.posts = { { bbox = postBBox(L, c.details, hi, bj, bio.h) } }
    outbreakBundle(L, ctx_of(c), hi, bj, 1, pal, rnd)
    stormEnd()
  end

  if sev.barrier > 0 then
    -- two stakes with a rope between them: BOTH ends land on a post, by construction
    -- Stakes at the board's own ends: the cordon then spans exactly the board's columns, so it
    -- fits wherever the board fits. Spreading past the board put the cordon off the paving.
    local sa = bi
    local sb = bi + bio.wide - 2
    stormBegin('ground', 'stake', { sa, bj, 0 })
    outbreakStake(L, ctx_of(c), sa, bj, 5, pal)
    stormEnd()
    stormBegin('ground', 'stake', { sb, bj, 0 })
    outbreakStake(L, ctx_of(c), sb, bj, 5, pal)
    stormEnd()
    stormBegin('ground', 'rope', { sa, bj, 4 })
    -- BOTH ends of the rope are recorded against the two stakes it spans
    STORM_PIECE.posts = { { bbox = postBBox(L, c.details, sa, bj, 5) },
                            { bbox = postBBox(L, c.details, sb, bj, 5) } }
    STORM_PIECE.rope_ends = { true, true }
    outbreakRope(L, ctx_of(c), sa + 2, bj, sb, bj, 4, pal, rnd)
    stormEnd()
  end

  if sev.posts > 3 then
    -- one more free-standing marker post, so severe reads as a small cordon rather than a sign
    local pi = bi + bio.wide - 2           -- extra post at the board's far end
    stormBegin('ground', 'post', { pi, bj, 0 })
    outbreakPost(L, ctx_of(c), pi, bj, bio.h - 3, pal, 2)
    stormEnd()
  end

  outbreakMeta(s.key, s.biome, app.params.meta, s.width, s.height, gx, gy)
end

function F.draw(L, B, c, theme, s)
  local A, D = s.A, s.B
  local gx = s.pivot.x - A + D
  local gy = s.pivot.y - (A + D) / 2

  if s.kind == 'storm_debris' then
    stormDraw(L, c, theme, s)
    return
  end

  if s.kind == 'flood_stain' then
    floodDraw(L, c, theme, s)
    return
  end

  if s.kind == 'drought_ground' then
    droughtDraw(L, c, theme, s)
    return
  end

  if s.kind == 'outbreak_sign' then
    outbreakDraw(L, c, theme, s)
    return
  end

  if s.kind == 'repair_scaffold' then
    repairDraw(L, c, theme, s)
    return
  end

  if s.kind ~= 'fire_scorch' then
    -- other effects keep their untouched draft behaviour
    if s.kind == 'outbreak_sign' then
      local sign = L.box(c.details, A / 2 - 4, D - 10, 0, 8, 2, 8, L.C.WHITE)
      L.wallRect(c.details, sign, 'L', 2, 2, 4, 2, L.C.BARN[4])
      L.wallRect(c.details, sign, 'L', 4, 1, 2, 5, L.C.BARN[4])
    else
      local ramp = s.kind == 'flood_stain' and theme.water
        or s.kind == 'drought_ground' and L.C.DIRT or L.C.WOOD
      for n = 0, 4 do
        local i = 6 + (n * 8) % (A - 12)
        L.quad(c.details, { { i, D - 8, 0 }, { i + 4, D - 10, 0 }, { i + 6, D - 6, 0 }, { i + 2, D - 4, 0 } }, ramp[2])
      end
    end
    return
  end

  local pal = palette(L)
  local sev = SEVERITY[s.visualState] or SEVERITY.moderate
  local rnd = rng((BIOME_SEED[s.biome] or 17) * 7919 + s.width * 31 + s.height * 17
    + (s.visualState == 'severe' and 3 or s.visualState == 'light' and 1 or 2))
  local density = BIOME_DENSITY[s.biome] or 100

  -- Notional box inside the reserved lot: the marks must stay inside the footprint envelope.
  local inset = math.max(6, math.floor(math.min(A, D) / 8))
  local i0, j0 = inset, inset
  local i1, j1 = A - inset, D - inset

  -- Implied building top: the highest world z the canvas can show at the lot centre, then a
  -- little headroom so soot never sits on the canvas edge.
  local zTop = gy + A / 2 - 6
  local hTop = math.floor(zTop * 0.92)
  local hLow = math.floor(zTop * (0.92 - sev.reach))

  local function P(i, j, z) return L.P(c.details, i, j, z) end

  -- 1. roof-edge char: along both visible roof edges of the notional box
  for n = 1, sev.runs do
    local along = (n % 2 == 1)
    if along then
      local st = math.floor((i1 - i0) * sev.runSteps)
      local start = i0 + rnd(math.max(1, (i1 - i0) - st))
      local p = P(start, j1, hTop)
      charRun(L, c.details, p[1], p[2], st, 1, 0.5, pal, rnd)
    else
      local st = math.floor((j1 - j0) * sev.runSteps)
      local start = j0 + rnd(math.max(1, (j1 - j0) - st))
      local p = P(i1, start, hTop)
      charRun(L, c.details, p[1], p[2], st, -1, 0.5, pal, rnd)
    end
  end

  -- 2. coherent soot bodies, biased to the upper band of the envelope
  for n = 1, sev.clusters do
    local u = i0 + 4 + rnd(math.max(2, i1 - i0 - 8))
    local jj = (n % 2 == 0) and j1 or (j0 + 4 + rnd(math.max(2, j1 - j0 - 8)))
    local z = hLow + rnd(math.max(2, hTop - hLow))
    local p = P(u, jj, z)
    local r = sev.radius + rnd(2) - (n > 1 and 1 or 0)
    cluster(L, c.details, p[1], p[2], r, pal, rnd, density)
  end

  -- 3. drips: soot running down from the burning band. Down in WORLD z, so they stay vertical.
  for n = 1, sev.drips do
    local u = i0 + 4 + rnd(math.max(2, i1 - i0 - 8))
    local jj = (n % 2 == 0) and j1 or (j0 + 4 + rnd(math.max(2, j1 - j0 - 8)))
    local z = hLow + rnd(math.max(2, hTop - hLow))
    local p = P(u, jj, z)
    streak(L, c.details, p[1], p[2], 3 + rnd(2 + sev.radius), pal, rnd)
  end
end

return F
