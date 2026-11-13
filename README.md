# Tidehaven

A persistent island-town society simulator. Cheap OpenAI-compatible models play the residents;
deterministic TypeScript code owns the facts — money, goods, production, time, births, deaths,
crimes, trials, disasters, and elections.

One command starts (or resumes) the town and serves a local dashboard:

```bash
npm install
npm run build                # required once: doctor/start run the compiled server in dist/
cp .env.example .env         # set TIDEHAVEN_API_BASE_URL / TIDEHAVEN_API_KEY / TIDEHAVEN_MODEL
npm run doctor -- --probe    # optional: one authorized small paid request
npm start                    # http://127.0.0.1:4317
```

`npm run build` is required before `doctor`, `start`, `status`, `backup`, or the soak: those commands
execute the compiled entry points in `dist/`, and a fresh checkout has none.

Residents decide automatically; you watch. Stop with Ctrl+C (or pause in the dashboard). The next
`npm start` resumes the same town from the last committed day.

## What you get

- A persistent town of 25 founding residents that runs day by day on its own.
- An economy with real double-entry books: wages, taxes, market orders, exports, bankruptcies.
- Generations: courtship with consent, births, education, adulthood, deaths, wills and inheritance,
  immigration and emigration, a soft population target, and a hard safety ceiling.
- Drama with rules: theft and fraud, investigations, trials and prison, factions and elections, storms,
  fires, outbreaks, affairs and divorces, strikes, protests, riots, and rebellion.
- A local dashboard: overview, town, residents (with genealogy), economy, drama, history/newspaper,
  and controls.
- Safety: crash-safe commits, one writer per data directory, verified backups, checkpoints, archives,
  and a visible pause instead of an infinite retry loop.

## Commands

```bash
npm start              # create (once) or resume the town; dashboard on 127.0.0.1:4317
npm run status         # offline status of the saved town
npm run doctor         # offline diagnostics (-- --probe for one paid call)
npm run backup         # consistent SQLite backup while paused or stopped
npm run verify         # typecheck + lint + production build + tests (safe from a clean checkout)
npm run test:e2e       # Playwright dashboard checks (offline fixture provider)
npm run test:soak -- --days 10000   # long-run invariant soak
```

## Documentation

- Design: [`PLAN.md`](PLAN.md)
- Rules and numbers (authoritative): [`docs/RULES.md`](docs/RULES.md)
- Operating it: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- Internals: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Provider setup and failure policy: [`docs/PROVIDER.md`](docs/PROVIDER.md)
- Mechanics coverage checklist: [`docs/COVERAGE.md`](docs/COVERAGE.md)
- Acceptance run report (measured results): [`docs/RUN-REPORT.md`](docs/RUN-REPORT.md)

## Status

The foundation described in `PLAN.md` is implemented and verified offline: 84 tests, 7 browser tests,
a 10 000-day soak, crash/restart and single-writer checks. A live paid-model run is the one thing this
repository cannot demonstrate without your credentials — see `docs/PROVIDER.md` and then
`npm run doctor -- --probe`.
