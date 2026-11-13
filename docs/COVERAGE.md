# Mechanics coverage checklist

This file separates two different claims, which the earlier version conflated:

1. **Implemented** — an executable code path exists and is exercised by at least one automated test.
2. **Verified acceptance gate** — the specific scenario named in `PLAN.md` has been reproduced and its
   evidence retained in this repository.

An item marked *implemented* but not *verified* is not a claim that it fails; it is a claim that the
named acceptance evidence does not exist yet. Test names refer to files under `tests/`.

## Acceptance gates with retained evidence

These reproduce the named `PLAN.md` gates and can be re-run offline:

| Gate | Evidence |
|---|---|
| Integer money, double-entry ledger, conservation under arbitrary transfers | `tests/property/accounting.test.ts` |
| Goods reconciliation gating the commit, including bootstrap | `tests/unit/bootstrap.test.ts`, `tests/integration/integrity.test.ts` |
| Canonical authoritative-state hash (every collection and rule-relevant field) | `tests/unit/hash.test.ts`, `tests/integration/integrity.test.ts` |
| Save/save-again/reload hash identity and idempotent effect rows | `tests/integration/integrity.test.ts`, `tests/integration/persistence.test.ts` |
| Crash boundaries: collection, turn-ready, before-commit, after-commit | `tests/integration/resilience.test.ts` |
| Turn/world reconciliation after restart; no duplicated day | `tests/integration/resilience.test.ts` |
| Backup verified and **restored into a separate directory** with matching state, history, and metrics | `tests/integration/persistence.test.ts` |
| Determinism under shuffled provider completion order | `tests/integration/determinism.test.ts` |
| **Default-calendar** generations: 280-day gestation, 6,570 childhood days, exact adulthood day, daily invariants, education across the whole childhood, real adult participation, persistence during the run (a one-day-early birth or stopped education fails it) | `tests/integration/lifecycle-default.test.ts` |
| Fast causal-generation integration (compressed calendar scenario, not the acceptance gate) | `tests/integration/lifecycle.test.ts` |
| Actor privacy: unrelated balances, secret crimes, private affairs, per-resident memories | `tests/integration/privacy.test.ts` |
| Crime prerequisites: access and role required, fraud bounded by a touched flow; an authorized theft transfers the real asset | `tests/integration/rules-regressions.test.ts` |
| Estates: obligation precedence, wills, protected minor trusts, disputed escrow with a deadline | `tests/integration/rules-regressions.test.ts` |
| Death/emigration lifecycle (employment, offices, partnership, assets) | `tests/integration/rules-regressions.test.ts`, `tests/integration/drama.test.ts` |
| One release event per served sentence | `tests/integration/rules-regressions.test.ts` |
| Model-requested founding, migration, and wills execute through the daily pipeline | `tests/integration/rules-regressions.test.ts` |
| Disaster recovery constrained by materials and funds, relief escrow settles | `tests/integration/rules-regressions.test.ts` |
| Bounded provider response reads and input-token budgets | `tests/integration/runtime-regressions.test.ts` |
| Usage reservations persisted before dispatch, serialised, conservative after a crash | `tests/integration/runtime-regressions.test.ts` |
| Per-dispatch model attempt audit rows | `tests/integration/runtime-regressions.test.ts` |
| SSE reconnect replays retained notifications | `tests/integration/runtime-regressions.test.ts` |
| Same-phase decisions overlap without exceeding the configured concurrency | `tests/integration/runtime-regressions.test.ts` |
| Every eligible adult is fed into the bounded pool without queue-full fallbacks (population-scale collection) | `tests/integration/runtime-regressions.test.ts` |
| Committed wills are published into live state; live hash equals the committed hash | `tests/integration/runtime-regressions.test.ts` |
| Operator policy changes apply to the staged boundary and commit atomically | `tests/integration/runtime-regressions.test.ts` |
| Checkpoint/backup bookkeeping never changes the committed hash; run flags persist | `tests/integration/runtime-regressions.test.ts` |
| Storage headroom is reserved *before* collection, so a near-budget run pauses before spending | `tests/integration/runtime-regressions.test.ts` |
| Provider profile keys agree between probe and runtime; probing discovers plain JSON in ≤3 requests | `tests/integration/runtime-regressions.test.ts` |
| A timed-out dispatch keeps its reserved output allowance (no silent spending release) | `tests/integration/runtime-regressions.test.ts` |
| Disputed estate awards route through the same protected minor trust; release happens at adulthood | `tests/integration/rules-regressions.test.ts` |
| Sabotage requires access (employment/management/ownership/premises), refused without stock changes | `tests/integration/rules-regressions.test.ts` |
| Disaster relief compensates a causally attributed injury once, from its own disaster | `tests/integration/rules-regressions.test.ts` |
| Relationship/account keys are canonical (a custom key would diverge on reload) | `src/domain/invariants.ts`, `tests/integration/runtime-regressions.test.ts` |
| Storage budget covers the whole owned data tree | `tests/integration/runtime-regressions.test.ts` |
| Town detection from the saved world; `doctor` leaves no database | `tests/integration/runtime-regressions.test.ts` |
| Population ceiling / empty town pause with frozen committed time | `tests/integration/runtime-regressions.test.ts` |
| Live day progress, causal navigation, inert hostile text, controls | `tests/e2e/dashboard.spec.ts` |
| Long soak invariants, goods reconciliation, archives, memory series | `npm run test:soak -- --days 10000 --provider mock` |

## Implemented, with unit/integration coverage

### Economy and accounting

- [x] Integer money with double-entry ledger — `src/domain/turn-context.ts`, `tests/property/accounting.test.ts`
- [x] Goods flows with running reconciliation — `src/domain/turn-context.ts`, `src/domain/invariants.ts`
- [x] Recipes with prorated partial labour and input limits — `src/domain/economy/production.ts`
- [x] Market matching with price priority and seeded tie-breaks — `src/domain/economy/market.ts`
- [x] Household provisioning and default basket — `src/domain/economy/market.ts`
- [x] Bounded external trade with a credit line — `src/domain/economy/trade.ts`
- [x] Wages, income tax, business levy, wealth levy, child allowance, citizens' dividend — `src/domain/economy/ledger.ts`, `src/domain/events/politics.ts`
- [x] Business founding, closure, liquidation, capital calls, layoffs — `src/domain/economy/businesses.ts`
- [x] Public services (clinic, guard, court, shop, public works) — `src/domain/events/politics.ts`

### Generations, families, population

- [x] Daily ageing, education, exact adulthood boundary — `src/domain/clock.ts`, `src/domain/society/education.ts`
- [x] Explicit-consent partnerships shared eligibility validation — `src/domain/society/relationships.ts`
- [x] Conception with depth-2 kinship, food security, target and host-ceiling capacity — `src/domain/society/relationships.ts`
- [x] Pregnancies and births — `src/domain/society/demographics.ts`
- [x] Mortality resolver — `src/domain/events/health.ts`
- [x] Estates: obligations, wills, disputed escrow, protected minor trusts, escheat — `src/domain/society/estates.ts`
- [x] Departure lifecycle for death and emigration — `src/domain/society/lifecycle.ts`
- [x] Guardianship reassignment and rehousing — `src/domain/society/households.ts`
- [x] Divorce with asset split and dependent care — `src/domain/society/relationships.ts`
- [x] Immigration and emigration — `src/domain/society/population.ts`
- [x] Soft population target and hard ceiling with runtime pauses — `src/domain/society/population.ts`, `src/runtime/runner.ts`

### Hazards and health

- [x] Versioned hazard opportunities with drama presets — `src/domain/events/disasters.ts`
- [x] Disasters damaging specific buildings/stock within envelopes — `src/domain/events/disasters.ts`
- [x] Evacuation, funded relief, material repair, closure and refund — `src/domain/events/disasters.ts`
- [x] Contact-based disease, treatment capacity, medicine, recovery — `src/domain/events/health.ts`
- [x] Injuries, disability, death routing through one resolver — `src/domain/events/health.ts`

### Civic institutions, crime, justice

- [x] Council seats, annual elections, vacancies, succession — `src/domain/events/politics.ts`
- [x] Factions forming from sustained grievance — `src/domain/events/politics.ts`
- [x] Theft with access, motive, opportunity, bounded transfer — `src/domain/events/crime.ts`
- [x] Fraud, bribery, tax evasion, sabotage with role prerequisites and evidence — `src/domain/events/crime.ts`
- [x] Allegation → investigation → trial → verdict → sentence — `src/domain/events/justice.ts`
- [x] Fines, restitution, probation, time-limited imprisonment, single release — `src/domain/events/justice.ts`
- [x] Estate disputes resolved by the court at a deadline — `src/domain/events/justice.ts`

### Interpersonal and collective drama

- [x] Affairs with discovery and scandal consequences — `src/domain/society/relationships.ts`
- [x] Feuds, reconciliation, rumours — `src/domain/society/relationships.ts`
- [x] Strikes with demands, participation, concession, return to work — `src/domain/events/unrest.ts`
- [x] Protests and documented riot escalation — `src/domain/events/unrest.ts`
- [x] Abstract assault, injury, and fatal-attack classification — `src/domain/events/crime.ts`, `src/domain/events/health.ts`
- [x] Rebellion thresholds, negotiation/authority change, restoration — `src/domain/events/unrest.ts`

### Models, memory, presentation

- [x] OpenAI-compatible client with capability downgrade and bounded response reads — `src/model/client.ts`
- [x] Capability probing that persists a provider profile — `src/model/probe.ts`
- [x] Local validation of every returned plan — `src/model/validate.ts`
- [x] One bounded repair, then recorded fallback — `src/model/jobs.ts`
- [x] Enforced input-token budget on the complete message list — `src/model/jobs.ts`
- [x] Per-dispatch attempt audit rows — `src/storage/job-repo.ts`, `src/model/jobs.ts`
- [x] Privacy-filtered observations and provenance memories — `src/application/observations.ts`
- [x] Reciprocal dialogue with bounded rounds and conversations — `src/runtime/runner.ts`
- [x] Evidence-grounded newspaper with labelled rumours — `src/application/newspaper.ts`
- [x] Durable usage reservations, ceilings, auth/quota pauses — `src/runtime/usage.ts`

### Runtime, storage, operations

- [x] Concurrent same-phase collection through the bounded pool — `src/runtime/runner.ts`, `src/runtime/pool.ts`
- [x] Staged resolution published only after an atomic commit — `src/runtime/runner.ts`
- [x] Atomic world + turn + command disposition commit; restart reconciliation — `src/storage/repositories.ts`, `src/storage/job-repo.ts`
- [x] Crash-safe turn/job state machine — `src/storage/job-repo.ts`
- [x] Single-writer lock — `src/storage/lock.ts`
- [x] Verified online backups, rotation, restore — `src/storage/backup.ts`
- [x] Canonical checkpoints and state hashes — `src/storage/checkpoints.ts`, `src/domain/hash.ts`
- [x] Retention, checksummed archives, verified pruning — `src/application/retention.ts`
- [x] Storage budget over the whole data tree, with reservation before writes — `src/application/retention.ts`, `src/runtime/runner.ts`
- [x] Dashboard views, bounded APIs, SSE replay/resync, CSRF/Origin checks — `src/http/**`, `client/src/**`
- [x] Offline status/doctor/backup commands; doctor never creates the authoritative database — `src/cli.ts`, `src/application/diagnostics.ts`
- [x] Graceful shutdown with a drain budget, request cancellation, and late-result fencing — `src/runtime/shutdown.ts`
- [x] Provider/config/disk/ceiling/invariant pauses with recovery hints — `src/runtime/runner.ts`, `src/application/status.ts`

## Acceptance evidence not yet retained

These remain unproven by evidence in this repository. They are listed honestly rather than ticked:

- A **500-resident stress run** with concurrent decision collection and measured storage growth.
- **Status/control p95 latency** under load (no latency benchmark is scripted).
- A **live paid-model smoke run** (requires operator credentials; `npm run doctor -- --probe` performs one
  authorized probe request but is not a town run).
- **Drama-family closure matrices** for every family (some families have prerequisite/success/closure
  tests; not all are covered with forced RNG).
- A **soak that actually produces births and generations** (the baseline soak is economically stable but
  rarely reaches conception; causal generations are proven by the default-calendar gate above).
- **Crash-boundary rehearsals for archive, backup, and migration** (the four collection/commit boundaries
  are covered by process kills; these other boundaries are not).
- A **browser-level race test** for superseded revision responses. The views now drop responses whose
  request generation is stale (`client/src/views/*`), but there is no frontend unit/browser harness that
  delays revision N to prove N+1 survives; the guarantee is source-level and reviewed, not automated.
