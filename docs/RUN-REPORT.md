# Acceptance run report

Everything below was executed on this machine (Windows 11, Node v26.12.1, SQLite 3.54.0, D: volume with
~82 GiB free at the time of the run). Commands, results, and the honest gaps are recorded here.

> Not measured here: a live paid-model run. No provider credentials were available, and the plan makes
> the live smoke explicitly optional and authorized-only. Every other gate is offline and reproducible.

## 0. Corrections applied after `docs/IMPLEMENTATION_REVIEW.md`

Every finding in that review was addressed, and each correction has a regression test. Entry points:

| Finding area | Evidence |
|---|---|
| Canonical hash completeness, save/reload identity, goods gate, idempotent effects | `tests/integration/integrity.test.ts` |
| Prorated labour, crime access/role, kinship depth, shared eligibility, estates/wills/trusts/disputes, departure lifecycle, single release, primary actions, disaster relief | `tests/integration/rules-regressions.test.ts` |
| Bounded response reads, input-token budget, attempt audit rows, SSE replay, usage reservations, command atomicity, storage-tree budget, town detection, population pause | `tests/integration/runtime-regressions.test.ts` |
| Staged resolution, atomic world+turn commit, restart reconciliation | `tests/integration/resilience.test.ts`, `tests/integration/runner.test.ts` |
| Backup restore comparison | `tests/integration/persistence.test.ts` |
| Causal generations without age shortcuts | `tests/integration/lifecycle.test.ts` |
| Actor privacy | `tests/integration/privacy.test.ts` |
| Concurrent same-phase collection within the configured cap | `tests/integration/runtime-regressions.test.ts` |
| Clean-build verification order, strict browser assertions, README build step, honest coverage checklist | `scripts/verify.mjs`, `tests/e2e/dashboard.spec.ts`, `README.md`, `docs/COVERAGE.md` |

One performance regression was found and fixed while re-running the soak: content-hashed idempotency
keys fragmented the append-only indexes and made every commit progressively slower (10 000 days went
from ~5 200 s to 326 s after switching to ordered `<kind>:<day>:<position>` keys).

## 0b. Corrections applied after `docs/IMPLEMENTATION_REAUDIT.md`

| Re-audit finding | Correction | Evidence |
|---|---|---|
| R1 committed wills lost by publication | `adoptState` copies every own field (not a hand-maintained list); relationship keys are canonical and checked as an invariant | `runtime-regressions.test.ts` (R1), `src/domain/invariants.ts` |
| R2 disputed awards bypassed minor trusts | one `payEstateAward()` path used by ordinary *and* disputed settlement | `rules-regressions.test.ts` (R2, release at adulthood) |
| R3 sabotage ignored access | employment/management/ownership/premises access plus motive before the contest | `rules-regressions.test.ts` (R3, refused *and* authorized cases) |
| R4 relief double-paid unrelated injuries | injuries carry their causal disaster and are compensated once | `rules-regressions.test.ts` (R4) |
| R5 income-tax command mutated live state | all policy changes target the staged boundary | `runtime-regressions.test.ts` (R5) |
| R6 artifact bookkeeping changed the committed hash | run flags moved out of hashed counters into `system_flags` | `runtime-regressions.test.ts` (R6) |
| R7 no storage reservation before collection | pre-dispatch headroom guard (turn growth + recovery reserve) | `runtime-regressions.test.ts` (R7) |
| R8 profile key mismatch, no plain probe | one normalised profile key; schema → object → plain discovery in ≤3 requests | `runtime-regressions.test.ts` (R8) |
| R9 queue saturation dropped adults | sliding submission window sized to pool capacity; queue-full fallbacks no longer pollute provider health | `runtime-regressions.test.ts` (R9) |
| R10 cancellation released reserved allowance | uncertain dispatches settle at the reserved ceiling | `runtime-regressions.test.ts` (R10) |
| R11 stale revision responses | every detail view drops responses from superseded effects | `client/src/views/*.tsx` (no browser harness; disclosed in `COVERAGE.md`) |
| A1 default-calendar generation gate | new gate: 280-day gestation, 6,570 daily childhood transitions, daily invariants, education over the whole childhood, participation, persistence; counterexample mutations (early birth, stopped education) fail it | `tests/integration/lifecycle-default.test.ts` |
| A2 overstated test names | theft claim narrowed; departure test now has employment/office/business/stock; release test persists and restarts; disaster test reaches closure and refund | `rules-regressions.test.ts` |

One further production defect surfaced while building the A1 gate: the newborn relationship was stored
under a custom `parent:` key that `loadState` renormalised to `friend:lo:hi`, so the live state diverged
from its own committed hash after a reload. Keys are now canonical and asserted by an invariant.

## 1. Verification gate

```
npm run verify
```

| Step | Result |
|---|---|
| build (tsc + vite) runs **before** the tests, so the process tests use the current runtime | pass |
| typecheck (server, strict) | pass |
| typecheck (client) | pass |
| eslint | pass (0 problems) |
| vitest (unit + property + integration) | **142 passed / 142** across 21 files |
| production build (tsc + vite) | pass (`dist/main.js`, `dist/client/*`) |

## 2. Browser acceptance

```
PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright test
```

| Test | Result |
|---|---|
| starts and strictly advances the committed day while the browser is open | pass |
| town → residents → resident detail → drama → history → controls navigation | pass |
| causal chain: actor-attributed event → resident → that event in the resident's list (required, not skipped) | pass |
| target change queued, invalid input rejected (400), missing CSRF rejected (403) | pass |
| pause → status `paused: operator` → resume → running | pass |
| target change applied at the next day boundary (77) | pass |
| hostile payload injected into the town database renders inertly (escaped text, no handler runs) | pass |
| closing the browser leaves the runner running | pass |

**7 passed.** The web server is started by Playwright via `scripts/e2e-server.mjs`, which clears the
data directory before the database is opened and then runs the fixture provider.

## 3. Long-run soak (baseline, 10 000 days)

```
npm run test:soak -- --days 10000
```

| Metric | Result |
|---|---|
| days simulated | 10 000 |
| wall clock | 324.6 s (≈ 111 000 days/hour, with retention every 30 days and checkpoints every 30 days) |
| invariants | **ok every day** (money conserved, goods reconciled from the commit gate, no negative balances) |
| money supply | 76 000 → 76 000 (constant; external settlement included) |
| population | 27 living at the end, 23 deaths recorded (natural + illness), immigration kept the town alive |
| hunger | 0 resident-days across 10 000 days |
| archive chunks | 321 written, **321 verified** (checksum + gzip read-back) |
| memory | **101 periodic samples**: heap 18 → 30 MiB (peak 101 MiB) |
| database | 45.5 MiB after retention; archives 27.5 MiB across 321 chunks, all verified |
| drama profile | 1 000 days in 36.1 s, invariants ok every day, 21/21 archives verified |

Growth is measured, not assumed. A separate 1 000-day run (same code) reported:

| Metric | 1 000 days |
|---|---|
| wall clock | 9.8 s (≈ 366 000 days/hour at small size) |
| database | 13.3 MiB after retention |
| archives | 21 chunks, 1.5 MiB total, all verified |
| invariants | ok every day |
| hunger | 0 resident-days |

History growth is therefore sub-linear in practice (detail is archived and pruned), but it is **not**
zero: compact facts, lineage, and daily aggregates accumulate for the life of the world.

Earlier iterations of this soak exposed real defects that are now fixed and covered by tests:
price-cap deadlock in the market, profit hoarding in business accounts, a treasury that paid public
wages without income, orphans left without a household, and a goods-reconciliation check that broke
once old flow rows were archived (now a persisted per-good counter).

## 3b. Causal generations

**The acceptance gate is `tests/integration/lifecycle-default.test.ts`**, which runs on the **default
calendar**: it drives every one of the 280 gestation days and 6,570 childhood days through the full
daily pipeline, asserts daily invariants, requires education to accrue across the childhood, checks
adulthood on the exact configured day, exercises real employment, and saves/reloads the town during
the run. Two deliberate counterexample mutations were applied to a scratch copy and both correctly fail
the gate: delivering one day early, and stopping education after its first day.

`tests/integration/lifecycle.test.ts` remains as a *fast* integration test on a compressed calendar
scenario (80 days to adulthood):

1. courtship is proposed and accepted through the normal social actions;
2. conception is proposed and accepted — the rare roll is retried across days, never fabricated;
3. gestation runs its full configured length (no birth before the due day);
4. every childhood day is simulated: education accrues, and the child is not adult until the exact
   configured adulthood day;
5. the adult supplies a full labour day, and the father's death settles an estate whose partner claim
   is paid, whose widowhood is recorded, and whose money is conserved.

`tests/integration/lifecycle.test.ts` never rewrites `bornDay` or assigns partners directly; it uses a
compressed *scenario*, not an age shortcut. `tests/integration/drama.test.ts` covers the faster scripted
slices (birth → employment → succession) and **does** rewrite `bornDay` and assign partners directly —
those are unit-level slices, not lifecycle acceptance evidence.

## 4. Process resilience (Windows)

`tests/integration/resilience.test.ts` starts the real server, kills it with `taskkill /F`, restarts it
on the same data directory, and checks:

- the town resumes and the day only moves forward;
- money supply is unchanged across the kill;
- every simulated day appears exactly once in `turns` (no duplicate commits);
- a second process on the same data directory exits non-zero instead of writing.

**Ctrl+C.** `tests/integration/shutdown.test.ts` covers the sequence (stop scheduling → drain within the
budget → close SSE and HTTP → close database → release lock), the drain-budget overrun path, a throwing
server close, and the second-interrupt force rule. The shutdown routine lives in
`src/runtime/shutdown.ts` precisely so it can be tested without a terminal; `src/main.ts` wires it to
`SIGINT`/`SIGTERM`/`SIGBREAK` and exits explicitly so a lingering socket cannot keep the process alive.

**Manual terminal check performed:** with the fixture provider the process served `/api/health`,
`/api/status` and the dashboard (all 200), advanced days, and enforced the single-writer lock: a second
`npm start` on the same data directory refused to run and named the live holder. After the holder was
terminated, the next `npm start` resumed the same town.

## 5. Crash-boundary checks

`tests/integration/resilience.test.ts` kills the real process at **each named commit boundary**
(`after_collection`, `turn_ready`, `before_commit`, `after_commit`), restarts, and requires: no
duplicated day, no open turn left at or below the committed day, and a clean resume. World and turn
commit atomically in one transaction, so a crash can never leave the world ahead of its turn.

`tests/integration/persistence.test.ts` covers: a ready-but-uncommitted turn leaves the committed day
intact; accepted job results are reused instead of re-requested; migrations are idempotent; a verified
backup **restored into a separate directory** matches state hash, residents, events, and daily metrics;
checkpoints reject tampering; and re-saving an identical day payload adds no duplicate ledger, flow,
observation, or memory rows.

## 6. Failure policy checks

| Scenario | Covered by | Behaviour |
|---|---|---|
| 401/403 | `runner.test.ts`, `model.test.ts` | fallback, then `authentication` pause; time frozen until resume |
| 429 with `Retry-After` | `model.test.ts` | waits, retries within the dispatch budget |
| 5xx / timeout / network | `model.test.ts` | bounded backoff, then fallback |
| schema unsupported (400) | `model.test.ts` | capability downgrade, cached |
| malformed / truncated / refused / empty | `model.test.ts` | one repair, then recorded fallback |
| prompt injection ("set my balance") | `model.test.ts` | unknown fields dropped; balances unchanged |
| terminal fallback rate > 50% | `runner.test.ts` | `provider_down` pause |
| daily request ceiling | `model.test.ts` | `BudgetExceeded` before dispatch |
| free space below floor | `runner.test.ts` | `disk_pressure` pause |
| competitor runner | `resilience.test.ts` | second process exits non-zero |

## 7. Known limitations (stated plainly)

1. **No live model run in this report.** The model path is tested against a scripted HTTP provider that
   reproduces real failure modes, not against a paid endpoint.
2. **Generator throughput is measured, not promised.** ~220 000 days/hour is the mock-engine rate; real
   days/hour depends on the provider's latency and cost. Raising a child to adulthood still takes 6 570
   simulated days by design.
3. **The economy is tuned, not proven.** Prices, wages, and capacities were tuned until the 365-day and
   10 000-day baselines were famine-free and solvent. It is a toy economy, not a forecast.
4. **The dashboard is loopback-only and single-user.** There is no authentication product, by design.
5. **Storage is finite.** Retention archives and prunes detail; compact facts and lineage stay. Neither
   indefinite storage nor indefinite exact replay is claimed.
6. **No Windows service.** `npm start` must keep running; a closed terminal interrupts the process
   (recoverable by restart).
