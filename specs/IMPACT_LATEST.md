# Impact: resource-funded town growth

**type:** feature
**context:** domain

## Target

Model action contracts, construction, immigration, household membership, and the optional population
policy. Existing modules decide production from finite building staff capacity and use household IDs
for provisioning, kinship/care, injuries, and inheritance. Expanding these mechanics must not bypass
those contracts.

## Dependents

- `src/contracts/actions.ts`: model JSON schema and local action validation; all daily decisions.
- `src/contracts/scenario.ts`: scenario parsing and version hashes; bootstrap, runtime and soak.
- `src/domain/society/construction.ts`: home sites, resource consumption and completion; daily engine.
- `src/domain/society/population.ts`: arrival cadence and funding; demography and migration actions.
- `src/domain/society/households.ts`, `relationships.ts`: household occupancy, proposals and consent;
  care, births, relocation, actor prompts and provisioning.
- `src/domain/economy/{businesses,employment,production,market,trade}.ts`: finite premises, hiring,
  resource stocks, capital and wages; new workplaces must actually produce through these modules.
- `src/domain/{state,hash,turn-engine,invariants}.ts`: authoritative persisted state, phase order,
  deterministic replay, resource and consent validation.
- `src/storage/{repositories,migrations}/*`: save/load of new durable state. Numbered migrations only.
- `src/config.ts`, `src/main.ts`, `src/runtime/runner.ts`: founding configuration, resume and safe caps.
- `src/contracts/api.ts`, HTTP controls, application query/status projections and client views:
  distinguish an absent soft policy from finite host limits, display capacity and projects clearly.
- `src/model/{prompts,fallback,mock}.ts`: private/public observations and valid bounded proposals.
- `scenarios/eden.json`, `.env.example`, `docs/{RULES,OPERATIONS,ARCHITECTURE}.md`: explicit opt-in rules
  and operating instructions. Do not alter saved towns or credentials.

## Affected requirements

No existing release index or epic capsules were present. Approved PLAN.md requirements affected:
T3 economy/business founding, T4 household/population, T8 trusted resolver boundary, T9 bounded
runtime, T10 visible controls, T11 persistence/retention. Current user request supersedes the old
fixed Eden housing map and default-120 policy for the new growing scenario, not finite host resources.

## Test coverage

Existing baseline verified with `npm run verify` (temp on D:): all gates pass.
- `tests/integration/construction.test.ts`: home labour, timber, camps, persistence and prompts.
- `tests/integration/eden.test.ts`: founders, arrivals, cadence, scenario selection.
- `tests/integration/economy.test.ts`, `rules-regressions.test.ts`: accounting and domain outcomes.
- `tests/integration/{determinism,persistence,lifecycle-default,privacy}.test.ts`: shared invariants.
- `tests/integration/{runner,runtime-regressions,resilience}.test.ts`: publication and safe pauses.
- `tests/e2e/dashboard.spec.ts`: dashboard and controls.

Gaps to close: funded expansion actually increases production; new workplaces need no preseeded
premises; new/shared homes avoid one-immigrant-one-house policy; all required adult consents and
current capacity rechecked at settlement; non-romantic membership never implies partnership; no
soft target without disabling host limits; incomplete projects/consents survive save/reload; resource
and entity limits reject safely.

## Risk: High

Shared model, domain, storage and API contracts; changing capacity or membership can silently affect
money, goods, privacy, care and deterministic replay.

## Recommended action

Proceed in tested vertical slices after a concrete design; keep legacy behavior opt-in compatible,
use resource-funded construction, explicit consent, no sentinel huge population, bounded pending
projects/offers and entity counts. Independent code review and acceptance tests are required before
claiming done. This workspace is not a Git repository; no branch/commit/worktree ceremony can run.
A source-only baseline snapshot is kept outside the workspace; no saved town was copied or edited.
