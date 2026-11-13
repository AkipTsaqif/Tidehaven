# Tidehaven — Agent Guidance

Tidehaven is a persistent, deterministic island-town society simulator. Cheap OpenAI-compatible
models *propose* actions; deterministic application code owns facts, money, goods, time, and
validation. Read `PLAN.md` (approved design) and `docs/ARCHITECTURE.md` before changing behavior.

## Non-negotiable rules

1. **The engine is authoritative.** Model output is untrusted data. Nothing a model returns may write
   state directly; it passes through Zod validation and a domain resolver that re-checks balances,
   life status, consent, capacity, and phase ordering.
2. **Determinism.** Domain outcomes use seeded RNG streams keyed by `(worldSeed, day, phase, entity,
   actionId)`. Never use `Math.random()`, `Date.now()`, or wall-clock time inside
   `src/domain/**`. Replaying the same state + stored decisions must reproduce the same state hash.
3. **Integer money and goods.** Money is integer minor units (cents), goods are integer units.
   No floats in domain accounting. Reject overflow, negative balances, unfunded transfers.
4. **Short transactions.** No `await` on network inside a SQLite transaction. Never hold a write
   transaction across model requests.
5. **Privacy.** Actor observations are filtered per actor. Never pass full world state to a resident
   prompt. Secrets (API keys) never reach logs, SSE, API payloads, exports, or the client bundle.
6. **Bounded work.** Queue length, concurrency, timeouts, retries, response bytes, prompt records,
   populations, and storage all have hard caps. No unbounded loops or retry storms.
7. **No secrets in the repo.** Configuration comes from server-side env vars; `.env` is git-ignored.

## Layout

```
src/contracts/   Zod schemas: actions, API DTOs, events
src/domain/      Pure rules + state transitions (no I/O, no network, no HTTP)
src/application/ Orchestration: bootstrap, observations, memories, newspaper, commands, queries
src/storage/     SQLite (node:sqlite), migrations, repositories, checkpoints, backup, lock
src/model/       OpenAI-compatible HTTP adapter, capabilities, prompts, validation, fallback
src/runtime/     Runner, bounded pool, limits, usage, shutdown, telemetry
src/http/        Fastify server, routes, SSE, CSRF/origin security
client/          React + Vite dashboard
scripts/         verify, doctor, soak
tests/           unit, property, integration, e2e, soak + fixtures (fake provider)
```

Domain code must not import `src/http`, `src/storage` implementations, or `src/model`.

## Commands

```bash
npm run verify      # typecheck + lint + unit/property/integration tests + production build
npm start           # create (once) or resume the town, serve dashboard on 127.0.0.1:4317
npm run status      # offline status of the saved town
npm run doctor      # offline configuration/storage diagnostics; --probe makes one paid call
npm run backup      # consistent SQLite backup while paused/stopped
npm run test:e2e    # Playwright dashboard checks against the fake provider
npm run test:soak   # long-run invariant soak
```

## Working style

- Add a numbered migration for schema changes; never edit an applied migration.
- Every rule gets a unit or property test. Drama mechanics need prerequisite/success/closure tests
  with forced RNG, not "hope it happens in a soak".
- Keep modules purpose-sized. A change that rewrites three subsystems is not reviewable.
- Data lives in `data/` (git-ignored). Never delete a user's saved town; never auto-reset state.
- Commit messages: Conventional Commits. Never push, never force-push, never `git reset --hard`.
