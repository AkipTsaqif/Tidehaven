# Tidehaven — Autonomous Society Simulation Plan

> Status: approved by the user in chat ("all good"). No application code has been created. Plannotator review UI was unavailable; the user chose direct Markdown review.
>
> **Approved destination requested by user:** `D:/Projects/Tidehaven`. **Relocated:** this file is now the canonical copy at the approved destination (verified after copy; the workspace copy was moved, not duplicated). Simulation data is never installed or stored in the parent Random workspace.

## Context

Build a persistent island-town society/economy simulator that the user can start with one command and leave running until stopped. Cheap language models play residents and institutions; deterministic application code owns facts, resources, transactions, time, and action validation. The goal is an entertaining evolving society, not a scientifically validated economic forecast.

The initial workspace (`C:/Users/A Keep/Documents/Random`) contains unrelated loose documents, data, and scripts. Initial inspection found no existing simulation application to extend. Leave those files untouched. The user requested relocation to `D:/Projects` after a disk-space failure on C:. Subsequent read-only checks found approximately 91 GB available on D: and no existing `D:/Projects/Tidehaven`. All paths below are relative to that final project root unless explicitly stated.

## Intended experience

- Start or resume a named town with one command after initial setup.
- Residents make bounded decisions automatically, with no human approval on each turn.
- Inspect the economy, residents, conversations, and newspaper.
- Stop safely and resume without losing committed simulation state.
- Configure model provider, throughput, and allowance guardrails.

## Approach

- A deterministic engine resolves structured model intentions; models cannot edit authoritative state.
- A bounded asynchronous scheduler drives simulation days and model requests.
- Durable local storage records facts, decisions, events, and checkpoints.
- Separate model-generated presentation from authoritative economic records.
- Deliver the requested breadth through bounded economic and social rule systems, not an unconstrained language-model game master.
- Use one local TypeScript application: Node.js 26, built-in SQLite, Fastify API/static server, React/Vite dashboard, Zod contracts, Vitest/fast-check tests, and Playwright browser checks. Pin compatible package versions and commit a lockfile during implementation.
- Use native `fetch` for a narrow non-streaming OpenAI-compatible Chat Completions adapter. Do not require the OpenAI SDK, a paid orchestration platform, embeddings, Docker, Redis, or an external database.
- Maximum throughput means concurrent requests within the current daily phase, with no artificial delay between days. Days remain sequential so future decisions cannot observe nonexistent outcomes.

## Confirmed requirements

1. OpenAI-compatible API, configured with base URL, API key, and model name.
2. Local browser dashboard with live inspection.
3. Generational society: births, families, inheritance, and deaths, as well as immigration, departures, and new businesses. These are required delivery scope, not optional future features.
4. Maximum-throughput unattended operation until stopped or a provider/resource boundary requires a safe pause. Bound concurrency, retries, populations, and storage without imposing an arbitrary total simulation duration.

## Further confirmed requirements

- Use daily turns, even though generations require thousands of turns. Do not substitute monthly or quarterly turns.
- Start with exactly 25 residents. Population maximum is configurable, including changes below the current population. Reductions must occur through recorded in-world events such as emigration or plausible illness/death, not unexplained deletion.
- Dramatic social dynamics are in scope, beyond a purely economic or peaceful civic simulation. All four requested drama categories below are required.
- Models act inside the simulated world. They do not receive arbitrary host shell, filesystem, or self-modification access.

## Final scope decisions

- Population maximum is a **soft target**: lowering it creates gradual, story-driven reductions. Temporary overshoot is permitted. Never silently delete residents or fabricate mandatory deaths to hit a number.
- Include all requested drama categories in the completed foundation: crime and power struggles; disasters and public health; personal and household conflict; collective unrest and violence.
- Concrete categories include theft, fraud, corruption, investigations, trials, imprisonment, factions, scandals, storms, fires, shortages, outbreaks, treatment, injuries, deaths, adult affairs, divorce, inheritance disputes, feuds, strikes, protests, riots, assault, murder, and rebellion. Resolve these as abstract game mechanics with non-graphic narration, not real-world operational instructions.
- Node.js v26.12.1, npm 11.20.0, Python 3.12.2, and Git 2.43.0.windows.1 are available locally (read-only version checks). No packages installed during planning.
- Provider details remain setup configuration, not an unresolved architectural decision. Do not request or store credentials in the plan.

## Prior Art

| Candidate | Source | Decision |
|---|---|---|
| Generative Agents / Smallville | https://github.com/joonspk-research/generative_agents ; https://arxiv.org/abs/2304.03442 | Reuse the observation → bounded memory → planning → reflection concept, not its application code. Its interactive research setting is not a complete durable generational economy. |
| Google DeepMind Concordia | https://github.com/google-deepmind/concordia | Considered as a social-agent framework; do not adopt as the authoritative engine. Its natural-language game-master pattern does not replace the required explicit accounting and rule-based resolution. |
| Node SQLite | https://github.com/nodejs/node/blob/v26.0.0/doc/api/sqlite.md | Adopt `DatabaseSync` behind repositories: documented APIs are synchronous; foreign keys, busy timeout, and defensive mode are available. Keep transactions short, with no network awaits inside them; yield between chunks of engine work. |
| Zod | https://github.com/colinhacks/zod/blob/v4.6.7/packages/docs/content/json-schema.mdx | Adopt a single action-schema source of truth. `z.toJSONSchema()` exports JSON Schema; validate every returned response locally regardless of provider claims. |
| OpenAI-compatible structured output | https://platform.openai.com/docs/guides/structured-outputs ; https://docs.litellm.ai/docs/completion/json_mode | Compose a small HTTP adapter. JSON Schema and JSON-object support vary across gateways; capability probing and plain-JSON fallback are required. |
| React, Vite, Fastify, Vitest, fast-check, Playwright | Official package registries/documentation; verify exact releases at implementation setup | Adopt instead of inventing UI, HTTP, or testing frameworks. Metadata lookup encountered `ENOSPC`; do not treat dependency compatibility as already tested. |

No existing shared application or dependents are being changed; an existing-code blast-radius analysis is not applicable. Initial workspace listing contains no reusable simulation app or project manifests. Recheck before implementation rather than modify unrelated parent files.

## Known trade-off

Use an explicit toy calendar of 365 days/year, so birth to adulthood takes **6,570 daily turns**. Generations remain real and causal rather than accelerated independently of economic time. Seed mixed ages so the initial population already contains children, adults, and elders. Show observed days/hour and estimated wall-clock time to milestones; never promise unmeasured generation throughput. At 20 adult decision requests/day, 18 years already requires about 131,400 requests, before dialogue, reflection, or population growth. More residents increase cost and may reduce days/hour.

## Operating experience and commands

These are **planned commands**, not implemented commands.

One-time setup after approval:

1. Create `D:/Projects/Tidehaven` without overwriting an existing project; copy the reviewed plan there, verify it, and mark the original draft as relocated. Do not delete unrelated files or remove the only plan copy.
2. Install the pinned dependencies, create `.env` from `.env.example`, and build. Keep runtime data on D:. If C: is still constrained, explicitly choose an npm cache/temp directory on D: for setup rather than clearing caches automatically.
3. Configure `TIDEHAVEN_API_BASE_URL` (API root, usually ending in `/v1`), `TIDEHAVEN_API_KEY`, and `TIDEHAVEN_MODEL`. A local API may explicitly use no authentication. Do not hard-code a model or silently switch providers.
4. Run `npm run doctor -- --probe` to check configuration, SQLite, available storage, and an explicitly authorized small paid request. Local `doctor` without `--probe` makes no provider call.

Normal operation from the final project directory:

```bash
npm start                         # create default town once, otherwise resume it
npm run status                    # offline-safe status of the saved town
npm run backup                    # consistent backup while paused/stopped
npm run verify                    # offline typecheck, tests, production build
```

`npm start` launches the runner and serves the built dashboard at `http://127.0.0.1:4317`. Missing build/config produces a clear setup error, not a hidden package install. A new town requires usable provider configuration before simulated time advances. It resumes the same town after shutdown; it never implicitly creates another town or erases saved state. A different explicit data directory selects a different town. New-town reset/reseed is deliberately excluded from the normal start path.

- **Ctrl+C:** stop scheduling immediately, abort/drain requests with a finite deadline, save accepted decisions, finish any already-running synchronous commit, close the server/database, and release the singleton lock. Restart resumes the unfinished day, or the next day if committed. A second interrupt may force exit; crash recovery must still work. Support Windows terminal behavior, not only Unix signals.
- Dashboard controls: pause at a safe boundary, resume, update permitted runtime settings, and enqueue validated operator interventions. Closing the browser does not stop the process. Closing the terminal or powering off may interrupt it; no Windows service is required initially.
- Paused/error states remain visible with their reason, last committed day, unfinished jobs, and recovery instructions. No human input is needed for ordinary days.

## Architecture and authoritative contracts

### Process and module boundaries

One Node process runs an asynchronous model-request pool, deterministic domain engine, short SQLite transactions, and local HTTP/SSE server. No distributed task queue. Domain code imports neither HTTP/UI nor database/provider implementations. Model output is untrusted data. SQL is parameterized; generated text is escaped rather than executed or rendered as raw HTML.

Keep the initial single-process design measurable. If engine/database work blocks status or shutdown beyond the verification budget, chunk/yield work first; moving the engine to a worker is an evidence-driven follow-up, not assumed infrastructure.

### Daily pipeline

Every committed day advances exactly one day:

1. Recover any incomplete turn, apply operator settings/interventions queued for this boundary, and freeze the day number, rules version, RNG inputs, and starting state hash.
2. Prepare scheduled obligations in a staged turn snapshot: birthdays, pregnancy due dates, case/sentence timers, disease progression, and prior contracts. Generate weather and hazard opportunities from versioned rules. Persist that prepared input (or its complete deterministic regeneration inputs) before jobs begin; it is not yet committed world state and must not be applied twice after restart.
3. Build actor-specific observations. Adults observe public facts, personal accounts, local contacts, and witnessed events—not everyone's secrets. A dashboard observer can inspect full world state, but that view is never passed wholesale to residents.
4. Persist a job manifest; collect one structured plan per eligible adult concurrently from the same phase snapshot. Institutions are responsibilities held by residents with deterministic capacity rules, not unlimited extra omniscient agents.
5. Resolve at most two reciprocal dialogue rounds for selected negotiations/relationships. Replies see only that conversation and permitted facts. An unanswered proposal is not consent.
6. Validate and resolve phases: protective care/evacuation; household agreements; employment/production; market orders and consumption; civic actions, social conflict/crime; justice, migration, health consequences, and estates. Document precise subphase ordering in `docs/RULES.md`; handle mutually exclusive actions and unavailable targets explicitly.
7. Verify invariants; atomically commit outcomes, updated entities, ledger, event causes, RNG metadata, metrics, and canonical state hash. Publish a `day_committed` notification.
8. Run bounded newspaper/reflection work using committed evidence, then begin the next day. Optional presentation jobs may be skipped under load and never hold up economic correctness.

A plan has one primary work/civic action, one social action, and up to four market orders; invalid/conflicting actions get recorded rejection reasons. Continuing a job can be the default work action. Trades require reserved cash/stock, explicit quantities, and price limits. Network response order never determines priority: resolve by published phase rules, prices, and seeded rotating tie-breaks. Sequential conflict resolution must revalidate balances, life status, consent, and capacity; losing an order race does not invalidate the whole day.

Use independently derived RNG streams keyed by world seed, day, phase, entity, and action ID. Do not use wall-clock randomness in domain outcomes. Given the same starting state, rules, and stored decisions, replay produces the same hash. A fresh LLM call is not promised to be reproducible.

### Core state and storage

Use SQLite WAL, foreign keys, a busy timeout, and durable commits, with incremental numbered migrations. Never hold a database transaction open across model requests. Use safe integer minor currency units and inventory units, checked bounds, and integer allocation/remainder rules. JSON API representations must not silently lose integer precision.

Tables/repositories cover:

- `worlds`, `rules_versions`, `turns`, `jobs`, `model_attempts`, `operator_commands`, `settings_history`;
- `residents`, `households`, `kinship`, `relationships`, `pregnancies`, `businesses`, `buildings`, `contracts`;
- `accounts`, `ledger_entries`, `inventories`, `goods_flows`, `estates`, `estate_claims`;
- `health_cases`, `injuries`, `events`, `event_links`, `cases`, `evidence`, `sentences`, `factions`, `civic_offices`;
- `observations`, `memories`, `articles`, `daily_metrics`, and archive manifests.

Current normalized state is authoritative. Committed structured events/ledger and stored decisions are audit/replay records. Periodic canonical checkpoints accelerate loading and bound replay work; do not invent two independently mutable world states.

Turn lifecycle: `collecting → ready → committed`. Store immutable input hash, schema/rules versions, selected actors, validated decisions, terminal fallback outcomes, and stable effect IDs. Unique `(world, day, phase, actor, job_kind)` keys and effect IDs prevent duplicate application. A `ready` turn can be applied without another model call; an interrupted `collecting` turn requests only missing jobs. Late responses from expired attempts cannot replace an accepted result.

Use an OS-released exclusive lock for one writer per data directory, with Windows verification. Do not rely solely on a PID file or a long SQLite write transaction. A second runner refuses to start; stale metadata is diagnostic, not a permanent lock.

### Economy and sustainable bootstrap

Start with exactly **25 named, mixed-age residents**, grouped into supported households with caregivers and no unassigned dependents. Seed fixed, validated personas/goals; an optional model can decorate biographies without altering the count or balances. Include elders and near-adult children. New-town population targets below 25 are allowed: seed all 25, then activate the same gradual pressure policy used for later reductions.

Initial productive economy: farm/fishery, bakery, workshop, shop, housing, and simple clinic/guard/court/council services. Give the town initial food, tools, medicine, business working capital, funded public services, and several weeks of household reserves. Recipes, daily labor capacities, basic needs, housing capacities, asset prices, and recurring costs live in versioned scenario data with explicit units. Baseline automated policies must sustain a peaceful town before LLM drama is enabled.

- Businesses hire via offers/acceptance and posted wages; work consumes labor capacity and inputs to produce defined goods. Models may change legal prices, jobs, and investments but not recipes or output quantities directly.
- Market resolution reserves funds/stock, matches finite buy/sell orders, and records fills/rejections. Essential household provisioning has a defined default basket; unmet needs create gradual health/happiness pressure, not arbitrary instant death.
- Weekly external shipping supplies/imports and buys exports at explicit finite capacities and reference prices. Track external cash and goods accounts. Taxes, wages, purchases, fines, aid, crime transfers, and capital investment all have counterparties.
- New businesses use a fixed template, capital, location, and capacity checks; bankruptcy closes/transfers assets through rules. No unconstrained creation of buildings, jobs, or money. Loans/interest and sophisticated banking are deferred; startup finance uses savings or explicit equity contributions.
- Money conservation includes documented bootstrap/external issuance and destruction flows. Goods reconcile through production, imports, consumption, spoilage, theft/transfers, and destruction. Internal transfers are zero-sum. Reject overflow, negative inventory, duplicate ownership, and unfunded transfers.

## Generations, families, and population

Use a 365-day toy year and age-in-days; adulthood is 18 years. Children receive care, education/skill progression, and deterministic daily needs; no paid daily child-agent calls, adult romantic actions, or child labor in the foundation. Education/succession allow descendants to take jobs and civic roles.

- Adult partnerships and affairs require eligible, unrelated adults and reciprocal consent. Separate private relationships, public knowledge, and allegations. Separation/divorce assigns residence, dependent care, and household assets through published rules.
- Conception requires explicit compatible adult proposals and care/capacity checks; pregnancies last 280 days. Existing pregnancies remain protected after target changes. Children get kinship links, caregivers, household membership, and inherited/seeded traits with traceable RNG.
- Age, disease, validated injury, disaster, and resolved attacks can cause death through rules. The model can attempt harm, not directly set someone dead. No mortality increase solely to satisfy a population target.
- Death creates an estate: settle lawful obligations before distributing only remaining assets; follow a valid will, otherwise partner/descendant shares, stable-ID remainder allocation, and treasury succession if no heir exists. Minor heirs hold protected assets via a guardian/trust. Businesses remain owned/managed or enter a closure process. Disputed property stays escrowed with a case and a resolution deadline; caregiving is reassigned immediately.
- Immigration candidates need housing/care capacity and an explicit source/endowment transfer; emigration transfers or liquidates property consistently, closes/transfers obligations, and records destinations and family continuity. Migrants, deceased people, and descendants retain compact lineage tombstones rather than disappearing from history.

**Population maximum is a soft target**, default 120 and operator-configurable to any nonnegative integer. Track both current living residents and expected protected births. Above target: pause ordinary immigration/new conceptions, increase housing/economic/emigration pressure, and let residents consider departures. Essential-skill/refugee exceptions require explicit versioned rules and visible reasons, never silent quota bypass. Existing pregnancies can finish above target.

After a default 30-day unresolved pressure period, council may offer funded household resettlement. Limit normal assisted exits to one household/day, preserve dependent/caregiver units, protect essential roles where possible, and record agreement/reason/assets. Do not force a guaranteed deadline: if nobody can reasonably leave, remain visibly over target. Models may choose valid dramatic actions during pressure, but the cap system does not invent sickness, murder, or disaster to remove people.

Keep the soft social target separate from a host safety ceiling (default 500 living residents and bounded pending pregnancies/jobs). At the host ceiling, pause new turns with an explanation rather than deleting residents or canceling births. A target above the safety ceiling requires an explicit corresponding resource-setting change. At zero population, allow rule-based immigration when target/capacity permits; otherwise pause as `town_empty`, not an infinite zero-agent loop. Emergency initial bootstrap services have succession/closure rules when officeholders die or leave.

## Drama and civic mechanics — required foundation scope

All systems use shared primitives: prerequisites, costs/capacity, duration, evidence/visibility, seeded bounded effects, aftermath, and closure. No generated plot becomes fact merely because it is compelling. Severity/frequency presets are `calm`, `dramatic` (default), and `volatile`; none forces a disaster or death each day. Record proposed versus validated versus completed events separately. Sensitivity tuning is not a claim of real-world economic/social validity.

| System | Minimum executable mechanics and closure |
|---|---|
| Crime and corruption | Theft/fraud require access, motive, opportunity, and valid assets; success transfers actual assets and creates hidden/public evidence. Corruption requires office/access and a traceable benefit. No more assets can be stolen than exist. |
| Investigations and justice | Reports create allegations/cases, not guilt. Institutional capacity spends time gathering admissible records/witnesses. Trial weighs evidence/defense/procedure; corruption can affect process within bounds. Acquittal, dismissal, fines, restitution, probation, or time-limited imprisonment; detention costs, capacity, expiry, and release exist. Ground truth and public findings can differ. |
| Factions and politics | Membership, interests, grievances, leadership, resources, recruitment, campaigns, and constrained coordination. Annual adult elections with vacancies/succession; council controls bounded taxes, public spending, and policies. No self-authored executable laws. |
| Disasters and scarcity | Storm, flood, fire, drought damage specific locations/assets within severity envelopes. Preparation, evacuation, relief, rebuilding costs, and recovery durations matter. Injury/death routes through the health resolver. |
| Public health | Susceptible/exposed/infectious/recovered cases, location/contact-based transmission, disease durations, medicine, limited clinic capacity, treatment, injuries, disability, recovery, age-sensitive mortality. No LLM-diagnosed illness directly modifies health. |
| Household conflict | Adult betrayal/affairs, discovery/evidence, trust loss, divorce, custody/care, scandals, feuds, reconciliation, and inheritance disputes; cooldowns and legal resolution prevent eternal duplicate incidents. |
| Labor unrest | Wage/safety/workload grievances cause bargaining, strikes, and production loss; track participants, demands, union/faction support, concessions, and return-to-work rules. |
| Public unrest and violence | Protests may escalate to riots only with documented thresholds and failed de-escalation. Assault is an abstract contested action with defense/witness/injury rules; murder is a legal classification of a fatal validated attack. No operational violence instructions. |
| Rebellion | Sustained grievances, organized faction backing, resources, and weakened legitimacy permit an uprising. Resolve by negotiation, concessions, arrests, defection, or bounded authority change; restore offices/property obligations afterward. It cannot be a one-line model command to take over the town. |

Narration stays non-graphic; all romantic/sexual relationships involve adults and are non-explicit. The foundation includes causal mechanics for every row, not just a text generator that mentions them. Richer procedural geography, tactical combat, cross-town geopolitics, custom constitutions, mod scripting, 3D animation, and arbitrary model-written game rules are deferred.

## Models, memory, throughput, and failure handling

### API contract and jobs

Use one configurable model initially, with optional role overrides for resident decisions and narration. Never automatically select an expensive fallback. No Pi runtime dependency. Resident jobs receive bounded identity/goals, relevant memories, perceived events, resources, relationships, legal action enum, and target IDs. Output contains validated structured actions plus a short decision summary—not hidden chain-of-thought.

Run `doctor --probe` once per provider/model profile to discover supported JSON Schema, JSON-object, or plain-text JSON mode. Prefer schema enforcement where supported, but always locally validate action shape, numeric ranges, IDs, permissions, and phase rules. Handle gateway refusals, empty output, truncated output, unsupported parameters, fenced JSON, wrong types, and unauthorized action names. No unrestricted regex extraction or model-generated code execution. One bounded repair request is allowed; otherwise record fallback.

Persist capability profile, prompt/schema versions, model ID, attempt status, latency, token usage/estimates, and redacted request IDs. API keys remain in server environment only. Reject cross-origin redirects carrying credentials; allow an explicitly configured local HTTP endpoint, otherwise recommend HTTPS. Model-generated URLs and resident messages cannot trigger external HTTP/tool calls.

### Bounded default throughput

Initial tunable defaults: concurrency 8, in-memory queue capacity 256, request timeout 60 seconds, maximum 3 total HTTP dispatches/job including initial request, transport retries, and at most one schema repair; maximum 3,000 input and 800 output tokens per decision; at most two dialogue rounds for four conversations/day. Feed persisted jobs incrementally into the bounded queue even when a day's actor count exceeds 256. Enforce prompt byte/record caps; use a compatible tokenizer where available and otherwise label input-token counts as conservative estimates, not exact limits. Model/provider parameter differences are capabilities, not assumed universal support. Deadlines and retry delays are configurable and visible.

Every eligible adult receives a daily decision opportunity; if an operator sets a lower daily job budget, use persisted rotating priority and label deterministic fallback choices. Do not silently reduce participation as population grows. Children/ongoing treatment and passive contracts do not create recursive model jobs. Institutions and narration share the global pool so nested jobs cannot evade limits.

Maximum-throughput mode inserts no sleep between healthy days. Concurrency may reduce on rate-limit pressure and recover up to the configured ceiling, never increase beyond it. Observe `Retry-After`, exponential backoff with bounded jitter, and per-profile request/token rates. Hard upper bounds apply to queue length, response bytes, actions, conversations, memory retrieval, and attempts.

### Failure policy

- Isolated timeout, malformed response, refusal, or exhausted job retries: safe baseline behavior such as maintain valid work, buy affordable food, seek treatment, shelter, otherwise no-op. Record who used fallback and why.
- HTTP 429 transient rate limits: stop new dispatch, honor cooldown, then retry within bounds. Broad outage or a default 50% terminal fallback rate pauses at a safe boundary; do not silently run years without the models.
- Authentication failure, confirmed quota exhaustion, or configured allowance exhaustion: save progress and **pause simulated time** while keeping dashboard/status available. Manual resume or explicitly configured reset scheduling restarts checks; never spin paid retries indefinitely. Unknown 429 cause gets bounded retries then a visible provider pause.
- Disk pressure, invariant failure, unsafe schema migration, integer overflow, or host population ceiling: pause with diagnostics. Never overwrite a corrupt database, reset the town, or fabricate a successful day.
- No internet, provider signup, package installation, human chat, external messaging, purchases, self-modification, or host access is delegated to simulated residents.

Setup requires an explicit usage policy: configured daily/monthly token/request/currency ceilings, or explicit `null` ceilings for the user's maximum-throughput choice. No hidden arbitrary total-run cutoff; a null spending ceiling does not disable concurrency, timeout, retry, byte, population, or storage safety bounds. Persist all usage across restarts. Reserve estimated input plus max output against hard configured budgets before dispatch; reconcile actual reported usage afterward. If a provider omits token counts, mark conservative estimates; currency limits require configured prices and cannot guarantee provider billing. Monthly reset timezone/day is explicit. Requests interrupted after dispatch may have been billed and may need reissuing: guarantee exactly-once world effects, **not exactly-once external billing**.

### Memory and derived content

Store observed events with provenance and public/private/rumor tags. Retrieve recent, important, and relationship-linked memories using SQLite indexes/FTS; embeddings are optional future work. Default per-actor prompt retrieval is capped at 20 records plus a compact biography/goals summary. Reflection is a labeled belief referencing event IDs; it cannot change an authoritative account, conviction, health state, or family tree. Generate reflections on important events or weekly, not an unbounded reflection loop.

Each day's newspaper uses only committed event IDs, with quoted rumors labeled as rumors. Validate references; publish a deterministic factual digest when narration fails. Keep allegations, verdicts, narrator interpretations, and ground truth visibly distinct. Optional summaries/catch-up have stable job IDs and a bounded backlog.

## Dashboard and operator controls

Local React dashboard with event-driven refresh and paginated APIs:

- Overview: simulated date, day phase, running/paused reason, throughput, in-flight requests, model/fallback counts, usage, free disk, storage growth, invariant status, population/target/expected births.
- Town: simple locations/businesses diagram, household occupancy, jobs, supply chains, prices, wages, treasury, inequality, shortages, external trade, and debt-free equity ownership.
- Residents: profile, goals, public/private knowledge labels, daily actions/outcomes, memories, relationships, genealogy, health, assets, criminal cases, and fate/destination.
- Drama: active disasters, outbreaks, evidence/cases/sentences, factions, elections, scandals, unrest, and linked cause/effect timelines.
- Newspaper and history: daily headlines, archive search, charts, generation milestones, named deceased/emigrated residents, and estate succession.
- Controls: pause/resume, population target, concurrency, enabled limits, drama intensity, and audited validated event injection. Settings and interventions apply at a documented turn boundary, never mutate mid-resolution. Dangerous injections require confirmation, but autonomous residents do not.

Serve only on `127.0.0.1` initially; no remote exposure/authentication product. Protect mutation routes with an ephemeral same-origin session/CSRF token and strict Origin/Host checks; no permissive CORS. Keep secrets out of APIs, SSE, bundles, errors, exports, backups metadata, and logs. Avoid putting tokens in URLs.

SSE announces state revisions/event IDs; clients fetch bounded detail pages. Reconnect using last event ID, and resync from current revision if the replay window has expired. Slow/disconnected browsers have bounded queues and cannot slow or grow the simulation indefinitely.

## Long-run durability, retention, and observability

- `data/tidehaven.sqlite`, backups, archives, and redacted rotating logs reside under `D:/Projects/Tidehaven/data/` by default, with an absolute configurable data directory. A relative directory is resolved against a stable project root, never whichever directory launched a subprocess.
- Initial retention, measured in **simulated days** unless explicitly labeled wall-clock: 30 days of raw redacted model payloads, 365 days of detailed prompt/observation records, bounded per-resident working memory, and a checkpoint every 30 days. Retain compact facts, lineage, final estate ownership, case outcomes, and daily aggregates for the active world.
- Archive old detailed events/decisions in bounded chunks with manifests, checksums, schema/rules versions, and checkpoint references. Verify archive durability before pruning source detail. Recent replay is immediate; older exact replay requires retained archives. Never claim indefinite exact replay after deleting inputs.
- Default project storage budget 10 GiB and minimum free volume space 5 GiB. Keep archive/backup overhead inside the accounted budget, reserve room for a checkpoint/rollback, rotate logs/backups, and pause before running out of room. No process can keep an infinite history in finite storage: continue only with available capacity or an explicitly approved retention/export policy. Never silently erase lineage or world state.
- Use SQLite's supported consistent backup facility, not copying a live database while ignoring WAL. Keep 3 rotating verified local backups; migration requires a successful backup and compatibility checks first. Test restore into a separate data directory.
- Emit JSON logs with world/day/phase/job IDs, durations, outcome/fallback reason, queue sizes, provider error classes, invariant diagnostics, and storage usage. Never log credentials or unnecessary raw prompts.
- Provide offline `status` and `doctor` diagnostics, pause reason files/checkpoints where possible, and clear recovery instructions for insufficient space. Invariant failures preserve last good state and a bounded redacted diagnostic bundle.

## Files to modify / create after approval

Paths below are under `D:/Projects/Tidehaven/`; no application files currently exist.

```text
PLAN.md, README.md, AGENTS.md
package.json, package-lock.json, tsconfig.json, vite.config.ts, vitest.config.ts, eslint.config.js
.env.example, .gitignore, config/defaults.json, scenarios/tidehaven.json
docs/RULES.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md, docs/PROVIDER.md
src/main.ts, src/cli.ts, src/config.ts
src/contracts/actions.ts, src/contracts/api.ts, src/contracts/events.ts
src/domain/state.ts, clock.ts, rng.ts, invariants.ts, turn-engine.ts
src/domain/economy/{ledger,market,production,employment,businesses,trade}.ts
src/domain/society/{households,demographics,population,relationships,estates,education}.ts
src/domain/events/{framework,disasters,health,crime,justice,factions,politics,unrest}.ts
src/application/{bootstrap,observations,memories,newspaper,commands,queries,recovery,retention}.ts
src/storage/{database,migrate,repositories,checkpoints,backup,lock}.ts
src/storage/migrations/001-core.sql, 002-society.sql, 003-drama.sql
src/model/{client,capabilities,jobs,prompts,validate,fallback}.ts
src/runtime/{runner,pool,limits,usage,shutdown,telemetry}.ts
src/http/{server,routes,sse,security}.ts
client/index.html, client/src/main.tsx, client/src/App.tsx, client/src/api.ts, client/src/styles.css
client/src/views/{Overview,Town,Resident,Economy,Drama,History,Controls}.tsx
scripts/{verify,doctor,soak}.ts
tests/{unit,property,integration,e2e,soak}/
tests/fixtures/{fake-provider,seed-town,scripted-decisions,crash-points}.ts
```

Keep modules purpose-sized; add migrations rather than rewriting applied ones. Runtime data, `.env`, archives, logs, build output, and dependency directories are ignored; checked-in scenarios/config contain no credentials. Add Git tooling only during approved setup, with no automatic commit/push.

## Reuse

No local simulation functions were found to reuse. Reuse the documented components from Prior Art: SQLite transactions/backups/indexes, Zod validation/JSON Schema generation, native HTTP fetch/AbortController, Fastify routing/static hosting, React UI, and established testing tools. Implement only the simulator's domain rules, job persistence, and orchestration. Do not copy research framework code without a separate license/fit review. During setup read exact-version library docs and check actual Windows SQLite/lock compatibility before implementation depends on them.

## Steps — staged delivery with executable gates

All gates are offline unless explicitly labeled live. Add tests alongside each slice; do not postpone correctness until the final dashboard. Check off a task only when its code, tests, and operating notes exist. The full foundation is complete only after all tasks, including generations and every drama category, pass.

- [x] **T0 — Relocate and record contracts.** Safely establish `D:/Projects/Tidehaven`, verify copied plan, create project guidance and `docs/RULES.md`/`OPERATIONS.md`; record defaults, units, subphase order, initial recipes/balances, consent rules, mortality bounds, civic thresholds, and migration policy. Confirm free space, provider environment shape, package compatibility, and data/cache paths. Gate: no secrets, no overwrites, and approved scope maps to later tasks.
- [x] **T1 — Runnable shell and offline harness.** Create package/build/type/test setup, CLI/config validation, minimal local server, fixture provider, health/status routes, and `npm run verify`. Gate: a clean approved setup on Windows can build, start/stop, and run offline tests without provider credentials; normal live mode fails clearly on missing configuration.
- [x] **T2 — Persistence, locking, deterministic clock/RNG.** Implement migrations, repositories, turn/job state machines, canonical hashes, checkpoints, consistent backup/restore, singleton locking, and crash-point injection. Gate: competing runners rejected; `collecting`/`ready` restart without duplicate effects; same inputs hash identically.
- [x] **T3 — Sustainable economy and exact bootstrap.** Implement 25 residents/households, seed businesses/services, double-entry cash ledger, goods-flow accounting, labor/recipes, market matching, shipping, taxes/public budgets, founding/closure, and economic invariants. Gate: peaceful baseline runs 365 days without accidental famine or money creation; seeded shortages and price changes produce expected consequences.
- [x] **T4 — Generations, care, estates, population.** Implement daily aging, education/adulthood, consent/partnerships, pregnancies/births, natural mortality, wills/estates/minor heirs, migration, soft-target changes, and safety-ceiling pauses. Gate: scripted birth → adulthood → household/business succession; inheritance balances; below-current and below-25 targets cause gradual recorded pressure, never deletion.
  > Evidence: `tests/integration/lifecycle-default.test.ts` runs the gate on the **default calendar**
  > (280-day gestation, 6,570 daily childhood transitions, education across the childhood, exact
  > adulthood day, participation, persistence). Early-birth and stopped-education mutations fail it.
- [x] **T5 — Hazards and health.** Implement shared event lifecycle, weather/disasters, contact-based disease, treatment capacity/medicine, injuries/recovery/death, evacuation/relief/rebuilding. Gate: bounded effects, finite capacity, causal death records, protected recoveries, no duplicate events from retries.
- [x] **T6 — Civic institutions and justice.** Implement council/elections/tax constraints, faction membership/resources, crime/fraud/corruption, evidence visibility, investigation, trial, fines/restitution/probation/prison/release. Gate: allegations cannot directly convict; theft conserves assets; institutional succession and prison expiry work.
- [~] **T7 — Interpersonal and collective drama.** Implement adult affairs/discovery/divorce/care, feuds/reconciliation/scandals, disputed estates, strikes/protests/riots, abstract attacks/murder classification, and rebellion/authority restoration. Gate: each requested category has positive/negative/closure scenarios and prerequisites; no magical authority or instant model-declared deaths.
  > Evidence status: see `docs/COVERAGE.md` — this task is implemented and tested, but not every
  > drama family has a full prerequisite/success/closure matrix yet (several do).
- [x] **T8 — Model decisions, observations, and memory.** Implement compatibility probes, bounded JSON plans, local validation, reciprocal dialogue, privacy-aware observations, provenance retrieval/reflections, and evidence-grounded newspaper. Gate: fake providers exercise unsupported schema, malformed/truncated/refused responses, prompt injection, fabricated evidence, and adult-consent rejection. No output can directly patch state.
- [x] **T9 — Continuous autonomous runner.** Integrate durable jobs, bounded concurrency/pool, sequential daily barriers, deadline/backoff/repair/fallback, persisted quota/usage reservations, circuit breaker, safe pause/resume, live settings, and Windows shutdown. Gate: out-of-order completions produce identical outcomes; provider-wide failures pause time; restart resumes incomplete jobs without rerunning completed effects.
- [x] **T10 — Browser observability and controls.** Build all listed views, charts/lineage, event/decision cause links, structured local API contracts, bounded SSE/reconnect, CSRF/Origin checks, and control queue. Gate: Playwright exercises overview → resident → causal event → genealogy; pause/resume/target changes persist; closing browser leaves runner healthy; malicious generated HTML renders inertly.
- [~] **T11 — Long-run storage and performance.** Implement retention/archives/aggregation, rotating logs/backups, free-space and size guards, restore/migration rehearsals, and trend diagnostics. Gate: 10,000-day mock soak and multi-generation scripted run pass invariants, record bounded queues/memory, validate archives, and recover from disk-full simulation. Compact-history growth is measured; it is not claimed to be zero.
  > Evidence status: see `docs/COVERAGE.md` — this task is implemented and tested, but not every
  > acceptance scenario in the gate is retained as reproducible evidence yet (500-resident stress and
  > status/control p95 latency are not benchmarked).
- [~] **T12 — Final end-to-end acceptance and handoff.** Run `verify`, Windows process-kill/resume tests, all mechanics coverage checklist, optional authorized 10-day live-model smoke, and a human-readable run report. Document setup → one-command start → observe → stop → resume → backup/restore → provider troubleshooting. Foundation complete only when every promised system is executable and the user can operate it without a coding agent.
  > Evidence status: see `docs/COVERAGE.md` — this task is implemented and tested, but not every
  > acceptance scenario is retained yet (the live-model smoke run needs operator credentials).

Dependencies: T0→T1→T2→T3; T4 builds on T3; T5 builds on T3/T4; T6 builds on T3/T5; T7 builds on T4–T6; T8 contracts can be developed alongside domain slices after T2 but integration uses T4–T7; T9 integrates T8 and the engine; T10 uses stable API/domain contracts; T11–T12 validate the whole. Each task should be split into small testable commits by the implementer; do not build the whole system as one unreviewable change.

## Verification and completion criteria

### Automated correctness

- Unit and property tests for integer safety, conservation, recipes, trade partial fills, competing orders, seeded fairness, budgets, consent, genealogy, care reassignment, protected pregnancies, succession, population pressure, and every event lifecycle.
- For each drama family: prerequisite rejection, successful path, failed/mitigated path, closure, capacity/cost accounting, and retry/idempotency coverage. Use forced test RNG/outcomes, not hoping rare events occur during a soak.
- Calendar test: exactly 6,570 day transitions from birth to age 18. Scripted multi-generation runs verify children become agents, inherit assets, and found households/businesses without age shortcuts.
- Privacy tests ensure actor snapshots exclude unrelated balances, hidden crime truth, private affairs, and future decisions unless evidence/knowledge rules allow disclosure.
- Repeat the same seed/stored decisions with shuffled provider completion order; state hashes must match. Test sequential-order bias with symmetric fixtures and multiple seeds.

### Resilience and storage

- Fake HTTP providers: 401/403, 429 with/without `Retry-After`, 5xx, timeouts, dropped connections, oversized responses, bad JSON, unknown actions, schema unsupported, refusal, omitted usage, and late duplicate responses.
- Process kill/restart at collection, stored response, ready turn, commit, archive, backup, and migration boundaries; verify no lost committed day or duplicated money/birth/sentence. Reissued provider calls may cost again and must be reported honestly.
- First Ctrl+C reaches a resumable stop within the configured 10-second drain budget, barring an already-entered short commit; second interrupt/crash also recovers. Verify terminal behavior on Windows. A second process cannot write the same town.
- Simulate low disk, write failure, expired credentials, quota exhaustion, zero residents, all adults unavailable, disputed estates, missing officeholders, over-target pregnancies, and resource ceiling. Paused time and reason must be observable; no infinite retry loops.
- Restore backups/checkpoints/archives into a new directory and verify hashes, provenance, lineage, and historical metrics before claiming recovery works.

### End-to-end and performance

- `npm run verify`: strict typecheck, lint, unit/property/integration tests, and production build. Browser tests use the fake provider and require no paid API.
- `npm run test:e2e`: one-command startup, dashboard/event updates, private observer labels, controls/settings, newspaper fallback, safe shutdown, and resume of the same world.
- `npm run test:soak -- --days 10000 --provider mock`: daily invariants, genealogy, event coverage, usage accounting, archive correctness, and hourly memory/disk/latency reports. Soak tests can batch scripted decisions without HTTP; a separate smaller soak must exercise real fake-HTTP scheduler/persistence.
- At 25 residents with a fake provider: target responsive status/control reads (p95 <500 ms outside checkpoints), no queue beyond configured caps, and no sustained post-warmup memory growth. Record hardware/throughput rather than promise an unmeasured live days/hour figure. Stress the 500-resident host ceiling separately.
- Explicitly authorized live smoke: run 10 days under a small request/output budget, observe real decisions/effects and fallback rates, stop/resume, inspect usage and one causal chain. Never make real-model calls part of the default test suite or declare story quality proven by mocks.

### Definition of done

From `D:/Projects/Tidehaven`, after documented one-time setup, `npm start` runs a persistent, autonomous, daily society of 25 starting residents with every requested economic/generational/dramatic mechanism. Residents act without routine human approval; the user can inspect events and causes in a local browser, adjust the soft population target, and stop/resume safely. Provider and resource failures produce a visible safe pause rather than corruption or unlimited retries. No simulated resident can access the host, invent authoritative facts, or spend outside the configured API channel. No guarantee is made that a toy society never collapses, that finite storage supports literal infinity, or that the simulation predicts real people.
