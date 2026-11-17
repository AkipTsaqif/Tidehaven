# Commercial towers — revision reviewed

## Current disposition (supersedes original findings below)
Commercial tower art is acceptable to proceed to clinic towers; no further mandatory redraw requested.
Still draft until production packaging/integration, not live capacities or property reservations.

Confirmed requested fixes: shop6flat deck/drum/loggia continuous support; shop8banner poles start on
step5deck at550within its footprint; shopGalleryRshade projects outward; shop7connectors corrected
for actual96unit footprint. Viewed4biome ladders plus tropical crown/banner/canopy proofs.
Dense fascia rhythm remains acceptable commercial identity, distinct from housing.

Independent checks: verify302tests/lint/typecheck/build; legacy164renders;20/20repeat shop hashes;
exact20shop-onlychanges vsbefore-shop-towers. Important: before-shop-revision was reconstructed from
that older baseline, so the scope proof covers BOTH commercial sessions, not revision-only changes.

Checker now reads recipe arithmetic, requires two receiver intersections, checks removal/movement
counterexamples and exits nonzero. SHOP_CHECKS_OK reproduced. Its source parser is intentionally
limited, cap approximation and opaque projected samples are NOT full3Dsupport/occlusion proof;
changes outside supported literal syntax require checker maintenance, not artificial simplification
of good art just to satisfy regex parsing. Never run it on untrusted recipe input (Python eval).

Integrator pending anchors: shop5roofz152inside upper cap; shop8roofz616above redesigned~605apex.
Use actual surface/mask attachment geometry, not merely opaque projected pixels.

Next task clinic4..8only; preserve all40reviewed home/shopframes and allotherasset outputs.


## Independent evidence
Exact20shop4..8changed PNGs and zero other IDs,20/20repeat hashes match,1356inventory complete.
verify302tests/lint/typecheck/build pass onD:,legacy art:test164assets pass.
Viewed tropical/arid/northern ladders,home-vs-shop comparison,shop4biomes and enlarged arcade/gallery
strips. Commerce reads distinct from housing; broad market podiums and the tier8ziggurat are useful.
No generic full approval despite procedural gates passing.

## Required fixes
1. shop6floating crown loggia: towerA endsz220; cap peaks220+pitch, but loggiaZ=220+pitch+4.
   No base/drum connects that loggia to the structure below. Arid has the same issue: parapet ends222,
   loggia begins224. Found it on a true supporting mass/loggia drum; roof contact at one point is not
   a whole-footprint foundation. Prove the support footprint and elevations for all4biomes.
2. shop8banner posts: crown loggia footprint is54..74 on both axes at550..580 (A=D=128), but posts
   start at580 at i48 and76. These lie OUTSIDE the loggia roof; wider step5ends550. Both posts float.
   Move onto actual roof or add coherent support from the relevant terrace, maintaining canvas/lot.
3. shopGallery R-side tropical shade roof runs towardI-1, while balcony slab projects toI+d.
   Correct the outward+i canopy so it shades the actual gallery; don't touch housing helpers/output.
4. shopcheck.py is not a reliable two-ended connection proof: spray accepts any host hit, rather than
   requiring BOTH named hosts. It also doubles footprint dimensions in many mass constants: shop6A64
   podium ends56 not124;shop7A96halls end90 not186;shop8A128plinth ends122 not250 and step5starts50
   not114. Derive actual footprint values consistently and fail on missing either receiving end.
   Add counterexample checks removing either host or moving one beyond the connection, and checks
   for loggia support, banner pole foundations and real canopy bounds. Don't claim copied tables
   automatically agree with rendered geometry; document how synchronization is checked.

## Visual note
Shop7/8horizontal fascia/gallery bands are dense, but remain readable in the ladders and distinct
from housing. No wholesale facade redesign requested; avoid broad scope churn.

## Integrator follow-up
Reported attachment points need proper reconciliation: shop5roof152inside cap with apex~164,
shop8roof616above~608. Artist must report, not silently alter catalog metadata. Merely landing on
an opaque projected pixel doesn't establish a valid wall/roof surface (projection is many-to-one).

## Recheck
Edit towers.lua for shoponly; generated tools/reports may update underart/generated/. Fresh snapshot,
full rebuild, exact20shop-onlydiff,repeat hashes,4biome ladders and detailed support/canopy/crown proof.
Keep home/clinic/court/council and bridges/boats/fishing/water pixels byte-identical. Keep draft status.
No live capacity/reservation/ownership/save changes.
