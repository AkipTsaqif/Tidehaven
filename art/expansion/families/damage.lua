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

  if s.kind ~= 'fire_scorch' then
    -- other effects keep their untouched draft behaviour
    if s.kind == 'repair_scaffold' then
      for i = 6, A - 6, 8 do L.box(c.details, i, D - 8, 0, 2, 2, 18, L.C.WOOD) end
      L.flat(c.details, 6, D - 10, A - 12, 4, L.C.WOOD[4], 12)
    elseif s.kind == 'outbreak_sign' then
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
