# Water details — integrator review

## Verdict
Visually acceptable at current native scale. No mandatory redraw identified. Keep entries draft until
production packaging/integration. These are decorative activity markers, not fish stock or catches.

## Independent evidence
- Viewed tropical4xcheckerboard sheet, tropical/northern/arid/temperate water-background sheets,
  and the tropical fishing-boat composition. All12layouts reviewed across the4palette backgrounds.
- Schools read as small fish rather than diamonds; ripple layouts and float arrangements are distinct.
  Shadows are subdued; crossing shadow variant intentionally merges into one silhouette.
- Markers remain transparent and visually subordinate to boats. Limit placement density during
  integration: sparse schools/ripples are preferable to covering the whole sea with activity icons.
- Inventory1356complete; family isolation48water sprites changed,0outside water vsbefore-water.
- Rebuilt complete inventory:48/48water PNG hashes match delivered files exactly.
- watercheck.py exits0 for all4biomes, no checker exceptions.
- verify passes302tests, lint/typechecks/production build; legacy art:test passes164assets.

## Limitations
Checker coverage/cluster/signature tests support composition checks, not aesthetic proof. Corner alpha
checks alone cannot prove there is no small unwanted background rectangle; image review supplements them.
Review water swatches use authoring theme.water[3], while the live map uses multiple terrain-water shades;
recheck contrast at actual map integration. Distinct school pieces are intentional, not detached-object bugs.

## Next
Towers: begin home tiers4..8 only (5identities ×4biomes =20assets). Leave shop/clinic/court/council tower
branches unchanged until housing is reviewed. Then produce each remaining function sequentially, followed
by damage/repair overlays. Larger tower art must not automatically enlarge live lots or capacities.
