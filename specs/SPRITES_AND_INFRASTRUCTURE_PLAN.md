# Tidehaven — infrastructure, waterfront and vertical-town expansion

Status: **user approved staged implementation**. Foundation slice implemented; later gameplay phases pending.
Scope: new sprite library + real bridge/boat/tower projects and map integration + visible disaster damage.

## Implementation status
- READY: expansion inventory (339 identities ×4biomes), isolated Lua family scaffolds, batched runner,
  deterministic review/snapshot tool, variable atlas v2 packer and legacy adapter.
- READY: per-frame size/pivot rendering, rectangular footprint projection/hit helper, metadata-aware fitting,
  legacy3×3 API footprints.298tests +164legacy art renders +10browser tests passed.
- DRAFT ART ONLY: all1356entries execute, but heading/state/family-specific art still needs production.
  All entries retain draft status and are blocked from production atlas integration.
- HANDOFF: `art/NEW_SPRITES_HANDOFF.md` gives detailed sequential artist instructions and acceptance gates.
- BRIDGE REVISION: user-approved stone deckz10/timberz6, matching bank stairs/piers and ground-level
  access metadata;302tests +164legacy renders pass. Preview `art/samples/taller-stone-bridges.png`.
  Bridge art remains draft pending production integration; other expansion families remain starter drafts.
- PENDING: visible live hazard overlays, bridge/boat records and projects, fishing production extension,
  higher capacity rules, authoritative spatial registry, funded redevelopment, tall building activation.
- NOT RUN: any live-save upgrade. Current Eden remains unchanged by this asset slice.

## 1. Confirmed requirements

User requested:
1. Bridges.
2. Boats that are static on the map.
3. Fishing boats, with fish visible in the water.
4. Tiered skyscrapers, ending at megatall, with larger footprints than the current 3×3.
5. An assessment of existing disaster artwork, and appropriate disaster visuals.

User decisions:
- Plan complete features, not only disconnected art assets.
- Include all suitable urban-service building types, not housing/commerce alone.
- Larger footprints require **funded redevelopment**, not free neighbour relocation or advance reservation.
- Architecture is a **stylized timeless vertical town**: stone, timber framing, tiled roofs, terraces,
  arcades and gardens. Not a modern concrete/glass era.

Standing constraints:
- Original crisp pixel art, native **32×16 base tiles**, 2:1 isometric geometry.
- Tropical, temperate, arid, northern materials/vegetation; Eden stays tropical.
- Engine owns money, goods, land, capacity and permissions. Models propose project types/target IDs only.
- Short transactions; no network work inside database writes; deterministic replay and bounded work.
- One real building retains its identity. A tall sprite cannot silently merge unrelated businesses.
- Saved towns are never reset; spatial migrations/upgrades require a tested backup and explicit execution.

## 2. What exists today (verified from source)

| Area | Current implementation | Missing |
|---|---|---|
| Bridges | None in catalog/atlas or crossing rules | Art, crossing records, construction and road routing |
| Boats | Small boats are baked into fishery artwork | Independent boat sprites/entities/ownership/berths |
| Fish | Fish is an economic inventory good | Fish-in-water art/markers; boats affecting production |
| Towers | Three capacity tiers for each existing kind | High-rise tiers, large-footprint reservations and redevelopment |
| Building dimensions | Every asset uses 96×104 canvas, pivot (48,104), 3×3 footprint | Per-asset geometry through atlas/API/renderer/layout |
| Disasters | Storm, flood, fire, drought, outbreak, condition/stock damage, injuries, evacuation, paid repair | Per-building damaged/rebuilding visuals |
| Ruins | Generic `destroyed_1` art selected if destroyedDay is set | Actual hazards do not set destroyedDay; no kind/tier-specific ruins |

Disaster source details: `src/domain/events/disasters.ts` selects one non-destroyed building for storm,
flood, fire or drought. It subtracts 600×severity basis points (severity1–3), clamps condition to ≥10%,
and may damage business inventory/injure residents. Outbreaks use the health resolver. Under30% can
cause evacuation. Repair uses public timber and paid work; the event closes at ≥90% or after its deadline.
A closed event does **not** necessarily mean the building was repaired. `map-query.ts` currently draws
healthy artwork regardless of condition unless destroyedDay is set.

## 3. Design decisions proposed for approval

These are recommendations, not existing functionality:
- Bridges are public works, council-authorized and treasury-funded.
- Boats are real funded assets, stationary in rendering (no movement/path animation in this release).
- General boats support the existing trade/logistics mechanism only through explicit rules, never a
  second free shipment. Fishing boats belong to fisheries and participate in the single production resolver.
- Fish silhouettes/ripples are decorative activity markers, **not a new inventory or free fish source**.
  A finite ecosystem/overfishing model is outside this release unless separately requested.
- Five primary tower families: housing, commerce, clinic/hospital, court/justice, council/assembly.
  Eligibility and maximum tier are template data, not a hard-coded whitelist. Guard houses get taller
  watch stations; workshops and public works get purpose-built multi-storey complexes where appropriate,
  but no arbitrary megatall factory/farm/fishery. Confirm per-family upper limits before producing art.
- Proposed vertical tiers after the current low-rise catalog: mid-rise, high-rise, skyscraper, supertall,
  megatall. Thresholds use funded capacity/development levels and demand, not day/population alone.
- Proposed footprint envelope: 3×3 / 3×3 / 3×3 / 4×4 / 6×6 / 8×8 for low-rise through megatall.
  Exact tier capacities, floors, costs and native canvas heights need calibration before rule implementation.
- Demolition/evacuation/repair are real states. Disaster art never asserts a more severe event than facts support.

## 4. Foundation: variable-footprint asset contract

This comes before large art batches.

Each asset manifest entry owns:
- ID, family, kind, tier, biome and visual state.
- PNG/aseprite paths and atlas frame {x,y,width,height}.
- Logical footprint {widthTiles,depthTiles}; optional occupancy mask for non-rectangular infrastructure.
- Pivot {x,y}, ground-plane elevation, sprite bounds/headroom.
- Access points, shoreline/water constraints and support/abutment points where appropriate.
- Attachments/masks for wall damage, roof damage, water, scaffolds, smoke and construction progress.
- Stable variants and orientations; no runtime scaling of a cottage into a tower.

Changes required:
1. Lua catalog/spec/builder must accept unequal footprints, arbitrary canvas heights and asset classes
   without insisting on 3×3 lot-tip pixels or a fixed success-record format.
2. Atlas packer must pack variable rectangles, with padding/extrusion to prevent adjacent-frame bleed.
3. API and renderer carry per-building/per-asset footprint and pivot, not global `cell`/`lotTiles` assumptions.
4. Culling uses complete sprite bounds; fitting leaves headroom for megatall tops; selection uses the
   correct reserved footprint. Trees/buildings/bridges/boats need explicit depth/occlusion handling.
5. Keep current 164 assets working unchanged through an adapter. Native tile dimensions remain32×16.

Acceptance: a 3×3 cottage, rectangular bridge and 8×8 megatall all pack/draw/select at their real scale,
with correct pivots, no clipping, and no changes to simulation quantities caused by rendering.

## 5. Bridge family

### Art kit
- Timber footbridge: rope/wood rails, narrow plank deck.
- Timber wagon bridge: wider reinforced deck, stout piers and rails.
- Stone arch bridge: masonry abutments, readable water opening and parapets.
- Long stone viaduct: repeatable arch spans, optional for wide crossings.
- For each: both isometric axes (i/j), near/far bank caps, middle spans, support piers and matching
  construction/damage/repair modules. Repeated modules let one tested recipe cover several river widths.
- Water is not painted permanently into the deck: the river remains visible beneath it.

### Gameplay and placement
- Council selects a legal crossing candidate proposed by deterministic code, not arbitrary model coordinates.
- Both abutments must be on stable land and connected to valid access paths; the span crosses only the
  permitted bounded width of water. No bridge floats, ends in sea, crosses buildings, or fills a river.
- Reserve banks/span before construction, escrow resources/works funding, apply actual labour, then open.
- Road routing may cross water **only on completed, usable bridge decks**. Incomplete/unsafe bridges block it.
- Keep shipping/fishing water corridors clear: piers/clearance near a dock cannot be obstructed.
- Existing travel mechanics do not currently charge distance. First bridge integration connects map
  paths; any economy/travel-speed benefit must be an explicit later rule, not an implied bonus.

Tests: valid/invalid banks, width cap, failed funding, duplicate reservations, cancellation/refund,
construction persistence/replay, usable deck routes, no invisible water crossings, dock clearance,
damaged/closed bridges disconnect routes until repaired.

## 6. Static general boats

### Art kit
- Small rowboat, work skiff, cargo barge, coastal sailboat.
- Four authored isometric headings; hull/sails/cargo silhouettes remain clear at1×.
- Empty and loaded variants where cargo is real; matching construction and damaged art.
- Transparent sprites with waterline pivot, no baked 3×3 grass lot. Shadows/wakes are separate.

### Gameplay
- An ownership record links each boat to a resident/business/town and a legal berth.
- Owners commission boats through funded projects; public boats require civic authority.
- Each boat has integer cargo capacity, condition, berth/assignment, build status and maintenance rules.
- Never draw more owned boats than exist; bound boats per berth/fishery and overall renderer work.
- Keep sprites static at berths or designated water work positions. No sailing animation, collision-based
  navigation or real-time simulation in this release.
- Cargo displayed on a boat is either an explicit reserved transit holding or a derived view of an
  existing shipment; never duplicate inventory in both the boat and the existing trade system.
- Reuse existing shipping settlement as the single source of cargo/cash transfers. Decide whether personal
  rowboats remain nonproductive assets, rather than assigning them fictional revenue.

Tests: owner/berth permission, funded build/maintenance, safe disposal/transfer on death/closure,
no duplicate shipping, conservation, no boats on dry land or overlapping bridge supports.

## 7. Fishing boats and visible fishing grounds

### Art kit
- Fishing canoe, net boat, larger fishing sailboat (timeless, no diesel trawlers).
- Four headings; gear variants such as net rack, pots and fish crates.
- Small water elements: fish silhouette clusters, ripple rings, net/float groups and fish-school shadows.
- Loaded fish crate variant only for actual catches or reserved landed fish. Open-water fish markers do
  not claim the business owns those fish yet.

### Gameplay
- Commissioned by a fishery owner or authorized public manager with actual money, timber, tools and labour.
- Assign each completed boat to one fishery and a legal water position reachable from its dock; keep
  reclamation and bridge reservations out of fishing access corridors.
- Single daily fishery resolver checks living staff, labour, gear, boat condition and bounded catch capacity.
  The boat changes those prerequisites/capacity **inside** existing production. It never produces a second
  parallel catch and empty fisheries do not earn fish merely by owning a boat.
- Decorative fish-school locations derive from seed and legal water/activity. They are stable/static,
  not a promise of finite simulated fish stocks. Hide them where water is reclaimed.

Tests: no staff/no labour/no usable boat where required -> no boat-enabled output; one catch ledger,
correct consumption/condition wear; destroyed/closed docks cannot dispatch; water markers never generate goods.

## 8. Vertical town and megatall redevelopment

### Architectural families
| Function | Identity that must survive every tier |
|---|---|
| Housing | stacked homes, balconies, laundry, roofs and shared gardens |
| Commerce | arcades, covered markets, stacked shop terraces and warehouses |
| Hospital | pale walls, health emblem, wards, garden terraces and covered walks |
| Court | stone halls, steps, justice icon, elevated courtyards; no market/house disguise |
| Council | assembly hall, bells/clocks, banners and layered meeting terraces |

Style: large masonry bases, buttresses, timber upper galleries, stepped setbacks, courtyards,
bridges between wings and planted terraces. Megatalls look like immense vertical citadels, not modern
mirrored office towers. Retain biome materials/shading; arid massing emphasizes shaded terraces,
northern roofs shelter snow-prone silhouettes, tropical levels use ventilated verandas and palms.
Buildings are not arbitrarily rotated or downscaled; all art uses the32×16 tile scale.

### Suggested tier ladder (design proposal)
| Tier | Character | Reserved lot |
|---|---|---|
| Low-rise | current small/medium/large catalog | 3×3 |
| Mid-rise | denser courtyard block, ~4–6 implied floors | 3×3 |
| High-rise | stepped multi-storey complex, ~7–12 floors | 3×3 |
| Skyscraper | tall clustered tower, ~13–24 floors | 4×4 |
| Supertall | multi-wing vertical citadel, ~25–40 floors | 6×6 |
| Megatall | monumental terraced tower district, ~40+ floors | 8×8 |

"Floors" are an art-direction scale, not precise real-world metres. Tier capacities and cost schedules
must be chosen together: a town must not get a megatall for today's20-bed home ceiling or100-worker shop
merely because a picture exists. Existing expansion ceilings and goods availability need explicit rules updates.
This six-step progression is proposed for approval; the current three low-rise capacity variants
remain beneath it, rather than being replaced by identical towers.

### Funded redevelopment lifecycle
1. Owner proposes a known redevelopment tier for a real building; engine computes extra footprint,
   relocation, financial/material costs and any blocked access. Council permission covers public land/roads.
2. All affected land/building owners agree to sale/lease/replacement terms. No automatic free seizure.
   Resident relocation requires explicit household agreement and suitable funded temporary/permanent housing.
3. Reserve target land and replacement access without changing anyone's present capacity/ownership.
4. Escrow compensation, construction funding, materials and relocation costs; secure replacement housing
   before evacuating anyone. Production interruption is recorded, not ignored.
5. Temporarily close/evacuate the target as required; keep or legally move affected neighbours through
   recorded transactions, then carry out demolition/foundation/construction with real labour.
6. Open the completed building with new capacity and footprint; reroute roads legally. Temporary housing
   transitions are resolved before project closure. Cancellation cannot resurrect already-demolished structures;
   preserve irreversible milestones and use an explicit recovery/refund schedule.
7. Keep original building IDs/history when upgrading one institution. A district merger needs a separate
   ownership/business consolidation contract, never one render pass replacing several real businesses.

### Spatial authority (necessary change to the old derived-map-only rule)
Funded acquisition cannot depend on a layout that shifts with later algorithm changes. Before gameplay
redevelopment, freeze the legacy seed-derived footprint of affected buildings under a layout-versioned
spatial registry. Record only authoritative permits/reservations/overrides, not every decorative tree.
At upgrade, obtain a consistent snapshot of the existing town and its land/bridge/dock reservations;
reject any conflict rather than reshuffling occupants. Freeing or consuming one old lot can shift later
seed-derived placements: freeze every potentially affected footprint (or the whole current baseline),
not only the enlarged tower. Newly expanded footprints stay permanent. Ordinary GET map reads never
create permits or write coordinates.
This is a deliberate, separately approved save migration, not a hidden consequence of new art.

Tests: blocked enlargement, unavailable owners/consent, no eviction without replacement housing,
exact compensation, no overlap/water intrusion, stable unaffected neighbours/docks, staged interruption,
mid-build crash/resume, irreversible demolition recovery, duplicate completion idempotency, growing footprint
selected correctly in full map and Overview, seeded replay with stored permits.

## 9. Disaster visual states

### Proposed state model for rendering
A building keeps kind/tier/biome/footprint; visual state is a separate field:
- intact;
- damaged (light/moderate/severe from condition), remaining after the disaster closes if unrepaired;
- rebuilding (when actual repairs are underway);
- destroyed (only when authoritative destruction says so).

Hazard-specific overlays:
- Fire: scorch, roof holes and charred beams. Flames/smoke only for an explicit active-burning phase;
  the current disaster record alone must not cause weeks of imaginary fire during rebuilding.
- Storm: missing tiles, broken shutters/awnings, fallen debris.
- Flood: waterline staining, puddles, floating debris; floodwater confined to a real visual inundation mask.
- Drought: dry garden/field ground, stressed vegetation; do not draw burned or collapsed walls as shorthand.
- Outbreak: health/quarantine sign or treatment marker, not structural ruins or fake flooded streets.
- Repair: scaffolding, tarps and material piles positioned using per-asset attachment masks.

Suggested thresholds to approve: intact≥90%, light60–89%, moderate30–59%, severe<30%. First hazards
currently remove only6–18 percentage points, so this system must make those real changes visible.
An active hazard marker may appear even if the building remains above90%.

### Asset economy
Do not generate every combination of kind×tier×biome×hazard×severity. Preserve each recipe's layer masks
and add reusable, coordinate-anchored damage overlays, plus a small number of hand-authored ruined
silhouettes per footprint/family. Tall towers need height-aware masks and debris bounded by their lot.
Prioritize T1 cottage, fishery, farm and clinic, then tower sizes. Ruins must not look like abandoned
unfinished construction sites.

### Mechanics boundary
A renderer change does not give hazards permission to destroy buildings. If total collapse is wanted,
add a separate funded-recovery/destruction rule, with relocation, production and estate consequences,
forced-RNG tests and migration/version treatment. Otherwise the generic ruin stays a valid reserved state.
New bridges and boats need their own damage/repair records, not misuse of arbitrary building IDs.

Tests: forced hazard targets, condition thresholds, state precedence, blocked material repairs,
closed-but-damaged building stays visually damaged, outbreak not rubble, clearing overlays after actual
repair, no invented fire/flood/destruction, damage masks remain aligned across footprints.

## 10. Delivery sequence and approval gates

1. **Contracts and a technical art spike:** variable footprints/atlas/pivots, one3×3 cottage + one modular
   bridge + one8×8 megatall silhouette contact sheet at1×/2×/4×. Prove scaling/occlusion before mass production.
2. **Visible existing disasters:** damage/rebuilding DTO and overlays on present buildings; no new collapse rule.
3. **Bridge recipes and public crossing projects:** funding, reservations and road routing; river-plain tests.
4. **Static boat assets and ownership/berths:** construction/maintenance, existing shipping integration.
5. **Fishing boats and water markers:** one authoritative catch resolver, no duplicate goods.
6. **Dense3×3 tiers first:** meaningful city-centre density without land acquisition; update capacity and cost
   rules with demand-based proposals. Existing early Eden retains its low-rise look.
7. **Spatial registry and funded redevelopment:** consent, compensation, relocation and staged construction.
8. **Supertall/megatall art and rules:** only after the foundation can reserve/support their real footprints.
9. **Acceptance on a town copy:** backup/load/replay, map+Overview, screenshot sets, no live-save upgrade until
   the user explicitly approves running it.

Each phase needs its own reviewed implementation plan and cheap-model art brief. Limit artists to
one owned family file per task; test deterministic renders and inspect contact sheets rather than
asking a cheap model to implement this entire release in one go.

## 11. Unresolved decisions before implementation

- Five primary tower families and the tier4..8 footprint ladder are approved for art scaffolding;
  finalize per-service eligibility and capacity/cost tables before enabling live upgrades.
- Which boats need actual economic roles vs purely personal/nonproductive ownership?
- Whether the first bridge release should offer both timber and stone, or timber first.
- Whether building collapse is in scope now, or only visuals for the damage/repairs already simulated.
- Where to obtain imported masonry/earthwork services: existing external works payments can model these,
  but adding new mine/quarry/stone goods would be a separate economy expansion.
- Final capacity/cost/labour/maintenance tables and spatial-registry migration approval.

Staged implementation is authorized by the user. Live-save/spatial migration execution remains a separate
backup/rehearsal/confirmation gate. Do not confuse completed draft renders with approved final art.
