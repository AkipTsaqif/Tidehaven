# Resource-funded town growth — design checkpoint

**type:** feature
**context:** domain
**status:** approved by user (“go ahead”); implementation in progress

## Purpose and contracts

The growth rules turn resident intentions into capacity the rest of the economy can actually use.
The daily engine calls construction and household resolution; hiring and production consume completed
building capacity; market/provisioning consume household membership. Resource accounting, current
consent, actor eligibility, deterministic order and bounded work remain engine-owned.

## Requirement changes

### MODIFIED: physical growth

**Before:** farms/workplaces can only occupy preseeded premises; no expansion action exists.
**After:** residents may propose a new templated workplace or an extension. Completion requires real
labour, materials and capital. It adds premises and business capacity to the existing production
pipeline, not a direct grant of output. Empty workplaces produce nothing.

### MODIFIED: housing use

**Before:** every newcomer in Eden starts their own household/camp even if occupied homes have beds.
**After:** a newcomer may request to join a home. Every current adult host must agree; the resolver
rechecks life status, host roster, request expiry, household membership and space before moving them.
Silence/refusal is not consent. A shared address does not create a romantic partnership. Without an
agreement, camping and funded construction remain available.

### MODIFIED: population policy

**Before:** 120 is the default social target; it blocks arrivals and conception when reached.
**After:** Eden can explicitly disable that policy, independently of the finite host population
ceiling. Numeric target behavior (including zero) remains available; never use a huge-number sentinel.

### ADDED: bounded elastic development

Completed buildings can be extended or supplemented; no fixed starting-map housing/production ceiling.
Finite active projects, outstanding consents, total entities, jobs, storage, money and goods remain
bounded. Reaching a technical guardrail rejects or pauses visibly, never silently deletes people.

## Steps

1. Optional population policy through config, durable world state, domain checks and controls, while
   retaining host-ceiling pauses → verify: `npm test -- tests/integration/growth-policy.test.ts`.
2. Consent-based household sharing, usable private proposal observations and correct household asset
   handling → verify: `npm test -- tests/integration/housing-sharing.test.ts`.
3. Funded new workplace/extension construction, ownership checks, capital and finite entity guardrails;
   completed capacity feeds hiring and production → verify: `npm test -- tests/integration/workplace-growth.test.ts`.
4. Eden scenario/prompt/dashboard updates and scripted integrated acceptance demonstrating shared
   housing and increased real food output → verify: `npm test -- tests/integration/town-growth.test.ts`.
5. Independent correctness/security/replay review, complete regression gates and measured results →
   verify: `npm run verify` and `npm run test:e2e`.

## Deep modules

- Generalized development projects hide resource acquisition, permission checks, labour progress and
  completion behind a small daily resolver; this avoids separate, divergent accounting rules for
  homes, farm extensions and new workplaces.
- Housing agreements hide unanimous adult consent, roster/capacity revalidation and movement behind
  explicit request/reply resolution; this prevents romance code from accidentally defining residency.
- Population policy helper separates social preference from host resource protection across arrivals,
  conception, zero-population recovery, controls and status; no caller should invent its own sentinel.

## Concrete interfaces from design review

- Persist an explicit `populationPolicyEnabled` flag alongside the numeric target. Existing towns
  default to enabled; newly founded growth-enabled Eden can default to disabled. Disabling policy is
  not changing target zero to mean unlimited. Add a boundary-applied policy command and expose both
  policy mode and finite host ceiling in status/controls.
- Add `request_housing` as a non-romantic social action. Reuse durable `settle` proposals and explicit
  accept/refuse replies, grouped by request and host household. Require the exact current adult host
  roster and explicit requester intent, with finite pending-request count and expiry. Keep the camp
  fallback building-only; no scripted consent or implicit guest admission.
- Add structured `build_workplace` and `expand_building` primary proposals. Scenario-owned templates
  determine recipe kind, capacity increment, labour, materials, construction costs and startup capital.
  The model cannot invent prices, recipes, resources or output quantities.
- Use typed durable projects for new workplace/extension work, with explicit sponsor/permissions,
  escrowed startup capital and materials, required/applied labour, target, status and lifecycle dates.
  New entity/project limits are technical safeguards, not a fixed starting map. Completion activates
  premises/capacity and transfers funded startup capital into the new business account.
- Harden `hireWorker()` before sharing it with new growth paths: current premises, physical capacity,
  eligible resident and safe payroll reserve must be revalidated. `autoHire()` must not gain an
  untested weaker or stronger rule when reusing that resolver; retain legacy demand behavior.
- Resume with the stored scenario snapshot rather than silently applying an edited scenario file.
  Choose the narrowest gameplay-version compatibility mechanism demonstrated by replay tests; do not
  assume a family-string bump alone protects old outcomes.

## Persistence and compatibility

Use numbered migrations if new durable fields/tables are needed; existing migrations are immutable.
Pending projects and agreements must reload and reproduce canonical outcomes. Preserve original
scenario behavior when new growth rules are absent. Version new Eden gameplay explicitly; refuse
silent reinterpretation of saved worlds. Never reset or change user data, .env, or provider settings.

## Safety and permissions

No person builds on another owner's behalf or spends another household/treasury account without an
explicit rule/authorization. Work consumes finite eligible adult labour. Finished extensions update
both building and household capacity where applicable. Non-habitable sites cannot host residents or
businesses. Requested recipe/kind/capacity is validated against versioned templates and safe integers.
Current permissions and resources are rechecked each turn, not only when a project was proposed.

## Acceptance

The detailed scenarios are in `specs/tech-architecture/TOWN_GROWTH_TEST_PLAN.md`. Critical proof:
original farm full → funded development completes → additional workers hired → actual food output
increases; spare beds used only after all adult hosts agree; refusal/expiry/competition never forces a
move; pending progress survives persistence/replay; no soft target still honors host ceilings.

## Out of scope

Unlimited resources or API work, finite-capacity removal without building, forced cohabitation,
kinship changes, unrelated drama/economic rewrites, provider calls and paid live-model tests.

## Review notes

Independent design review confirmed the fixed premises bottleneck and found `hireWorker()` does not
currently enforce the capacity/funding checks claimed by its comment. The change must close that
validation gap rather than call it as-is. The existing romantic `accept` path rejects `settle`, so
residential proposal dispatch must be explicit and tested, not only added to an enum.

Project has no Git repository or bigpowers lifecycle scripts. Use source-only baseline snapshots,
observable failing-then-passing tests and documented command evidence instead of inventing branch or
commit evidence. No new dependency is planned. Baseline verify (158 tests) and seven e2e tests pass.
