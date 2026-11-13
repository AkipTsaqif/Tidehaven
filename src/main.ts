#!/usr/bin/env node
import { join } from 'node:path';
import {
  ConfigError,
  loadConfig,
  requireProvider,
  validateProvider,
  type AppConfig,
} from './config.js';
import { loadScenario, RULES_VERSION, scenarioHash } from './application/scenario.js';
import { resumeScenario } from './application/saved-scenario.js';
import { createTown } from './application/bootstrap.js';
import { makeStatus, readPauseFile } from './application/status.js';
import { databasePath, savedWorldExists } from './application/diagnostics.js';
import { assertNoLegacyTown } from './application/legacy-data.js';
import { readWorld, loadState, type WorldRow } from './storage/repositories.js';
import { openDatabase, type Db } from './storage/database.js';
import { latestSchemaVersion, migrate, needsMigration } from './storage/migrate.js';
import { schemaVersion } from './storage/database.js';
import { createBackup } from './storage/backup.js';
import { acquireLock, type AcquiredLock } from './storage/lock.js';
import { createLogger, type Logger } from './runtime/telemetry.js';
import { Runner } from './runtime/runner.js';
import { MockDecisionSource } from './model/mock.js';
import { DisabledDecisionSource, ModelDecisionSource, type DecisionSource } from './model/jobs.js';
import { ModelClient } from './model/client.js';
import { UsageTracker } from './runtime/usage.js';
import { capabilityFromEnv } from './model/capabilities.js';
import { createServer } from './http/server.js';
import { registerRoutes } from './http/routes.js';
import { SseHub } from './http/sse.js';
import { VERSION } from './version.js';
import { createInterruptGuard, shutdown } from './runtime/shutdown.js';
import type { StatusSnapshot } from './contracts/api.js';
import type { WorldState } from './domain/state.js';

/**
 * Composition root for `npm start`.
 *
 * Order matters: configuration -> lock -> database/migrations -> world -> runner -> server.
 * Nothing advances simulated time until the provider configuration is usable (or the fixture source is
 * selected explicitly), and a failure at any step leaves the data directory untouched.
 */

interface Running {
  config: AppConfig;
  logger: Logger;
  db: Db;
  world: WorldRow;
  state: WorldState;
  runner: Runner;
  source: DecisionSource;
  lock: AcquiredLock;
  sse: SseHub;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';
  if (command !== 'start') {
    process.stderr.write(`Unknown command "${command}". Try: npm start | npm run status | npm run doctor\n`);
    process.exitCode = 2;
    return;
  }

  const fixture = process.env.TIDEHAVEN_FIXTURE === '1';
  const config = loadConfig({ fixtureProvider: fixture });
  // Never found a fresh town in the new per-scenario folder while the old town sits one level up.
  assertNoLegacyTown(config);
  const logger = createLogger({
    level: config.defaults.runtime.logLevel,
    logDir: join(config.dataDir, 'logs'),
    keepFiles: config.defaults.storage.logFiles,
    console: false,
  });

  // --- provider gate -------------------------------------------------------
  // "Has a town" means a saved world record — not merely a database file, which tools can create.
  const hasTown = savedWorldExists(config);
  const providerIssues = validateProvider(config.provider);
  if (!fixture && providerIssues.length > 0 && !hasTown) {
    process.stderr.write(
      'Tidehaven cannot found a town without a model provider.\n' +
        providerIssues.map((issue) => `  - ${issue}\n`).join('') +
        '\nSet TIDEHAVEN_API_BASE_URL, TIDEHAVEN_API_KEY, and TIDEHAVEN_MODEL in .env,\n' +
        'or run with TIDEHAVEN_FIXTURE=1 for an offline scripted town.\n',
    );
    process.exitCode = 2;
    return;
  }

  const lock = acquireLock(config.dataDir, VERSION);
  logger.info('lock acquired', { dataDir: config.dataDir, pid: process.pid });

  const db = openDatabase(databasePath(config));
  const schemaBefore = schemaVersion(db);
  if (needsMigration(db)) {
    if (schemaBefore > 0) {
      logger.info('backing up before migration', { schemaBefore });
      await createBackup(db, config.dataDir, { keep: config.defaults.storage.backups, label: 'pre-migrate' });
    }
    const result = migrate(db, {
      beforeMigrate: (from, to) => logger.info('migrating schema', { from, to }),
    });
    logger.info('schema ready', { from: result.from, to: result.to, applied: result.applied });
  }
  if (schemaVersion(db) > latestSchemaVersion()) {
    throw new Error('Database schema is newer than this build; upgrade Tidehaven.');
  }

  const requested = loadScenario(config.projectRoot, config.scenarioFile);
  let world = readWorld(db);
  const scenario = world ? resumeScenario(db, world, requested) : requested;
  if (!world) {
    const created = createTown({
      db,
      scenario,
      worldName: config.defaults.simulation.worldName,
      seed: `${config.defaults.simulation.seedPhrase}-${scenarioHash(scenario).slice(0, 8)}`,
      populationTarget: config.defaults.simulation.populationTarget,
      populationPolicyEnabled:
        config.populationPolicyOverride ??
        scenario.growth?.populationPolicyEnabled ??
        config.defaults.simulation.populationPolicyEnabled,
      hostCeiling: config.defaults.simulation.hostCeiling,
      drama: config.defaults.simulation.drama,
    });
    world = created.world;
    logger.info('town founded', {
      worldId: created.world.id,
      residents: created.state.residents.size,
      rulesVersion: created.state.rulesVersion,
    });
  }
  const state = loadState(db, world);
  if (!state.rulesVersion.startsWith(RULES_VERSION)) {
    logger.warn('world rules version differs from this build', {
      world: state.rulesVersion,
      build: RULES_VERSION,
    });
  }

  // --- decision source -----------------------------------------------------
  let source: DecisionSource;
  if (fixture) {
    source = new MockDecisionSource({ state, scenario, behaviour: 'drama' });
    logger.info('using fixture decision source (offline)');
  } else if (providerIssues.length > 0) {
    // A saved town with a broken provider configuration must stay inspectable: serve the dashboard in
    // a paused state instead of refusing to start or founding a town before validating the provider.
    source = new DisabledDecisionSource();
    logger.warn('provider not configured; serving an existing town in a paused state', {
      issues: providerIssues,
    });
  } else {
    const provider = requireProvider(config.provider);
    const client = new ModelClient({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      timeoutMs: config.defaults.model.requestTimeoutMs,
      maxResponseBytes: config.defaults.model.responseMaxBytes,
      logger,
    });
    const usage = new UsageTracker({
      db,
      worldId: world.id,
      ceilings: config.defaults.ceilings,
      logger,
    });
    source = new ModelDecisionSource({
      db,
      client,
      logger,
      usage,
      state,
      scenario,
      model: provider.model,
      capability: capabilityFromEnv(process.env.TIDEHAVEN_CAPABILITY) ?? 'json_object',
      maxDispatches: config.defaults.model.maxDispatchesPerJob,
      maxInputTokens: config.defaults.model.maxInputTokens,
      maxOutputTokens: config.defaults.model.maxOutputTokens,
      retryBaseDelayMs: config.defaults.model.retryBaseDelayMs,
      maxRetryDelayMs: config.defaults.model.maxRetryDelayMs,
    });
  }

  const sse = new SseHub({ maxClients: 20, retention: 200 });
  const runner = new Runner({
    config,
    logger,
    db,
    world,
    state,
    scenario,
    source,
    onSnapshot: () => sse.broadcast('state', { day: state.day }),
  });

  const running: Running = { config, logger, db, world, state, runner, source, lock, sse };

  const readStatus = async (): Promise<StatusSnapshot> => {
    const snapshot = runner.snapshot();
    const worldSummary = {
      id: world.id,
      name: world.name,
      seed: world.seed,
      day: state.day,
      phase: snapshot.phase,
      rulesVersion: state.rulesVersion,
      population: [...state.residents.values()].filter((r) => r.status === 'living').length,
      populationTarget: state.populationTarget,
      populationPolicyEnabled: state.populationPolicyEnabled,
      hostCeiling: state.hostCeiling,
      expectedBirths: [...state.pregnancies.values()].filter((p) => p.status === 'active').length,
      households: [...state.households.values()].filter((h) => h.dissolvedDay === null).length,
      businesses: [...state.businesses.values()].filter((b) => b.status === 'open').length,
      treasuryCents: state.accounts.get('treasury:0')?.balanceCents ?? 0,
      moneySupplyCents: [...state.accounts.values()].reduce((sum, a) => sum + a.balanceCents, 0),
      stateHash: world.stateHash,
    };
    return makeStatus(config, VERSION, {
      running: snapshot.running,
      world: worldSummary,
      pause: snapshot.paused
        ? { reason: snapshot.paused.reason, detail: snapshot.paused.detail, sinceDay: state.day, at: new Date().toISOString() }
        : readPauseFile(config),
      throughput: {
        startedAt: snapshot.startedAt,
        daysCommitted: snapshot.daysCommitted,
        daysPerHour: snapshot.daysPerHour,
        inFlightRequests: snapshot.inFlightRequests,
        queueDepth: snapshot.queueDepth,
        jobsPending: snapshot.jobsPending,
        fallbackRateBps: snapshot.fallbackRateBps,
        lastDayDurationMs: snapshot.lastDayDurationMs,
      },
      usage: snapshot.usage,
      invariants: {
        ok: snapshot.invariantsOk,
        checkedAtDay: state.day,
        detail: snapshot.invariantsDetail,
      },
      serverStartedAt: snapshot.startedAt,
    });
  };

  const server = await createServer({
    config,
    logger,
    version: VERSION,
    readStatus,
    registerExtraRoutes: async (app) => {
      registerRoutes(app, {
        db,
        worldId: world.id,
        logger,
        sse,
        runnerSnapshot: () => runner.snapshot(),
        requestPause: (reason) => runner.pause('operator', reason),
        requestResume: () => runner.resume(),
        version: VERSION,
        // `state` is the runner's published state: adoptState updates it in place after each commit.
        liveWorld: () => ({ state, scenario }),
      });
    },
  });

  await server.app.listen({ host: config.host, port: config.port });
  const address = `http://${config.host}:${config.port}`;
  process.stdout.write(`Tidehaven ${VERSION} — dashboard ${address}\n`);
  process.stdout.write(
    `  world #${world.id} "${world.name}", day ${state.day}, population ` +
      `${[...state.residents.values()].filter((r) => r.status === 'living').length}\n`,
  );
  process.stdout.write(`  provider: ${fixture ? 'fixture (offline)' : config.provider.model}\n`);
  logger.info('server listening', { address });

  // --- signals -------------------------------------------------------------
  const interruptGuard = createInterruptGuard();
  let shutdownPromise: Promise<void> | null = null;

  const handleInterrupt = (signal: string): void => {
    if (interruptGuard.interrupt(signal) === 'force') {
      logger.warn('second interrupt: forcing exit');
      process.exit(130);
    }
    if (shutdownPromise) return;
    shutdownPromise = (async () => {
      const result = await shutdown(
        {
          runner,
          sse,
          server,
          db,
          lock,
          logger,
          drainBudgetMs: config.defaults.runtime.drainBudgetMs,
        },
        signal,
      );
      logger.info('shutdown result', { ...result });
      // Exit explicitly: a lingering socket, timer, or child handle must not keep the process alive.
      process.exit(result.forced ? 1 : 0);
    })();
  };

  process.on('SIGINT', () => handleInterrupt('SIGINT'));
  process.on('SIGTERM', () => handleInterrupt('SIGTERM'));
  // Windows terminals deliver SIGBREAK for Ctrl+Break and sometimes on close.
  process.on('SIGBREAK', () => handleInterrupt('SIGBREAK'));
  process.on('uncaughtException', (err) => {
    logger.error('uncaught exception', { err });
    handleInterrupt('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { reason });
  });

  // --- run -----------------------------------------------------------------
  if (!fixture && providerIssues.length > 0) {
    runner.pause(
      'configuration',
      'Provider configuration is incomplete; the town is shown read-only until it is fixed and you restart.',
    );
  }

  await runner.run();
  // run() returns when the runner has been asked to stop; the signal handler owns the exit.
  if (!shutdownPromise) {
    logger.warn('runner loop finished; waiting for a signal to close the process');
  }
  void running;
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError) {
    process.stderr.write(`Configuration error: ${err.message}\n`);
    for (const issue of err.issues) process.stderr.write(`  - ${issue}\n`);
  } else {
    process.stderr.write(`Fatal: ${(err as Error).message}\n`);
    if (process.env.TIDEHAVEN_DEBUG === '1') process.stderr.write(`${(err as Error).stack ?? ''}\n`);
  }
  process.exitCode = 2;
});
