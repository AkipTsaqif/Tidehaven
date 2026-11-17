-- STARTER / DRAFT overlays. Final masks/attachment placement are a separate integration step.
-- Never paint an opaque rectangular background. Do not display until attached to an approved mask.
local F={}
function F.draw(L,B,c,theme,s)
  local A,D=s.A,s.B
  local cx,cy=A/2,D/2
  if s.kind=='repair_scaffold' then
    for i=6,A-6,8 do L.box(c.details,i,D-8,0,2,2,18,L.C.WOOD) end
    L.flat(c.details,6,D-10,A-12,4,L.C.WOOD[4],12)
  elseif s.kind=='outbreak_sign' then
    local sign=L.box(c.details,cx-4,D-10,0,8,2,8,L.C.WHITE)
    L.wallRect(c.details,sign,'L',2,2,4,2,L.C.BARN[4])
    L.wallRect(c.details,sign,'L',4,1,2,5,L.C.BARN[4])
  else
    local ramp=s.kind=='flood_stain' and theme.water or s.kind=='drought_ground' and L.C.DIRT or L.C.WOOD
    for n=0,4 do
      local i=6+(n*8)%(A-12)
      L.quad(c.details,{{i,D-8,0},{i+4,D-10,0},{i+6,D-6,0},{i+2,D-4,0}},ramp[2])
    end
  end
end
return F
