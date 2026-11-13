# Resource-funded growth — operator notes (implementation draft)

**type:** operations
**context:** domain
**status:** pending final verification

## New towns only

The revised Eden scenario is a new gameplay family (`eden-growth-1`). Existing Eden and Tidehaven
worlds are not silently rewritten. Startup uses each saved world's stored scenario snapshot. A
separate data directory is the safe way to found the revised town; never delete a town to apply code.

Configuration (edit your own .env; implementation never changes it):

```dotenv
TIDEHAVEN_SCENARIO=eden
TIDEHAVEN_WORLD_NAME=Eden
TIDEHAVEN_DATA_DIR=D:/Projects/Tidehaven/data-eden-growth
TIDEHAVEN_POPULATION_POLICY=disabled
TIDEHAVEN_HOST_CEILING=500
```

A disabled population policy is not infinite resources. It only stops using the social target to
block immigration/conception or trigger target-pressure departures. The host ceiling still pauses
the simulation; entity, project, API, storage and queue bounds remain finite.

## Housing

A newcomer starts in a camp if no vacant house exists. The model may ask an adult host for a room
with `request_housing`; every current adult host must reply `accept_housing` to that request ID.
`refuse_housing`, silence, changed host roster, full beds or expiry prevent a move. An accepted move
is non-romantic. Initial sharing is limited to independent single-adult camps so partners and children
are not abandoned by the move. The sole camp's pooled assets move to the chosen household through
recorded transfers; outstanding reservations block the move.

Without an agreement, the model can still choose `build_home`. That consumes work and timber. A
five-person home is capacity, not a guarantee five people will agree to live together.

## Productive expansion

Models can propose `build_workplace` from known scenario templates or `expand_building` for a permitted
building. Work is continued with `work_construction` using the project ID. Materials, construction
costs and startup funds are checked and secured; there is no free output or arbitrary model-defined
recipe. Sites cannot operate before completion. Completed capacity still needs workers, funded wages,
inputs and demand before it produces more food or goods.

The dashboard Town page shows projects and household occupancy. Safety caps and disabled social policy
must be visible separately. Final verification report will list exact tests and measured outcomes;
scripted tests do not prove the paid model will make good town-planning decisions.
