# Tidehaven implementation review

## Resolution status

All 26 implementation findings and all five verification/handoff defects have been addressed in the
code and covered by regression tests; `docs/RUN-REPORT.md` §0 maps each finding area to its evidence.
Where a correction changes a documented rule (crime contests, kinship depth, estate precedence,
prorated labour, `write_will`), `docs/RULES.md` was updated in the same change. This section records
resolution, not a re-review.

## Verdict

**Changes required before declaring the approved foundation complete.**

The implementation passes its existing offline checks in the current built workspace.
Those results do not establish every acceptance requirement in `PLAN.md`.
This review records confirmed defects and acceptance gaps, not a request to expand the approved scope.

## Scope and method

- Compared `PLAN.md` with the implementation, architecture, coverage checklist, and acceptance tests.
- Reviewed accounting, society/drama, runtime/storage, and model/HTTP/dashboard boundaries.
- Used offline fixtures and fresh temporary databases only. No paid provider requests.
- Did not modify application source, configuration, or the approved plan.
- Build and browser commands generated normal build output and disposable test data.
- The directory has no `.git` metadata. A Git diff and churn analysis were unavailable.

Severity: **High** threatens core correctness, privacy, durability, or a required safety boundary.
**Medium** breaks a supported workflow or leaves a material acceptance requirement unproved.

The review found **26 implementation findings** and **five verification/handoff defects**.
Findings include both executed counterexamples and confirmed source-level call-path defects.
Corrections describe required outcomes, not approved implementation patches.

**First priorities:** F12/F20/F22 for commit and recovery safety, F13 for population guards, and F6/F7/F23/F24 for provider resource safety.
F1–F3 affect the integrity checks that other acceptance claims rely on.

## Fresh verification results

| Check | Observed result |
|---|---|
| `npm run verify` in the existing built workspace | Pass: server/client typecheck, lint, 88 tests across 15 files, production build |
| `PLAYWRIGHT_BROWSERS_PATH=.playwright npm run test:e2e` | Pass: 7 browser tests |
| `npm run test:soak -- --days 10000 --provider mock` with a separate temporary data directory | Pass: 10,000 days, daily invariants and goods reconciliation, 321/321 archive checks |
| Baseline soak measurements | 335.3 seconds, 27 living residents, 23 deaths, 46 hungry resident-days, money supply 76,000 → 76,000 |
| `npm run test:soak -- --days 1000 --provider mock --drama` with separate temporary data | Pass: 1,000 days, 21/21 archive checks, zero recorded crimes |
| `npm run verify` in a source-only temporary copy without `dist/` | **Fail:** both process-resilience tests time out. The other 86 tests pass |
| Explicit build, then the two process-resilience tests in that same copy | Pass: 2/2 |
| Full verification in the temporary copy after that build | Pass: 88/88 and production build |
| `npm audit --json` | Seven moderate dependency entries, zero high/critical. Entries share a development-tooling `minimatch` advisory |
| `npm audit --omit=dev --json` | Zero reported production dependency vulnerabilities |

The soak uses an in-process decision source. It does not prove production HTTP scheduling or model behavior.
A single final memory measurement does not establish a memory-growth trend.
Zero crimes in the drama soak does not prove that crime mechanics work or fail.

## Confirmed implementation findings

### F1 — High: canonical hashes omit authoritative state

**Locations:** `src/domain/hash.ts:59–129`, `src/domain/state.ts:330–383`.

The snapshot excludes contracts, relationships, factions, memberships, unrest, grievances, proposals, disasters, and building condition.
Several included entities also omit rule-relevant fields.
Different authoritative worlds can therefore share the same hash.

**Reproduction:** Changed an active employment contract to `ended` in a fresh in-memory town. The hash remained identical.
**Impact:** Replay comparisons and checkpoint integrity checks cannot detect these divergences.
**Correction:** Hash all authoritative fields in stable order. Exclude only explicitly derived or volatile fields.
**Regression:** Mutate each authoritative collection and rule-relevant field independently. Require a different hash.
**Plan:** T2 requires canonical authoritative-state hashes and replay equality.

### F2 — High: saving a day changes the state after its hash is computed

**Locations:** `src/runtime/runner.ts:298–319`, `src/storage/repositories.ts:707–710`, `src/domain/hash.ts:80–88`.

The runner computes the committed hash before `saveState()`.
During save, the repository updates `business.cashCents` from the account balance.
The hash includes that denormalized field, so the stored hash can describe the pre-save state rather than the committed state.

**Reproduction:** Ran day one in a fresh in-memory town, computed its hash, then saved it.
The save changed the hash. The stored daily-metrics hash did not equal the post-save state hash.
**Correction:** Remove derived cash from canonical state, or synchronize it before hashing. Keep persistence free of authoritative-state mutations.
**Regression:** Require identical hashes before save, after save, and after database reload.

### F3 — High: daily commit invariants omit goods reconciliation

**Locations:** `src/domain/turn-engine.ts:109–110`, `src/domain/invariants.ts:29–175`.

`runDay()` uses `checkInvariants()`, which does not call the separate `checkGoodsLedger()` function.
Stock and recorded flows can disagree without failing the production commit gate.
The soak checks reconciliation separately, which masks this difference between the harness and runner.

**Reproduction:** Increased `goodsFlow:grain` by one without changing stock in a fresh town.
`checkInvariants().ok` remained `true`, while `checkGoodsLedger()` reported `goods_unreconciled`.
**Correction:** Include reconciliation violations in the invariant report that controls commit.
**Regression:** Introduce an unrecorded stock change and require a safe pause with no committed day.
**Plan:** T3 requires daily goods-flow reconciliation before commit.

### F4 — Medium: production discards valid fractional-day labor

**Locations:** `src/domain/economy/production.ts:58–96`, `docs/RULES.md:64,92`.

Production rounds labor down to whole recipe batches before calculating output.
The published rule instead prorates integer output from applied labor.
For a farm producing eight grain per 100 labor points, an isolated elder's 50 points produce zero instead of four.
Tool penalties and damaged buildings can also turn otherwise useful labor into zero production.

**Correction:** Apply the documented integer prorating rule with bounded inputs and recorded goods flows.
**Regression:** Cover 50-point elder labor, tool penalties, damaged premises, and input-limited partial output.

### F5 — High: crime prerequisites do not enforce access and role restrictions

**Locations:** `src/domain/events/crime.ts:206–274`, `docs/RULES.md:189–194`.

For cross-household theft, `hasAccess()` only checks whether the victim's household has a building.
It does not establish the actor's access or shared location.
Ordinary housed victims therefore satisfy the access check for unrelated actors.

Fraud checks the target account and funds but not an office, business role, or accessed transaction.
A resident can attempt to siphon another account without the required authority or opportunity.
The five-percent cap uses the entire balance rather than a qualifying transaction flow.

**Correction:** Validate access and role prerequisites before the seeded contest. Derive fraud bounds from an identified eligible flow.
**Regression:** Reject unrelated, unauthorized attempts without transfers. Cover authorized success, failure, evidence, and closure.
**Plan:** T6 requires causal crime mechanics with access, opportunity, and traceable benefits.

### F6 — High: provider response limits apply only after full buffering

**Locations:** `src/model/client.ts:103–126`, `src/model/probe.ts:29–50`.

The client reads `response.text()` before checking `maxResponseBytes`. The probe has no response-byte check.
An oversized provider response therefore consumes memory before rejection. A request timeout does not impose a memory bound.
**Correction:** Read a bounded stream and abort immediately at the byte limit. Apply the same protection to probing and error bodies.
**Regression:** Serve an oversized chunked response and assert that reading stops at the configured bound.
**Plan:** T8/T9 require hard response-byte limits, including malformed provider responses.

### F7 — High: the configured input-token limit is never enforced

**Locations:** `src/config.ts:39`, `src/model/prompts.ts:142–163`, `src/model/jobs.ts:123–165`.

`maxInputTokens` appears in configuration validation but has no consumer in the implementation.
Prompt construction limits bytes, while dispatch checks spending ceilings rather than the per-request input limit.
Repair messages add further input beyond the original prompt estimate.
**Correction:** Bound the complete message list before every dispatch, including dialogue and repairs. Label estimates honestly without claiming hard tokenizer guarantees.
**Regression:** Reject or trim oversized Unicode/context prompts and repair messages before HTTP dispatch.

### F8 — Medium: resident decisions run serially despite the configured pool

**Location:** `src/runtime/runner.ts:392–447`.

`collectPlans()` awaits each `pool.run()` inside the actor loop before submitting the next actor.
Only one resident decision can run at a time. A concurrency setting of eight does not change that sequence.
**Correction:** Feed persisted jobs incrementally into the bounded pool, then await the phase barrier.
**Regression:** Use delayed fake responses and assert multiple overlapping requests without exceeding configured caps.
**Plan:** T9 requires concurrent same-phase collection for maximum-throughput operation.

### F9 — Medium: detail tabs do not refresh as the simulation advances

**Locations:** `client/src/App.tsx:17–37,79–86`, `client/src/views/History.tsx:32–46`, and the equivalent detail-view effects.

SSE updates status and an unused revision value. Detail views receive no revision or day dependency.
For example, History fetches only on mount or search changes. Its newspaper and events remain stale on an open tab.
**Correction:** Propagate the committed revision to bounded view queries, or invalidate their cached data.
**Regression:** Keep History, Town, Drama, and a resident open across commits and verify their details update without tab switching.

### F10 — Medium: SSE reconnect omits retained notifications

**Location:** `src/http/sse.ts:37–50`.

`add()` reads `Last-Event-ID` only to determine whether the replay window expired.
For an ID still inside the retained window, it sends no missed retained events.
**Reproduction:** Published revisions one and two, then connected with `Last-Event-ID: 1`.
The hub returned `resync: false` and only `: connected`, without revision two.
**Correction:** Replay notifications after the supplied ID, or request an explicit revision resync.
**Regression:** Disconnect after one revision, publish two more, then reconnect with the prior ID and verify recovery.

### F11 — Medium: provider probing and audit persistence are incomplete

**Locations:** `src/model/probe.ts:29–80`, `src/cli.ts:109–117`, `src/storage/job-repo.ts:269–305`, `src/model/jobs.ts:164–222`.

The probe tests JSON-object mode only. It neither discovers JSON Schema support nor persists its result as a provider profile.
The implementation defines `recordAttempt()` but never calls it. Per-attempt HTTP status, mode, timing, and retry/repair evidence remain absent from `model_attempts`.
**Correction:** Persist capability discovery and bounded redacted attempt records without changing providers or making unauthorized extra paid calls.
**Regression:** Exercise schema/object/plain capability results and verify one audit row per actual dispatch across retries and restart.
**Plan:** T8/T9 require provider profiles and durable per-attempt diagnostics.

### F12 — High: failed resolution leaves uncommitted state in the runner

**Locations:** `src/domain/turn-engine.ts:60–63`, `src/runtime/runner.ts:182–190,231–290`.

The engine mutates the live state, including its day, before checking invariants.
On an exception, invariant failure, or database write failure, the runner pauses without restoring the committed snapshot.
`resume()` only clears the pause. Its next day derives from the already-mutated state.
**Impact:** The dashboard can expose uncommitted outcomes. Same-process resume can skip the failed day or build on invalid state.
**Correction:** Resolve against a staged copy. Publish it only after a successful atomic commit.
**Regression:** Force an invariant failure after mutations, then resume and compare against restart from the last committed state.

### F13 — High: population safety pause requests have no runtime consumer

**Locations:** `src/domain/society/population.ts:46–81`, `src/runtime/runner.ts:231–340`.

The population resolver sets `pauseRequested` and a numeric reason at the host ceiling or an empty town with target zero.
No runtime code reads either counter. The runner continues resolving and committing days.
The existing ceiling test checks the counter, not an actual pause.
**Correction:** Enforce explicit `population_ceiling` and `town_empty` guards at the runner boundary, including protected-birth capacity checks.
**Regression:** Assert frozen committed time and the correct visible pause reason, not only a domain counter.

### F14 — High: social acceptance does not revalidate eligibility or complete kinship checks

**Locations:** `src/domain/society/relationships.ts:95–149,179–298`.

The kinship check handles direct parents and siblings, but not grandparents or avuncular relationships.
A fresh in-memory grandparent/child/grandchild fixture returned `false` for grandparent–grandchild blocking.

Acceptance locates a pending proposal but does not revalidate all participant, housing, food, or relationship prerequisites.
Conception resolution rechecks the mother's sex and population target but omits other checks made when proposing.
A proposer's death or departure does not by itself prevent acceptance of the stale proposal.
**Correction:** Share one eligibility validator between proposal and final resolution. Traverse the required kinship depth and reserve household/care capacity.
**Regression:** Cover grandparent and avuncular pairs, stale proposals, unavailable participants, changed relationships, and lost capacity.

### F15 — High: estate settlement does not protect minor assets or implement promised precedence

**Location:** `src/domain/society/estates.ts:17–25,72–150`.

Every newly opened estate sets `will: null` and immediately distributes fixed shares.
The resolver does not settle recorded lawful obligations first or create the promised dispute process.
For a minor with a guardian, `minor_heir_trust` transfers the money into the guardian's ordinary resident account.
That label does not create protected ownership or prevent the guardian from spending the inheritance.
**Correction:** Implement obligation precedence, valid wills, dispute escrow, and separately owned protected minor assets.
**Regression:** Verify creditor priority, will overrides, disputed deadlines, stable remainders, and release of protected assets at adulthood.

### F16 — High: death and departure leave active obligations and ownership behind

**Locations:** `src/domain/events/health.ts:205–239`, `src/domain/society/population.ts:146–210`, `src/domain/society/estates.ts`.

Death does not end employment or clear a surviving partner's active partnership.
Dead contracts count toward hiring capacity although the dead worker supplies no labor.
Emigration closes employment and offices but leaves resident-owned businesses and resident-level stock attached to departed owners.
**Reproduction:** Killed an employed partner and settled their estate in a fresh town.
The employment contract remained `active`, and the surviving partner still pointed to the deceased.
**Correction:** Close or transfer obligations and assets through a shared departure/death lifecycle while retaining lineage history.
**Regression:** Verify staffing replacement, valid widowhood, business management, and complete asset settlement after death and emigration.

### F17 — Medium: a served prison sentence emits release every subsequent day

**Locations:** `src/domain/society/demographics.ts:24–28`, `src/domain/events/justice.ts:78–99`.

The schedule marks an expired sentence `served`. Justice emits a release for every served sentence without recording that release occurred.
**Reproduction:** Ran justice on successive days with one served sentence. Both days emitted `prisoner_released`.
**Correction:** Emit release only at the sentence transition or persist a unique release effect.
**Regression:** Advance several days after expiry and require exactly one release event across restart.

### F18 — High: model-requested founding and migration have no action dispatch

**Locations:** `src/contracts/actions.ts:13–24`, `src/domain/turn-engine.ts:70–104`, `src/domain/economy/businesses.ts:17`.

The schema accepts primary `found_business` and `migrate` actions.
The daily phase handlers do not dispatch them, and `foundBusiness()` has no caller.
These model decisions therefore do not execute the advertised mechanisms.
**Correction:** Wire validated primary actions to bounded domain resolvers and record explicit rejection reasons.
**Regression:** Execute both actions through the normal daily pipeline and assert funded ownership changes or consistent departures.

### F19 — Medium: disaster recovery lacks material relief and repair accounting

**Location:** `src/domain/events/disasters.ts:155–238`.

Relief moves treasury funds into `escrow:0`, but the resolver does not allocate those funds to repairs or affected residents.
Recovery directly increases building condition without repair inputs or payments. The protective phase does not execute evacuation or rehousing.
**Correction:** Connect relief to funded care, shelter, and repair work with finite labor and material costs.
**Regression:** Verify that unavailable resources constrain recovery, funded relief changes outcomes, and escrow settles at closure.

### F20 — High: world commit and turn commit are separate transactions

**Locations:** `src/runtime/runner.ts:316–319,342–354`, `src/storage/job-repo.ts:79–83`.

`saveState()` commits world outcomes before the separate `markTurnCommitted()` call.
A crash between them leaves the committed world ahead of its turn lifecycle.
Restart selects the next day without reconciling the older ready turn.
**Reproduction:** Ran a fresh fixture town with `TIDEHAVEN_CRASH_AT=after_commit` and `TIDEHAVEN_CRASH_MODE=exit`.
The process exited 137. SQLite contained world day one as `committed`, but turn day one remained `ready`.
**Correction:** Commit world outcomes and the matching turn transition atomically. Reconcile existing inconsistent records safely.
**Regression:** Kill before and after every commit boundary and verify exactly one coherent committed turn per world day.

### F21 — High: repeated save inserts duplicate accounting effects

**Locations:** `src/storage/repositories.ts:1229–1284`, `src/storage/migrations/002-society.sql`.

Ledger entries, goods flows, observations, and memories use plain inserts without stable effect uniqueness.
Repeating the same committed payload therefore duplicates audit rows, even if snapshot tables remain unchanged.
**Reproduction:** Saving one identical day payload twice increased ledger rows from 116 to 232 and goods-flow rows from 25 to 50.
**Correction:** Add stable effect identifiers and uniqueness constraints. Treat replay of an accepted payload as idempotent.
**Regression:** Apply the same save payload twice and require unchanged ledger, flow, observation, and memory counts.

### F22 — High: commands become applied before their world changes are durable

**Locations:** `src/runtime/runner.ts:638–680,316–319`.

Target/settings changes and injections mutate memory, then `completeCommand()` marks them applied before the world commit.
A crash during collection loses the mutation, but restart no longer sees a pending command to replay.
**Correction:** Commit command disposition with its authoritative boundary effects, or persist a recoverable prepared boundary snapshot.
**Regression:** Crash after command application but before day commit. Verify the target, settings, and injection survive exactly once.

### F23 — High: usage checks do not reserve or persist dispatched work

**Locations:** `src/runtime/usage.ts:107–151`, `src/model/jobs.ts:135–169`.

`assertWithinBudget()` only reads recorded totals. It does not reserve requests or tokens before dispatch.
Usage records appear after the HTTP response. A crash after a billable dispatch loses that request from local accounting.
Concurrent callers can also pass the same remaining allowance before either records usage.
**Correction:** Persist pre-dispatch reservations and reconcile actual or uncertain usage. Include repair messages in the reserved input estimate.
**Regression:** Restart after dispatch without a response and retain conservative spending. Race callers against a single remaining allowance.
**Plan:** T9 requires durable usage reservations and honest interrupted-billing accounting.

### F24 — High: shutdown does not cancel active model requests

**Locations:** `src/runtime/runner.ts:228–230,440,563`, `src/runtime/shutdown.ts:38–74`.

Runner calls omit the available request `AbortSignal`.
Stopping the pool waits for active requests rather than cancelling them.
The shutdown deadline can close the database and release the lock while a provider request still runs.
A late result can then attempt usage or job writes against the closed database.
**Correction:** Propagate a shared shutdown signal through decision calls, retry waits, and HTTP reads. Fence late results before resource closure.
**Regression:** Interrupt a real delayed fake-HTTP request and verify cancellation, resumable jobs, and no post-close writes within the drain budget.

### F25 — High: the storage-budget guard omits most durable files

**Locations:** `src/runtime/runner.ts:719–730,772–781`, `src/application/status.ts:48–73`.

Budget checks count SQLite main-file pages and archive files only.
They omit WAL/SHM, backups, checkpoints, logs, and other data-directory contents.
Periodic backups alone can therefore exceed the configured project budget without triggering the guard.
**Correction:** Account for the complete owned storage tree and reserve space before backup, checkpoint, and archive writes.
**Regression:** Fill excluded categories in a temporary directory and require a visible safe pause before the configured budget is exceeded.

### F26 — Medium: missing-provider startup and doctor use inconsistent town detection

**Locations:** `src/main.ts:74–90,139–154`, `src/application/diagnostics.ts:73–90`.

Startup treats an existing database file as an existing town.
Offline `doctor` creates that file during its SQLite check, even without a saved world.
A later start can therefore migrate and found a town before failing provider validation.
For an actual saved town with invalid provider configuration, `requireProvider()` throws before the dashboard's paused recovery path starts.
**Correction:** Inspect the saved-world record rather than file existence. Probe SQLite in temporary storage and permit inspection-only paused startup.
**Regression:** Verify fresh doctor leaves no authoritative database, invalid-provider first start creates no town, and saved-town startup remains inspectable while paused.

## Verification and handoff defects

### V1 — Medium: the verification command depends on an existing build

**Locations:** `scripts/verify.mjs:4–10`, `tests/integration/resilience.test.ts:44–46,128`.

The verifier runs tests before the build. The process tests execute `dist/main.js`, not the current TypeScript source.
A clean installation has no `dist/main.js`. Both tests therefore wait for a server that cannot start.
An existing installation can test stale compiled runtime code before rebuilding it.

**Reproduction:** A temporary source-only copy produced 86 passes and two 30-second process-test timeouts.
An explicit `npm run build` followed by those tests produced two passes.

**Correction:** Build the process-test artifact before those tests, or launch the current source through a supported test runner.
**Regression:** Run the advertised verification command without pre-existing build output.
**Plan:** T1/T12 require a reproducible offline verification command after clean setup.

### V2 — Medium: generational acceptance bypasses the lifecycle it claims to verify

**Locations:** `tests/integration/drama.test.ts:18–38,79–123`, `tests/unit/clock.test.ts:5–11,30–34`.

The generation tests create pregnancies due the next day and rewrite the child's `bornDay` to adulthood.
The second-generation test also assigns both partners directly and injects another next-day pregnancy.
The calendar tests establish the age predicate, not 6,570 integrated daily transitions.

These tests cover useful birth, employment, and inheritance slices. They do not prove ordinary conception, 280-day gestation, childhood care/education, or adulthood participation together.
The baseline soak does not supply that missing evidence because it does not produce births.

**Correction:** Add a scripted, daily lifecycle run through public actions without birth-date changes or manual partnership assignments.
**Regression:** Verify both gestation and 6,570 childhood transitions, daily needs, education, model eligibility, and succession.
**Plan:** T4/T11 and the calendar acceptance criteria explicitly require causal generations without age shortcuts.

### V3 — Medium: browser assertions do not establish several claimed acceptance results

**Locations:** `tests/e2e/dashboard.spec.ts:10–22,49–61,85–94`.

- The time-progress check accepts an unchanged day with `toBeGreaterThanOrEqual`.
- The causal-chain check skips its substantive assertions when no returned event has an actor.
- The hostile-text check never supplies hostile text. It checks HTML for a React property name and counts script elements.

A stalled runner can pass the progress assertion. An event page without actor links can pass the causal check.
An unsafe `innerHTML` assignment need not leave the string `dangerouslySetInnerHTML` in rendered HTML.

**Correction:** Require strict day progress. Use a known causal fixture. Render an actual hostile payload with a detectable execution side effect.
**Plan:** T10/T12 require live updates, causal navigation, and inert rendering of malicious generated text.

### V4 — Medium: the README quick start omits the required build

**Locations:** `README.md:8–13`, `package.json:11–23`.

The quick start runs installation, configuration, `doctor`, and `start` without building.
Both runtime commands execute files under `dist/`. There is no install script that creates them.
The longer instructions in `docs/OPERATIONS.md:23–30` include the build, but the primary quick start does not.
A fresh temporary directory reproduced `MODULE_NOT_FOUND` for both compiled entry points.

**Correction:** Include `npm run build` before `doctor` and `npm start` in the README.
**Regression:** Follow the quick start in a fresh source copy with no build artifacts.

### V5 — Medium: completion checkmarks exceed the retained acceptance evidence

**Locations:** `PLAN.md` T7/T11/T12 and verification criteria, `docs/COVERAGE.md`, `tests/integration/persistence.test.ts:77–114,125–143`, `src/application/soak.ts:229`.

The coverage checklist marks all systems and durability gates complete. The retained tests do not establish several required acceptance scenarios:

- Forced prerequisite, success, mitigation, closure, capacity, and idempotency cases for every drama family.
- Actor privacy assertions for unrelated balances, hidden crime facts, and private affairs.
- Process termination at each specified archive, backup, migration, collection, and commit boundary.
- Backup restoration into a separate directory with matching state, lineage, provenance, and historical metrics.
- A 500-resident stress run, status/control p95 latency, or a sustained memory-growth series.

The backup test verifies a backup file and checkpoint. It does not restore a town and compare its history.
The process-kill test interrupts at an unspecified moment, not every named crash boundary.
The soak records memory at the end, not periodically.

**Correction:** Separate implemented mechanics from verified acceptance gates in the checklist. Add reproducible evidence before marking the missing gates complete.
This is an evidence gap, not a claim that every untested mechanic fails.

## Dependency advisory

`npm audit` reports [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) through the development-only TypeScript ESLint dependency chain.
The advisory concerns denial of service through glob-pattern amplification.
Seven reported package entries do not represent seven independent vulnerabilities.
This review did not establish an exploitable application runtime path.
Review compatible dependency updates without applying `npm audit fix --force` automatically.

## Review limits

Passing tests and soaks remain useful evidence of baseline stability.
They are not proof that all checked items in `PLAN.md` or `docs/COVERAGE.md` meet their stated acceptance gates.
No live-model smoke, 500-resident performance benchmark, or sustained memory trend measurement ran during this review.

## Next steps

1. Address the high-severity findings before unattended live operation.
2. Add targeted regression tests for each corrected rule or failure boundary.
3. Repair the clean-build gate and lifecycle/browser acceptance gaps.
4. Re-run verification, browser tests, and baseline/drama soaks against the corrected implementation.
5. Update the completion checklist and run report only with evidence from those runs.

Verification commands after corrections:

```bash
npm run verify
PLAYWRIGHT_BROWSERS_PATH=.playwright npm run test:e2e
npm run test:soak -- --days 10000 --provider mock
npm run test:soak -- --days 1000 --provider mock --drama
```

Use explicitly separate temporary data directories for soak and reproduction runs.
