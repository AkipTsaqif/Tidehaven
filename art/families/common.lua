-- Shared recipe helpers used by several building families.
-- Editing anything here changes sprites in EVERY family that uses it. Family briefs must not edit
-- this file; add family-specific helpers inside the family's own file instead.
local U = {}

function U.texture(L, b, m, ramp, seed)
  L.stripe(b, m.left, "dr", 4, ramp[2])
  L.stripe(b, m.right, "ur", 4, ramp[1])
  L.speckle(b, m.left, 0.018, ramp[4], seed)
end

-- Starter pitched-roof house in the back of the fixed lot, leaving a forecourt for props and paths.
function U.house(L, c, theme, spec, wall, roof)
  local tier, seed = spec.tier, spec.seed
  local wi = ({16,24,28})[tier]
  local depth = ({16,20,24})[tier]
  local ht = ({12,20,28})[tier]
  local i,j = 8,8
  local m = L.box(c.building,i,j,0,wi,depth,ht,wall,{notop=true,base=true})
  U.texture(L,c.building,m,wall,seed)
  -- Doors/windows are authored at native pixel scale; 2x3 windows remain legible zoomed out.
  L.wallRect(c.building,m,"L",4,0,4,7,L.C.WOOD[2])
  L.windows(c.building,m,"L",{u0=10,cols=1,w=2,h=3,v0=4,sill=wall[5]})
  L.windows(c.building,m,"R",{cols=tier+1,w=2,h=3,gap=2,v0=4,sill=wall[4]})
  if tier > 1 then
    L.windows(c.building,m,"L",{cols=tier+1,w=2,h=3,gap=4,v0=14,sill=wall[5]})
    L.windows(c.building,m,"R",{cols=tier+1,w=2,h=3,gap=2,v0=14,sill=wall[4]})
  end
  -- Chimney belongs to the roof, not a floating object: draw its back half before the roof.
  L.box(c.building,i+8,j+2,ht,2,2,13,L.C.BRICK)
  L.gable(c.building,i,j,ht,wi,depth,8,"i",roof,wall,{o=2,rows=3})
  L.shadow(c.shadow,i,j,wi,depth,4)
  L.flat(c.lot,i+4,j+depth,4,46-(j+depth),L.C.DIRT[4])
  return m
end

-- Starter flat-roof hall with parapet.
function U.flatHall(L,c,spec,wall,roof)
  local tier = spec.tier
  local w,d,h=({16,24,28})[tier],({16,20,24})[tier],({12,20,28})[tier]
  local m=L.box(c.building,8,8,0,w,d,h,wall,{parapet={p=2,d=2,floor=roof},base=true})
  U.texture(L,c.building,m,wall,spec.seed)
  L.wallRect(c.building,m,"L",4,0,4,7,L.C.GLASS[2])
  L.windows(c.building,m,"L",{u0=10,cols=1,w=2,h=4,v0=3,sill=wall[5]})
  L.windows(c.building,m,"R",{cols=tier+1,w=2,h=4,gap=2,v0=3,sill=wall[4]})
  if tier>1 then
    L.windows(c.building,m,"L",{cols=tier+1,w=2,h=4,gap=4,v0=13,sill=wall[5]})
    L.windows(c.building,m,"R",{cols=tier+1,w=2,h=4,gap=2,v0=13,sill=wall[4]})
  end
  L.box(c.building,12,12,h-2,4,4,3,L.C.STEEL)
  L.shadow(c.shadow,8,8,w,d,4)
  L.flat(c.lot,12,8+d,4,46-(8+d),L.C.CONCRETE[4])
  return m
end

function U.crates(L,c,tier)
  for k=1,tier do
    local m=L.box(c.details,8+k*6,38,0,4,4,3,L.C.WOOD,{base=true})
    L.stripe(c.details,m.left,"v",2,L.C.WOOD[2])
  end
end

-- Front-corner biome plant plus a bush; themes select palms, oaks, cacti or pines.
function U.greenery(L,B,c,theme,spec,withPlant)
  if withPlant ~= false then B.plant(L,c.details,42,38,0,4,theme,spec.seed+10) end
  L.bush(c.details,6,42,3,theme.leaf,spec.seed+11)
end

return U
