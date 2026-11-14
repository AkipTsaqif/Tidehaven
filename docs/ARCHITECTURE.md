# Architecture

Tidehaven is one Node.js process with four cooperating parts and hard boundaries between them.

```
                ┌──────────────────────────────────────────────────────────┐
 browser ──────▶│ Fastify (HTTP + SSE)  src/http/*                          │
                └───────┬──────────────────────────────────────────────────┘
                        │ read models / queued commands
                ┌───────▼──────────────────────────────────────────────────┐
                │ Runner  src/runtime/runner.ts                            │
                │  day loop · bounded pool · usage · pause/resume          │
                └───────┬───────────────────────┬──────────────────────────┘
                        │ decisions             │ commit
        ┌───────────────▼──────────┐   ┌────────▼─────────────────────────┐
        │ Model layer src/model/*  │   │ Storage src/storage/*            │
        │ OpenAI-compatible fetch  │   │ node:sqlite, migrations, jobs,   │
        │ validate · fallback      │   │ backups, checkpoints, lock       │
        └───────────────┬──────────┘   └────────┬─────────────────────────┘
                        │ untrusted JSON        │ authoritative state
                ┌───────▼───────────────────────▼──────────────────────────┐
                │ Domain  src/domain/*                                     │
                │ deterministic rules: economy, society, events            │
                └──────────────────────────────────────────────────────────┘
```

## Boundaries

- `src/domain/**` is pure logic over `WorldState`. It imports no HTTP, no database, no model client,
  and reads no wall clock. All randomness arrives as `Rng` streams derived from
  `(seed, day, phase, entity, action)`.
- `src/storage/**` owns SQLite. It never contains rules; it hydrates and persists `WorldState` and
  keeps the turn/job machine.
- `src/model/**` owns the network. It turns a prompt into a validated `Plan`; it never touches state.
- `src/application/**` composes: bootstrap, prompts' context, the newspaper digest, queries,
  diagnostics, retention, soak.
- `src/runtime/runner.ts` is the only place that advances time. It collects plans through a bounded
  pool, calls `runDay`, checks invariants, and commits atomically.

## The day

`runDay` (src/domain/turn-engine.ts) executes a fixed phase order (see `docs/RULES.md §2`):
schedule → hazards → protect → household → labour/production → market → civic → conflict → unrest →
justice → health → demography/education/population → trade → invariants.

Every phase receives a `TurnContext` that is the only sanctioned way to mutate state:

- `transfer()` writes two ledger rows (double entry) with a stable transaction id.
- `shiftGoods()` writes one goods-flow row; negative stock throws.
- `emit()` appends an event with actor/target/visibility; events are the only story record the
  newspaper may cite.

The runner resolves a day against a **detached staged copy** of the world and only publishes it after
the commit. A day is committed by `saveState()` in one SQLite transaction: upserts of every snapshot
table plus inserts of the day's events, ledger, flows, observations, memories, tax records, shipping
and the newspaper, then the metrics row, the canonical state hash, the turn's `committed` transition,
and the dispositions of the operator commands whose effects the day contains. Because all of that is
one transaction, a crash can never leave the world ahead of its turn or lose an applied command.

Every append-only accounting row carries a content-derived `effect_key` with a uniqueness constraint,
so replaying a committed payload inserts nothing new instead of duplicating audit rows.

## Determinism and replay

- `stateSnapshot()` + `hashValue()` produce a canonical hash over **all** authoritative state: every
  entity collection and every rule-relevant field, in stable order. Only explicitly derived or
  volatile fields are excluded (the denormalised `business.cashCents` projection, audit timestamps,
  and the transient `health.lastCheckDay`). Two different worlds must never share a hash.
- Two runs with the same seed, rules, and stored decisions produce the same hash regardless of the
  order in which model responses arrived (tested in `tests/integration/determinism.test.ts`).
- A fresh language-model call is *not* reproducible, and the plan says so: reproducibility covers the
  engine given stored decisions, not the model.

## Crash safety

Turns move `collecting → ready → committed`; jobs are keyed `(world, day, phase, actor, kind)` and store
their terminal result. A restart:

1. reads the last committed day from `worlds`,
2. finds an open turn for `day + 1`,
3. reuses `done`/`fallback` job results and re-requests only the missing ones,
4. applies the day once and commits.

A `ready` turn is applied without any model call. Effect ids and unique keys make double application
impossible; the lock (an exclusively created file held open for the process lifetime) makes a second
writer impossible.

## Money and goods

Money is integer cents; goods are integer units. Every movement is recorded:

- ledger entries (double entry, `ownerType/ownerId`)
- goods flows (single entry with owner and reason)

`checkInvariants()` (daily, before commit) verifies integer safety, non-negative internal balances,
money conservation against the bootstrap base (external settlement included), goods non-negativity,
reservation bounds, partnership symmetry, household assignment, pregnancy timelines, price validity,
and **goods reconciliation** (`checkGoodsLedger()` runs inside `checkInvariants()`, so an unreconciled
stock change fails the production commit gate rather than only a harness check).

## Pause, resume, and failure policy

The runner pauses at day boundaries only. Reasons: `configuration`, `authentication`, `quota`,
`provider_down`, `disk_pressure`, `storage_budget`, `invariant_failure`, `engine_error`,
`population_ceiling`, `town_empty`, `operator`. A pause is written to `data/<scenario>/pause.json`, broadcast over
SSE, and never fabricates a day. While paused the process keeps serving the dashboard, so the operator
can inspect, fix configuration, and resume.

## Storage layout

One folder per scenario by default (`data/tidehaven/`, `data/eden/`, ...); `TIDEHAVEN_DATA_DIR`
overrides it. Each folder holds one town:

```
data/<scenario>/
  tidehaven.sqlite       authoritative state (WAL)
  tidehaven.sqlite-wal   WAL
  backups/               verified SQLite online backups (rotating)
  archives/              gzipped, checksummed detail chunks
  checkpoints/           canonical JSON snapshots + hashes
  logs/                  daily JSON logs (rotating)
  pause.json             current pause reason (if any)
  world.json             small mirror for offline `npm run status`
```

## Town map (dashboard)

The Map tab is an observer view served by `GET /api/map` (`src/application/map-query.ts`). It is
read-only and stores nothing: lot positions are derived each request by `src/application/map-layout.ts`
from the world seed and building ids. The island is a fixed function of the seed. Candidate lots
have one fixed order (centre first, seeded jitter). Buildings take the first free usable lot in id
order, so a building's position depends only on buildings with smaller ids. Buildings are never
deleted and ids only grow, so existing buildings never move as the town grows. Fisheries (and
fishery sites) need a shore lot. Camps (households without a building) fill the next free lots after
all buildings. Each lot is 3x3 tiles of 32x16 px on a 4-tile pitch; the spare row is road or open
ground, so lots cannot overlap. The biome uses the same formula as `art/biomes.lua`; Eden is tropical.
Sprites come from the committed atlas in `client/public/map/`, packed by `scripts/art-atlas.py`.
Changing the layout code reshuffles every town's map once. That is acceptable because nothing
depends on map positions.

## Plan-to-code module map

The approved plan lists module names; a few were consolidated to keep modules purpose-sized. The full
mapping is explicit here so nothing looks missing:

| Planned module | Actual location | Why |
|---|---|---|
| `src/domain/turn-engine.ts` | same | unchanged |
| `src/domain/events/framework.ts` | `src/domain/turn-context.ts` | the shared event/cost/capacity/visibility primitives live in the turn context every phase uses |
| `src/application/observations.ts`, `memories.ts` | `src/model/prompts.ts` + `src/application/queries.ts` | observation building and memory retrieval are prompt construction and read models respectively |
| `src/application/recovery.ts` | `src/storage/job-repo.ts` + `src/runtime/runner.ts` (`resumeOrStartTurn`) | recovery *is* the turn/job state machine |
| `src/application/retention.ts` | same | retention, archives, budget guards |
| `src/application/newspaper.ts` | same | digest + factual newspaper body |
| `src/application/diagnostics.ts`, `status.ts`, `commands.ts`, `soak.ts`, `scenario.ts`, `bootstrap.ts` | same | |
| `src/storage/database.ts`, `migrate.ts`, `repositories.ts`, `checkpoints.ts`, `backup.ts`, `lock.ts` | same, plus `job-repo.ts` and `commands-repo.ts` | turn/job and command queues split out of the god-repository |
| `src/http/security.ts` | inside `src/http/server.ts` | the CSRF/origin/host policy is a handful of Fastify hooks; one file stays reviewable |
| `src/runtime/pool.ts`, `limits`→`usage.ts`, `shutdown.ts`, `telemetry.ts`, `crash.ts` | same | `usage.ts` carries ceilings and reservations |
| `scripts/doctor.ts`, `verify.ts`, `soak.ts` | `src/cli.ts` commands + `scripts/verify.mjs` + `src/application/soak.ts` | one CLI, one verify driver; no duplicate entry points |
| `src/domain/economy/*`, `src/domain/society/*`, `src/domain/events/*` | same | unchanged |
| `client/src/views/*` | same, plus `Residents.tsx` and `Resident.tsx` | list and detail split |

`agenda`-style scheduling (`src/domain/society/demographics.ts`) covers ageing, births, deaths and
estate opening in one phase, which is exactly the `schedule`/`demography` split in `docs/RULES.md §2`.

## Testing pyramid

- `tests/unit` — pure rules (calendar, RNG streams, hashing, invariants, scenario contract).
- `tests/property` — fast-check over money and goods accounting.
- `tests/integration` — economy, generations, justice, unrest, model adapter (with a fake provider),
  persistence/crash boundaries, retention.
- `tests/e2e` — Playwright against a real server with the fixture decision source.
- `npm run test:soak` — 10 000-day offline run over the real SQLite path.
