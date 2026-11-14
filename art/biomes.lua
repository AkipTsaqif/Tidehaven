-- biomes.lua — deterministic palettes and crisp biome plants.
local B = { names = {"tropical", "temperate", "arid", "northern"} }

local EXTRA = {
  SAND = {"#5d4028", "#88603a", "#b58a52", "#d6b16b", "#f0d18b"},
  THATCH = {"#49351b", "#725325", "#9b7436", "#c09a4d", "#e1c06c"},
  ADOBE = {"#542d24", "#794236", "#a96249", "#ca8060", "#e2aa7e"},
  TROPICAL_WATER = {"#102f3b", "#155766", "#19848a", "#36b2a1", "#8ad5ba"},
  TEMPERATE_WATER = {"#12305a", "#1c4a7c", "#2b6aa0", "#4a90c0", "#86c0e0"},
  ARID_WATER = {"#12364d", "#1b5871", "#287e91", "#53aeb2", "#9ad7c9"},
  NORTHERN_WATER = {"#182b42", "#294967", "#3e6686", "#6d9bb1", "#b4d3d6"},
  TROPICAL_GRASS = {"#173c2a", "#28623a", "#3d8a45", "#6db34e", "#a8d66a"},
  TROPICAL_FOLIAGE = {"#102b20", "#195035", "#287345", "#459a4e", "#8bcf62"},
  TROPICAL_PLASTER = {"#51483b", "#776b50", "#a6966c", "#d0c18b", "#f0e4ad"},
  TROPICAL_ROOF = {"#41191b", "#6d2625", "#96352d", "#c05235", "#e18358"},
  TEMPERATE_GRASS = {"#1e3b2a", "#315b35", "#4d7d43", "#73a04d", "#a4c66b"},
  TEMPERATE_FOLIAGE = {"#142b22", "#23492d", "#35683a", "#55904a", "#82b866"},
  TEMPERATE_PLASTER = {"#5e5048", "#8f7f6c", "#bfae8e", "#ddd0ad", "#f2ead0"},
  TEMPERATE_ROOF = {"#3d1418", "#6b1f22", "#9a2f2a", "#c24a35", "#e0704a"},
  ARID_GRASS = {"#29351e", "#4f6030", "#788044", "#a49b55", "#c9bd73"},
  ARID_FOLIAGE = {"#182c22", "#28523a", "#3c7750", "#5c9a61", "#8cbc72"},
  ARID_PLASTER = {"#542d24", "#794236", "#a96249", "#ca8060", "#e2aa7e"},
  ARID_ROOF = {"#3e2419", "#654027", "#8b5d33", "#b07b43", "#d39b59"},
  NORTHERN_GRASS = {"#26382f", "#3d5946", "#5d7656", "#82966a", "#b3bb87"},
  NORTHERN_FOLIAGE = {"#101f26", "#1b3540", "#285363", "#3c7080", "#6596a0"},
  NORTHERN_PLASTER = {"#46505a", "#697681", "#929da2", "#c1c8c4", "#e9e7d8"},
  NORTHERN_ROOF = {"#1c2433", "#2c3a4f", "#415470", "#5d7491", "#8199b3"},
  PALM_TRUNK = {"#3d271b", "#65402a", "#8c5a35", "#b77b48", "#d7a267"},
  CACTUS_TRUNK = {"#173c2b", "#286244", "#3f8752", "#68aa62", "#a7ce78"},
  PINE_TRUNK = {"#29221f", "#49372d", "#6c503d", "#8e6b4e", "#b49369"},
}

local VARIANTS = {
  tropical = {GRASS="TROPICAL_GRASS", FOLIAGE="TROPICAL_FOLIAGE", WATER="TROPICAL_WATER", PLASTER="TROPICAL_PLASTER", ROOF_RED="TROPICAL_ROOF"},
  temperate = {GRASS="TEMPERATE_GRASS", FOLIAGE="TEMPERATE_FOLIAGE", WATER="TEMPERATE_WATER", PLASTER="TEMPERATE_PLASTER", ROOF_RED="TEMPERATE_ROOF"},
  arid = {GRASS="ARID_GRASS", FOLIAGE="ARID_FOLIAGE", WATER="ARID_WATER", PLASTER="ARID_PLASTER", ROOF_RED="ARID_ROOF"},
  northern = {GRASS="NORTHERN_GRASS", FOLIAGE="NORTHERN_FOLIAGE", WATER="NORTHERN_WATER", PLASTER="NORTHERN_PLASTER", ROOF_RED="NORTHERN_ROOF"},
}
local MUTABLE = {"GRASS", "FOLIAGE", "WATER", "PLASTER", "ROOF_RED"}
local THEMES = {
  tropical = {ground="GRASS", wall="PLASTER", roof="ROOF_RED", leaf="FOLIAGE", trunk="PALM_TRUNK", water="TROPICAL_WATER", sand="SAND"},
  temperate = {ground="GRASS", wall="PLASTER", roof="ROOF_RED", leaf="FOLIAGE", trunk="WOOD", water="TEMPERATE_WATER", sand="SAND"},
  arid = {ground="SAND", wall="ADOBE", roof="THATCH", leaf="FOLIAGE", trunk="CACTUS_TRUNK", water="ARID_WATER", sand="SAND"},
  northern = {ground="GRASS", wall="PLASTER", roof="ROOF_SLATE", leaf="FOLIAGE", trunk="PINE_TRUNK", water="NORTHERN_WATER", sand="SAND"},
}

local captured = setmetatable({}, {__mode = "k"})
local installed = setmetatable({}, {__mode = "k"})
local themeKinds = setmetatable({}, {__mode = "k"})

local function copyRamp(r)
  local out = {}
  for n = 1, 5 do out[n] = r and r[n] end
  return out
end

local function installExtras(L)
  if installed[L] then return end
  L.C = L.C or {}
  for name, colors in pairs(EXTRA) do
    if not L.C[name] then
      local ramp = {}
      for n = 1, 5 do ramp[n] = L.hex(colors[n]) end
      L.C[name] = ramp
    end
  end
  installed[L] = true
end

local function text(value)
  if type(value) == "table" then
    return tostring(value.name or value.scenarioVersion or value.version or value.id or "")
  end
  return tostring(value or "")
end

local function hash(value)
  local h = 216613626
  for n = 1, #value do h = (h * 16777619 + value:byte(n)) % 2147483647 end
  return h
end

local function isEden(value)
  if type(value) == "table" then
    return isEden(value.name) or isEden(value.scenarioVersion) or isEden(value.version)
  end
  local s = string.lower(tostring(value or ""))
  return s:sub(1, 4) == "eden" or s == "eden"
end

function B.choose(scenarioVersionOrName, seed)
  if isEden(scenarioVersionOrName) then return "tropical" end
  local h = hash(text(scenarioVersionOrName) .. "|" .. tostring(seed or 0))
  return B.names[(h % #B.names) + 1]
end

local function normalizeBiome(biome)
  local s = string.lower(tostring(biome or "temperate"))
  for _, name in ipairs(B.names) do if s == name then return name end end
  return B.choose(s, 0)
end

function B.apply(L, biome)
  local kind = normalizeBiome(biome)
  installExtras(L)
  local base = captured[L]
  if not base then
    base = {}
    for _, name in ipairs(MUTABLE) do base[name] = copyRamp(L.C[name]) end
    captured[L] = base
  end
  for _, name in ipairs(MUTABLE) do
    local source = VARIANTS[kind][name]
    L.C[name] = copyRamp(source and L.C[source] or base[name])
  end
  local theme = {}
  for key, value in pairs(THEMES[kind]) do theme[key] = L.C[value] end
  theme.biome = kind
  themeKinds[theme] = kind
  return theme
end

local function ramp(L, theme, key, fallback)
  local value = theme and theme[key]
  if type(value) == "table" then return value end
  return L.C[value or fallback] or L.C[fallback]
end

local function even(value)
  value = math.floor(tonumber(value) or 0)
  return value - value % 2
end

local function plantKind(theme)
  if themeKinds[theme] then return themeKinds[theme] end
  if theme and theme.trunk == "PALM_TRUNK" then return "tropical" end
  if theme and theme.trunk == "CACTUS_TRUNK" then return "arid" end
  if theme and theme.trunk == "PINE_TRUNK" then return "northern" end
  return "temperate"
end

local function palm(L, c, i, j, z, size, theme, seed)
  local leaf, trunk = ramp(L, theme, "leaf", "FOLIAGE"), ramp(L, theme, "trunk", "WOOD")
  local lean = hash("palm|" .. tostring(seed or 0)) % 3 - 1
  local height, crown = 9 + size, z + 9 + size
  for k = 0, height - 1 do
    local shift = lean * 2 * math.floor(k / 7)
    L.dot(c, i + shift, j, z + k, trunk[3])
    if k % 2 == 0 then L.dot(c, i + shift + 2, j, z + k + 1, trunk[2]) end
  end
  local span = 2 + 2 * math.floor((size - 3) / 2)
  L.dot(c, i + lean * 2, j, crown, leaf[5])
  L.quad(c, {{i, j, crown}, {i + span, j, crown + 2}, {i + span, j + 2, crown + 1}, {i + 2, j + 2, crown}}, leaf[4])
  L.quad(c, {{i, j, crown}, {i - span, j, crown + 2}, {i - span, j - 2, crown + 1}, {i - 2, j - 2, crown}}, leaf[3])
  L.quad(c, {{i, j, crown}, {i, j + span, crown + 2}, {i - 2, j + span, crown + 1}, {i - 2, j + 2, crown}}, leaf[2])
  L.quad(c, {{i, j, crown}, {i, j - span, crown + 2}, {i + 2, j - span, crown + 1}, {i + 2, j - 2, crown}}, leaf[4])
  L.dot(c, i + span, j, crown + 2, leaf[5])
  L.dot(c, i - span, j, crown + 2, leaf[5])
end

local function cactus(L, c, i, j, z, size, theme)
  local green = ramp(L, theme, "trunk", "CACTUS_TRUNK")
  local height, arm = 8 + size, 2 + 2 * math.floor((size - 3) / 2)
  L.box(c, i - 2, j - 2, z, 4, 4, height, green, {base = true})
  L.box(c, i + arm - 2, j - 2, z + 4, 2, 2, 4 + math.floor(size / 2), green)
  L.box(c, i - arm, j - 2, z + 6, 2, 2, 3 + math.floor(size / 2), green)
  L.dot(c, i, j, z + height + 1, green[5])
  L.dot(c, i + arm + 2, j, z + 5, green[5])
  L.dot(c, i - arm - 2, j, z + 7, green[5])
end

local function pine(L, c, i, j, z, size, theme)
  local leaf, trunk = ramp(L, theme, "leaf", "FOLIAGE"), ramp(L, theme, "trunk", "WOOD")
  local height = 9 + size
  L.box(c, i - 2, j - 2, z, 4, 4, 5, trunk, {base = true})
  -- Bottom boughs first; overlapping triangular fans leave a readable pine silhouette, not a
  -- stack of flat diamonds. Screen-space rasterization belongs here in the shared plant helper.
  local p = L.P(c, i, j, z)
  for tier = 3, 0, -1 do
    local top = p[2] - height + tier * 2
    local base = top + 5
    local span = 2 + tier
    L.poly(c, {{p[1], top}, {p[1], base}, {p[1]-span, base}}, leaf[4])
    L.poly(c, {{p[1], top}, {p[1]+span, base}, {p[1], base}}, leaf[2])
  end
  L.dot(c, i, j, z + height, leaf[5])
end

function B.plant(L, c, i, j, z, size, theme, seed)
  i, j, z = even(i), even(j), math.floor(tonumber(z) or 0)
  size = math.max(3, math.min(5, math.floor(tonumber(size) or 3)))
  theme = theme or B.apply(L, "temperate")
  local kind = plantKind(theme)
  if kind == "tropical" then palm(L, c, i, j, z, size, theme, seed)
  elseif kind == "arid" then cactus(L, c, i, j, z, size, theme)
  elseif kind == "northern" then pine(L, c, i, j, z, size, theme)
  else
    L.tree(c, i, j, z, size, ramp(L, theme, "leaf", "FOLIAGE"), ramp(L, theme, "trunk", "WOOD"), hash("tree|" .. tostring(seed or 0)))
  end
  return kind
end

return B
