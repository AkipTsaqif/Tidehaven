# Land reclamation — plan for approval

Status: **APPROVED (12x12 patches, distance trigger). Step 1 (pure refactor) in progress. Eden not touched.**

## Decisions already made by the user
- Applies to new scenarios **and** Eden (via an explicit, confirmed rules upgrade after a verified backup).
- Only a councillor or magistrate may start it; paid from the **treasury**.
- Allowed only when free building land is scarce.
- **Large, expensive patches** ("it should be a long way to reclaim").
- May extend **anywhere along the coast**, but **must never disturb an existing fishing dock**.
- Island and coast terrains only. River plains have no sea edge to extend.

## Rules (all scenario-owned, integers only)
`growth.reclamation` (optional; absent = feature off, so existing scenarios/saves are unaffected):
- `patchTiles`: patch is an N x N square. **Approved: 12 -> 144 tiles (~16 lots).**
- `scarcityDistanceTiles`: **approved trigger = distance.** Reclamation may start only when the nearest free
  building footprint is farther than this many tiles from the town centre (the origin of the map layout).
  Evaluated by the same deterministic placement the map uses; a town with free land nearby cannot reclaim.
- `labourDays`, `materials` (timber), `constructionCostCents`: priced so the first patch costs roughly
  30-40 % of Eden's treasury at day 180 (~$450), 120 timber, 90 labour days. Tune in scenario data.
- `maxActive` (default 1), `maxTotal` (default 64), `cooldownDays` after completion.

## Domain model
- New `state.reclamation: { patches: ReclaimedPatch[], nextId }`. A patch = `{id, projectId, tx, ty, size, completedDay}`
  in tile coordinates. Patches are append-only and never removed.
- New project kind `reclamation` in the existing `DevelopmentProject` machinery, reusing funding, escrow,
  labour, cancellation/refund and invariant code. New primary action `reclaim_land` (no model-supplied
  coordinates: **the engine chooses the site deterministically**; models only choose to propose it).
- Site choice: from the seeded map field, pick the free coastal square nearest the town that (a) touches
  existing land along its full edge, (b) is entirely sea, (c) is at least `dockClearance` tiles from every
  shore building's dock rectangle and from the water edge in front of every fishery lot, (d) does not overlap
  another active project's reserved square. Ties break by tile coordinate.
- Completion adds the patch to state. Treasury pays, goods are consumed, nothing is created from nothing.
- Invariants: patches disjoint, patches touch land, no patch overlaps a fishery dock clearance zone,
  money/goods conservation already enforced by the ledger.

## Map integration
- The map's land field becomes `seedField OR inAnyPatch`. Because patches are simulation state, the map
  reads them from `/api/map` input (they are already deterministic and persisted with the world).
- Existing buildings keep their positions (placement is prefix-stable and land only increases).
- Fisheries: reclamation may not fill the sea in front of a fishery. Add that dock zone to the site rule.
- Coast terrain: the sea is open, so reclamation extends the shoreline outward; island: grows the island.

## Persistence and Eden upgrade
- New table `reclaimed_land` (migration 009). `construction_projects` JSON already carries the new kind.
- The state hash gains a `reclamation` section **only when non-empty**, so existing hashes are unchanged
  until the first patch exists.
- Eden: scenario `eden-growth-2` adds `growth.reclamation`. Upgrade command `npm run upgrade-rules`
  (explicit confirm flag): verified backup -> insert new rules_versions row -> repoint world -> verify load.
  No resident, building, balance or project is modified.

## Tests required (all must pass before any Eden change)
Rule/property tests: funding/escrow/refund; cancellation returns everything; scarcity gate on/off; site
selection determinism and tie-break; never overlaps docks/patches; never leaves a gap to land; cap/cooldown;
non-council rejected; hash unchanged when no patches; save/load round trip; map reads patches; old saves
without the rule behave identically; replay determinism; fisheries still on shore after reclamation.
Browser/map: patch appears as land, buildings stay put, docks keep water access.

## Risks
- Changes simulation rules and state hash for upgraded towns (user-approved for Eden).
- Dock-clearance logic couples map geometry into domain rules; keep it as pure integer tile math
  in `src/domain` with a shared `landField` helper, not importing the application layer.
- Domain code may not import application/map code (AGENTS.md). The island field currently lives in
  `src/application/map-layout.ts`; it must move to a pure `src/domain/geography` module first.

## Proposed order
1. Move land field to `src/domain/geography` (pure refactor, map output byte-identical, tests prove it).
2. Rules schema + project kind + invariants + tests (scenario off by default).
3. Persistence, hash, migration 009 + tests.
4. Map integration + dock clearance.
5. Prompt/observation text for the model (council sees "land scarce, you may reclaim").
6. Eden backup + `eden-growth-2` + upgrade command; run only after your explicit go-ahead.
