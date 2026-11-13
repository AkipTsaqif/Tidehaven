# Tidehaven implementation re-audit

## Resolution status

All eleven implementation findings (R1–R11) and both acceptance/coverage findings (A1–A2) have been
addressed in the code and covered by regression tests; `docs/RUN-REPORT.md` §0b maps each finding to
its evidence. The default-calendar generation gate exists, and the two counterexample mutations this
audit used (one-day-early birth, education stopped after its first day) now fail it. Where a correction
changes a documented behaviour, `docs/RULES.md` and `docs/COVERAGE.md` were updated in the same change.
Remaining evidence gaps are listed explicitly in `docs/COVERAGE.md`. This section records resolution,
not a re-review.

## Verdict

**The fixes materially improve the implementation, but full acceptance is not yet established.**

This is an independent follow-up to `IMPLEMENTATION_REVIEW.md`.
The resolution statements in that file and `RUN-REPORT.md` are implementer claims, not independent verification.
This report checks the repaired code and the evidence claimed in `COVERAGE.md` against `PLAN.md`.

**Result: 11 remaining implementation findings and two acceptance-evidence findings — six high, seven medium overall.**
Prioritize R1/R5 for authoritative state, R2 for minor ownership, and R9/R10 for participation and spending safety.

## Fresh checks

| Check | Result |
|---|---|
| `npm run verify` | Pass: typechecks, lint, build, 127 tests across 20 files |
| Source-only temporary copy, initially without `dist/`, `npm run verify` | Pass: 127/127. The previous build-order defect is fixed |
| Browser suite against the temporary copy | Pass: 7/7, including strict day progress and an actual hostile-text fixture |
| Fresh 10,000-day baseline soak | Pass: 295.3 seconds, zero hunger, conserved money, 321/321 archives, daily goods reconciliation |
| Baseline memory series | 101 samples, heap 18 → 41 MiB, peak 61 MiB. Final measurement: RSS 179 MiB, heap 15 MiB |
| Fresh 1,000-day drama soak | Pass: 15.1 seconds, zero hunger, 21/21 archives, zero recorded crimes |
| Lifecycle test with an explicit per-day invariant assertion, in a temporary copy | Pass |
| Lifecycle test with conception retries routed through full daily steps, in a temporary copy | Pass |
| Lifecycle test with a deliberately one-day-early birth mutation, in a temporary copy | **Still passes: acceptance oracle gap** |
| Lifecycle test with education stopped after its first day, in a temporary copy | **Still passes: acceptance oracle gap** |

No paid model requests ran. Soaks used separate temporary data directories.
Application source, scenario settings, and the approved plan were not edited.
Build/browser commands generated normal artifacts. Counterexample mutations existed only in a disposable source copy.
The browser harness hardcodes and clears `data/e2e`. One invocation used that disposable fixture path before the isolation setup succeeded.
The subsequent source-only browser run redirected the E2E path into its temporary copy.
No Git metadata exists, so this audit has no Git diff or commit-based change baseline.

## Repair assessment

The build-order and README setup corrections are present.
The browser progress, causal-event, and hostile-text assertions now test real behavior rather than the previous weak proxies.
The new coverage document also distinguishes implemented code from missing acceptance evidence, which is a useful correction.

Several previous defects are corrected in the reviewed paths: full snapshot hashing, goods reconciliation, atomic world/turn commits, and identical-payload save idempotency.
Bounded response reads, ordinary attempt records, SSE replay, and death/release lifecycle handling also show substantive repairs.
The remaining findings below distinguish production defects from test-evidence gaps.
A surviving mutation demonstrates a test gap. It does not mean the unmodified production implementation contains that mutation.

## Confirmed implementation defects

### R1 — High: committed wills disappear from the live runner state

**Locations:** `src/domain/state.ts:638–675`, `src/runtime/runner.ts:393`, `src/domain/society/actions.ts:69–83`.

`adoptState()` replaces the staged authoritative collections after commit but omits `wills`.
A normal `write_will` action reaches SQLite, yet the live state keeps its previous wills map.
Subsequent same-process estate resolution can ignore the committed will. Restart then changes behavior by reloading the missing will.

**Reproduction:** Executed `write_will`, saved the staged day, and called the runner's publication helper in a fresh in-memory town.
The staged and reloaded worlds contained the will. The live adopted world did not, and its hash differed from the committed hash.
**Pi's recommendation:** Publish every authoritative field, including wills. Test clone/adopt completeness and runner save/adopt/reload identity after every newly supported state change.
**Prior findings:** F2/F12/F15/F18 are not fully closed for this path.

### R2 — High: disputed estate awards bypass protected minor trusts

**Locations:** `src/domain/events/justice.ts:105–145`, `src/domain/society/estates.ts:183–240`.

Ordinary settlement routes a minor's inheritance into a protected escrow account.
The dispute resolver instead sends every award directly to the claimant's ordinary resident account.
A disputed will therefore bypasses the adulthood release boundary.

**Reproduction:** Created a will naming a minor while excluding a natural heir, then advanced justice to the dispute deadline.
The estate closed with a direct resident award and zero funds in the minor's protected trust.
**Pi's recommendation:** Use one protected-award resolver for ordinary and disputed settlements. Verify no minor receives spendable estate funds before adulthood.
**Prior finding:** F15 remains partially open.

### R3 — High: sabotage still bypasses crime access restrictions

**Location:** `src/domain/events/crime.ts:478–506`.

The sabotage handler checks only that the target business is open, has stock, and passes a seeded roll.
It does not validate access, employment, location, motive, or opportunity before destroying stock.
The repaired theft/fraud checks therefore do not protect the sabotage route.
**Reproduction:** An adult with no employment at the target bakery successfully destroyed 10 of its 100 grain on seeded day two.
**Pi's recommendation:** Validate concrete access/opportunity before the contest. Require an unrelated remote attempt to reject without stock changes.
**Coverage:** `COVERAGE.md` claims sabotage has role prerequisites, which this handler does not implement.

### R4 — Medium: same-kind disasters can compensate the same unrelated injury

**Location:** `src/domain/events/disasters.ts:224–244`.

Relief matches injuries by disaster kind and date, not the causal disaster ID.
Two storms can therefore pay the same unresolved storm injury from separate relief accounts.
An injury at one location can also consume another location's disaster budget.
**Reproduction:** Two storm relief records and one unresolved injury produced two 60-cent payments to that resident from separate disaster escrows.
**Pi's recommendation:** Preserve the causal disaster on each injury and track its compensation effect exactly once.
**Prior finding:** F19's material repairs are improved, but relief attribution remains incomplete.

### R5 — High: income-tax commands mutate live state instead of the staged boundary

**Location:** `src/runtime/runner.ts:798–803`.

The income-tax branch writes `this.state.policies`, although other authoritative command effects target the staged copy.
The commit saves the old staged tax rate, marks the command applied, and then overwrites the live mutation during adoption.
A failed day also leaves the live tax rate changed without a commit.
**Reproduction:** Applied a queued rate of 1,777 basis points to a staged boundary.
The live policy changed to 1,777, while the staged policy remained 1,200.
**Pi's recommendation:** Apply all policy mutations to the staged target. Assert command effect and disposition together after success, failure, and restart.
**Prior finding:** F22 remains partially open.

### R6 — Medium: backup/checkpoint bookkeeping changes canonical state after commit

**Locations:** `src/runtime/runner.ts:906–946`, `src/domain/hash.ts:343–382`.

Artifact helpers change `lastCheckpointDay` and `lastBackupDay` inside hashed `state.counters` after the world commit.
The live canonical hash then differs from the stored world and metrics hashes until another commit.
Restart loses those unsaved bookkeeping updates and can repeat artifact work.
**Reproduction:** Saved a fresh day and confirmed live/stored hash equality. After its normal day-one backup, equality failed.
The live backup counter was one, but the reloaded counter was absent.
**Pi's recommendation:** Store operational artifact bookkeeping outside authoritative state, or persist it through a consistent versioned boundary.
**Prior finding:** F2's original cash mutation is fixed, but end-to-end committed-hash identity still has a gap.

### R7 — Medium: normal commit growth has no storage reservation

**Locations:** `src/runtime/runner.ts:383,405–411,874–899`.

Whole-tree measurement and artifact reservations improve storage accounting.
However, the runner checks the storage guard after normal resolution, job writes, and the day commit.
Near the configured limit, SQLite/WAL growth can exceed the budget before the pause occurs.
**Pi's recommendation:** Reserve bounded normal-turn growth and recovery headroom before paid collection and database writes.
**Regression:** Begin just below the budget and assert that collection/commit cannot consume reserved recovery space.
**Prior finding:** F25 remains partially open. This is a source-level guard-order defect, not a reproduced disk-full failure.

### R8 — Medium: probe profiles use a different key from runtime capability lookup

**Locations:** `src/model/probe.ts:86–97,139–145`, `src/model/jobs.ts:120–122`, `src/model/capabilities.ts:19–21`.

Probing stores capability under the configured API root. Runtime looks up the full `/chat/completions` endpoint instead.
A successful probe at a normal `/v1` base URL is therefore ignored at startup.
The probe also tries only schema and object modes, never a plain-JSON request without `response_format`.
**Reproduction:** Stored a schema profile at a local `/v1` root. Runtime endpoint lookup returned `null` for the same provider and model.
**Pi's recommendation:** Normalize both paths to one provider-profile key. Exercise schema/object/plain discovery without unauthorized probe requests.
**Prior finding:** F11 remains partially open, although ordinary dispatch audit rows now exist.

### R9 — High: queue saturation silently removes eligible adults' model opportunities

**Locations:** `src/runtime/runner.ts:541–563,585–620`, `src/runtime/pool.ts:54–68`.

Collection submits the entire actor population before awaiting any completion.
The pool rejects submissions beyond its active-plus-queued capacity, and the runner records deterministic fallback instead of feeding remaining jobs incrementally.
At default limits, only 264 requests fit: eight active and 256 queued.
**Reproduction:** Submitted 499 delayed actor tasks through the same pool sequence. Exactly 264 dispatched and 235 rejected as queue-full.
This occurs below the default 500-resident ceiling. The resulting fallbacks can also contaminate provider-health statistics.
**Pi's recommendation:** Use bounded producer/worker feeding so every eligible actor receives an opportunity without exceeding queue capacity.
**Prior finding:** F8's serial behavior is fixed, but population-scale collection remains incomplete.

### R10 — High: cancellation releases potentially billable output allowance

**Locations:** `src/model/jobs.ts:201–225`, `src/model/client.ts:322–340`, `src/runtime/usage.ts:183–219`.

A timeout or cancellation returns an input estimate with zero completion tokens.
Settlement replaces the durable input-plus-output reservation with that smaller figure, although the provider can have generated billable output.
The thrown-error path makes the same reduction despite its comment claiming conservative retention.
**Reproduction:** Reserved 900 tokens, dispatched to a local delayed HTTP provider, then aborted after receipt.
Settlement retained only one estimated input token and no output allowance.
**Pi's recommendation:** Retain conservative reserved usage for uncertain dispatched outcomes. Reconcile downward only with trustworthy usage or evidence of no dispatch.
**Prior findings:** F23 remains partially open. Cancellation signaling itself is improved, but its spending accounting is not conservative.

### R11 — Medium: revision refreshes can overwrite newer views with older responses

**Locations:** `client/src/views/History.tsx:32–46` and equivalent view-fetch effects.

Revision changes now trigger queries, fixing the original missing invalidation.
However, overlapping effects have no cancellation or generation check before updating state.
If an older response arrives last, it replaces the newer revision's page. Search changes have the same race.
**Pi's recommendation:** Cancel superseded queries or ignore responses whose request generation is no longer current.
**Regression:** Delay revision N, complete N+1 first, then release N. Require the UI to retain N+1.
**Prior finding:** F9 remains partially open. This is confirmed source-level race behavior, not a fresh browser reproduction.

## Acceptance and coverage findings

### A1 — Medium: the required default-calendar generation gate is still not covered

**Locations:** `tests/integration/lifecycle.test.ts:27–37,65–75,118–125,149,175–193`, `docs/COVERAGE.md:26,139–141`.

The new lifecycle test uses 80 days to adulthood and six days of pregnancy.
The approved acceptance criterion requires 6,570 daily childhood transitions and 280 days of gestation.
The compressed test also changes adulthood to age two and the elder boundary to age ten, not merely simulation duration.
A compressed-calendar scenario is a useful fast integration test, but it is not that acceptance gate.

During conception retries, the test increments `state.day` and invokes only `householdPhase()`.
The economy, health, education, obligations, invariants, and persistence do not run during those elapsed days.
The daily helper also ignores `runDay()`'s invariant report, and adulthood participation checks a labor-capacity function rather than actual work or runner eligibility.

**Observed counterexamples:**

- Permitting delivery one day early in a temporary copy still passes this test. Its assertion explicitly permits `dueDay - 1`.
- Stopping education after its first increment still passes. The test stores the previous education value but discards it, then requires only a positive final value.

These weaknesses leave the previous V2 finding partially open.
`RUN-REPORT.md:113–115` also incorrectly states that neither generation test rewrites birth dates or assigns partners.
`drama.test.ts:35,96,108–110` still does both. Those fast slice tests are legitimate, but they are not lifecycle acceptance evidence.
The production calendar is not shown to be wrong. The missing item is the promised integrated acceptance evidence.

**Pi's recommendation:** Keep the compressed test. Add a default-calendar lifecycle run with exact birth timing, daily invariants, care/education checks, and real adult participation.
Route every elapsed day through the daily pipeline and verify persistence/restart during the lifecycle.

### A2 — Medium: several regression-test names claim behavior their assertions do not exercise

**Locations:** `tests/integration/rules-regressions.test.ts:136–157,318–329,331–369,429–464`, `docs/COVERAGE.md:28–35`.

Examples in the retained regression suite:

- The authorized-theft test claims to open a case but accepts `cases.size >= 0`, which cannot fail.
- The departure test claims to end employment and release assets, but its fixture contains neither employment nor resident-owned assets.
- The single-release test claims restart coverage but only invokes justice repeatedly on the same in-memory state.
- The disaster test claims closure and refund but stops after observing a partial repair. It never reaches closure or asserts a refund.

These tests cover useful pieces. Their names and the coverage table overstate the additional behaviors they prove.
This does not establish that those production behaviors fail.

**Pi's recommendation:** Add the missing fixtures and postconditions, or narrow each evidence claim to the behavior actually asserted.
Verify that a deliberately broken closure, refund, or lifecycle operation causes its advertised regression test to fail.

## Acceptance work already disclosed as incomplete

`COVERAGE.md` correctly lists the following evidence as missing:

- A 500-resident stress run.
- Status/control p95 latency under load.
- Complete forced-outcome prerequisite/success/mitigation/closure matrices for every drama family.
- A soak that produces births and generations.

The full default-calendar lifecycle must also remain unverified rather than being substituted by the compressed scenario.
Paid live-model smoke is optional and authorization-dependent. Its absence alone does not fail offline acceptance.
Archive, backup, and migration crash-boundary rehearsals also remain distinct from the four collection/commit boundaries currently exercised.

## Prior-finding disposition summary

| Previous area | Follow-up assessment |
|---|---|
| F1/F3/F4 | Previously missing snapshot fields, daily goods reconciliation, and prorated production are repaired |
| F2/F12 | Original repository mutation and unstaged resolution are repaired, but publication/bookkeeping gaps remain: R1/R5/R6 |
| F5/F14–F19 | Theft/fraud, kinship, ordinary trusts, lifecycle, release, dispatch, and repairs improved. Residual paths: R1–R4 |
| F6/F7/F10 | Streaming response bounds, message bounding, and retained SSE replay are present. Token counts remain estimates, not provider-token guarantees |
| F8/F9/F11 | Original serialization/refresh/audit gaps improved. Residual paths: R8/R9/R11 |
| F20/F21 | Atomic world/turn transition and identical-payload retry protections pass the retained checks |
| F22/F23/F25 | Command staging, durable reservations, and whole-tree measurement improved, but remain partial: R5/R7/R10 |
| F24/F26 | Cancellation propagation and saved-world/doctor startup repairs are present. Uncertain-usage accounting is separately covered by R10 |
| V1/V3/V4 | Clean verification, strict browser assertions, and README build instructions corrected |
| V2/V5 | Full lifecycle evidence and some coverage claims remain partial: A1/A2 and the disclosed missing gates |

This table is a scoped follow-up assessment, not a guarantee that unexamined paths contain no defects.

## Verification commands

After corrections, use fresh temporary data directories for reproductions and soaks:

```bash
npm run verify
PLAYWRIGHT_BROWSERS_PATH=.playwright npm run test:e2e
npm run test:soak -- --days 10000 --provider mock
npm run test:soak -- --days 1000 --provider mock --drama
```

Run the browser command only against disposable data. Its current launcher deletes the hardcoded E2E directory before startup.
