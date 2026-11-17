# Housing towers — revision reviewed

## Current disposition — supersedes the original revision request below
Housing art is visually acceptable to proceed to the next artist family; no further mandatory housing
redraw is requested. Catalog remains draft until packaging/gameplay integration.

Confirmed source fixes: balcony world height adds box.z0 once while laundry keeps local height;
R entrance roof projects along+i and home6door moved onto exposed wall; home5receiving wings reach
gallery heights with overlap at both ends; home8blank shaft replaced by dressed setbacks and a lookout.
Viewed balconyA/B, tropical/arid/temperate/northern native ladders, gallery/entrance/crown proof crops.
Tall silhouettes remain slender/stylized, but improved residential detail and reduced lower-floor clutter
are acceptable for this art direction. No full structural-engineering correctness is claimed.

Independent checks: exact20changed home4..8frames and0otherIDs;20/20repeat hashes;
verify302tests/lint/typechecks/build pass; legacy art:test164assets pass.

### Integrator follow-up (do not ask artist to move metadata silently)
- Reconcile home8roof attachment: catalogz616 is above its redesigned crown (reported apex~598).
- Reconcile home4front attachment: j44is inside the front face atj46.
- Use per-surface attachment/mask metadata rather than assuming one point proves overlay alignment.
- Housing art does not activate capacity or larger spatial reservations. Funded redevelopment still pending.

Next artist task: shop tiers4..8only, preserving all20housing PNGs and every other function/family.


## Independent verification
20/20home4..8sprites changed, zero changes to shop/clinic/court/council or other families.
Complete inventory1356;20/20housing repeat hashes identical. Full verify302tests passes onD:;
legacy art:test164assets passes. Those gates do not prove attached structural geometry or aesthetics.
Viewed tropical/arid/northern native tier ladders,home4/home7biome comparisons,home6/home8detail strips
and legacyhome3scale comparison. No blanket approval of all20frames.

## Verdict
Useful tier silhouettes and material direction, but not approved yet. Fix coordinate/attachment bugs
before making the other functions depend on these helpers. Crown proportions need one focused art pass.

## Required geometry fixes
1. `balcony` writes raw world z=v, but `dress` passes local floor height v-1. Unlike faceRect it never adds
   box.z0. Every elevated block therefore draws its balconies too low, explaining lower-floor clutter.
   Define local vs world height explicitly, add box.z0 exactly once for slabs/posts/roofs, and keep laundry
   consistent (faceRect adds z0, so don't double-add it). Check every biome and tier.
2. R-side `entrance` canopy uses I-4 for its outer edge (inside the wall), while supporting posts sit atI+2.
   Put the porch roof outward on+i, align it with post tops and ground steps, preserve its lot margins.
3. home5galleries atz60/z56 attempt to connect wings whose tops endz44/z38. Move them to real connecting
   levels, extend the wings structurally, or replace them with visibly supported arcades. Merely touching
   the main tower at one end is insufficient. Provide isolated structure-only proof/coordinates.

## Required visual refinement
4. home8crown is a120px/10x10blank shaft with both dress passes disabled. It reads as an empty chimney,
   not a monumental residential crown. Replace with a shorter proportional crown or articulated inhabited
   tiers/galleries/rooflets. Do not fill it with one repeated window grid; retain timeless housing identity.
5. Review sparse/repetitive facade bands and domestic detailing AFTER the geometry fixes: the current
   native ladders look more like thin stepped towers than stacked neighbourhoods. Use balconies/laundry,
   coherent terraces, bay variation and rooflets without making every square inch noisy.

## Things NOT automatically defects
Masses overlapping at a turret/wing joint can be a valid boolean union if painter order creates a
coherent exterior; don't separate them arbitrarily to satisfy a lint connectivity test. Single opaque
connected components don't prove sky galleries have two supported ends. Golden hashes only prove scope.

## Contract and safety
Edit only towers.lua; only home4..8outputs may change. Catalog dimensions/pivots/footprints/status and
other function output must remain unchanged. Keep original bridges,boats,fishing,water intact. Document
attachment-anchor discrepancies accurately; metadata isn't approved simply because a crown is nearby.

## Recheck
Fresh snapshot before-housing-revision; full rebuild; exact-ID diff;20repeat PNG hashes; enlarged proofs
for an elevated balcony, R entrance, both home5gallery ends,home8crown; native4biome ladders;
legacy art:test and verify with TEMP/TMP D:/tmp-tidehaven-tests. No live capacity/footprint/save changes.
