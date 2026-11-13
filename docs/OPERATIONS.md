# Operating Tidehaven

## One-time setup

1. Install dependencies (Node.js 26 or newer):
   ```bash
   npm install
   ```
   Dependency install is explicit — `npm start` never installs packages.
2. Create the environment file and fill in the provider:
   ```bash
   cp .env.example .env
   ```
   | Variable | Meaning |
   |---|---|
   | `TIDEHAVEN_API_BASE_URL` | API root of an OpenAI-compatible endpoint, usually ending in `/v1` |
   | `TIDEHAVEN_API_KEY` | bearer token; leave empty only for a local endpoint that needs no auth |
   | `TIDEHAVEN_MODEL` | model identifier, e.g. a cheap small model |
   | `TIDEHAVEN_SCENARIO` | optional founding scenario name from `scenarios/` (default `tidehaven`; `eden` = Adam and Eve only) |
   | `TIDEHAVEN_WORLD_NAME` | optional town name, applied when the town is founded |
   | `TIDEHAVEN_DATA_DIR` | optional absolute data directory (default `./data`) |
   | `TIDEHAVEN_PORT` | optional dashboard port (default `4317`) |
   | `TIDEHAVEN_MAX_OUTPUT_TOKENS` | optional output token allowance per request (default `800`; reasoning models need more) |
   | `TIDEHAVEN_MIN_FREE_MB` | optional free-space floor before a `disk_pressure` pause (default `5120`) |
   | `TIDEHAVEN_POPULATION_TARGET` | optional initial soft target (default `120`) |
   | `TIDEHAVEN_POPULATION_POLICY` | founding-only `soft_target` or `disabled` (scenario/default applies when unset) |
   | `TIDEHAVEN_HOST_CEILING` | optional finite host ceiling, integer `1..10000` (default `500`) |
3. Build:
   ```bash
   npm run build
   ```
4. Diagnose:
   ```bash
   npm run doctor            # offline: config, SQLite, disk, data dir. No provider call.
   npm run doctor -- --probe # one small, explicitly authorized paid request
   ```

## Everyday operation

```bash
npm start        # create the town on first run, otherwise resume it
```

The dashboard is served at <http://127.0.0.1:4317> (loopback only). The runner keeps going when the
browser is closed.

- **Pause** from the dashboard Controls page (applies at the next safe day boundary) or stop the
  process.
- **Ctrl+C** stops scheduling immediately, aborts/drains in-flight requests within the drain budget
  (10 s by default), finishes any in-progress synchronous commit, closes the database, and releases
  the singleton lock. A second Ctrl+C forces exit; crash recovery still works.
- **Resume** by running `npm start` again. The unfinished day is finished, or the next day starts if
  the previous one committed.

### Offline helpers (no server, no provider)

```bash
npm run status    # simulated date, day phase, pause reason, population, usage summary
npm run backup    # consistent SQLite backup into data/backups/
npm run doctor    # configuration and storage checks
npm run verify    # typecheck + lint + tests + production build
```

## Pause reasons and recovery

Paused states are also written to `data/pause.json` with the reason and last committed day.

| Reason | Meaning | Recovery |
|---|---|---|
| `authentication` | 401/403 from the provider | fix `TIDEHAVEN_API_KEY`, restart or click Resume |
| `quota` | confirmed quota/allowance exhaustion | top up, adjust ceilings in settings, Resume |
| `provider_down` | broad outage / fallback rate over threshold | wait, then Resume |
| `disk_pressure` | free space below the minimum | free space or point `TIDEHAVEN_DATA_DIR` at another volume |
| `storage_budget` | project data exceeded the storage budget | archive/export or raise the budget explicitly |
| `invariant_failure` | accounting/goods invariant broke | do not delete data — inspect `data/diagnostics/` |
| `population_ceiling` | host safety ceiling (500) reached | lower the target or accept the pause |
| `town_empty` | no residents and no possible immigration | adjust target/immigration settings |
| `operator` | you paused it | click Resume |

Never delete `data/tidehaven.sqlite` to "fix" a pause: restore a backup from `data/backups/` into a
separate directory first and compare.

## Backup and restore

- Backups use SQLite's online backup API (WAL-safe), verified by a `PRAGMA integrity_check` on the copy.
- Three rotating backups are kept by default.
- Restore by copying a backup file to a *new* data directory and starting with
  `TIDEHAVEN_DATA_DIR` pointing at it. Compare `npm run status` output before replacing the original.

## Logs

JSON lines in `data/logs/tidehaven-YYYYMMDD.log`, rotated daily and bounded in count and size.
Every log record includes world/day/phase/job identifiers when applicable; credentials and raw
prompts are never logged.

## Provider troubleshooting

See `docs/PROVIDER.md`. Short version: check `npm run doctor -- --probe`, verify the base URL ends in
`/v1` when the provider expects it, and confirm the model name exists for that key. Capability
probes (JSON Schema vs JSON mode vs plain JSON) are cached in the database and shown by `doctor`.
