#!/usr/bin/env node
import { loadConfig, ConfigError, type AppConfig } from './config.js';
import { assertNoLegacyTown } from './application/legacy-data.js';

/** Every CLI command reads the same per-scenario folder, and refuses an unmoved legacy town. */
function loadTownConfig(options: { allowProbe?: boolean } = {}): AppConfig {
  const config = loadConfig(options);
  assertNoLegacyTown(config);
  return config;
}
import { doctor, formatBytes } from './application/diagnostics.js';
import { offlineStatus } from './application/status.js';
import type { StatusSnapshot } from './contracts/api.js';
import { createLogger, type Logger } from './runtime/telemetry.js';
import { join } from 'node:path';
import { VERSION } from './version.js';
import { existsSync } from 'node:fs';
import { databasePath } from './application/diagnostics.js';
import { openDatabase, type Db } from './storage/database.js';

/**
 * Open the existing town database for a *write* only when it already holds a saved world.
 *
 * `doctor --probe` must never create an authoritative database or migrate one just to record a
 * provider profile, so this returns null for a fresh or world-less directory.
 */
function openExistingTownDatabase(config: AppConfig): Db | null {
  try {
    if (!existsSync(databasePath(config))) return null;
    const probe = openDatabase(databasePath(config), { readOnly: true });
    let hasWorld = false;
    try {
      hasWorld = probe.get<{ n: number }>('select count(*) as n from worlds')?.n !== undefined &&
        Number(probe.get<{ n: number }>('select count(*) as n from worlds')?.n ?? 0) > 0;
    } catch {
      hasWorld = false;
    } finally {
      probe.close();
    }
    if (!hasWorld) return null;
    return openDatabase(databasePath(config));
  } catch {
    return null;
  }
}


/**
 * Offline CLI entry point: status, doctor, backup, soak.
 * None of these commands start the simulation or make unrequested provider calls.
 */

interface CliIO {
  out(line: string): void;
  err(line: string): void;
}

const defaultIO: CliIO = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function makeLoggerFor(config: AppConfig, quiet: boolean): Logger {
  return createLogger({
    level: quiet ? 'warn' : config.defaults.runtime.logLevel,
    logDir: join(config.dataDir, 'logs'),
    keepFiles: config.defaults.storage.logFiles,
    console: false,
  });
}

export function formatStatus(status: StatusSnapshot): string {
  const lines: string[] = [];
  const world = status.world;
  lines.push(`Tidehaven ${status.version}`);
  lines.push(`data: ${status.storage.databaseBytes > 0 ? 'town present' : 'no town yet'}`);
  if (world) {
    lines.push(
      `world: #${world.id} "${world.name}" day ${world.day} (${world.phase}) rules ${world.rulesVersion}`,
    );
    lines.push(
      `population: ${world.population} (target ${world.populationPolicyEnabled === false ? 'no target' : world.populationTarget}, ` +
        `ceiling ${world.hostCeiling}, expected births ${world.expectedBirths}) ` +
        `households ${world.households} businesses ${world.businesses}`,
    );
    lines.push(`treasury: ${(world.treasuryCents / 100).toFixed(2)} · money supply ${(world.moneySupplyCents / 100).toFixed(2)}`);
    lines.push(`state hash: ${world.stateHash ?? 'none yet'}`);
  } else {
    lines.push('world: none (run `npm start` to found the town)');
  }
  lines.push(`running: ${status.running ? 'yes' : 'no'}`);
  if (status.pause) {
    lines.push(`paused: ${status.pause.reason} — ${status.pause.detail}`);
    if (status.recovery) lines.push(`recovery: ${status.recovery}`);
  }
  if (status.migrateRequired) lines.push('note: the database needs a schema upgrade; restart to migrate');
  lines.push(
    `throughput: ${status.throughput.daysPerHour === null ? 'n/a' : `${status.throughput.daysPerHour} days/hour`} ` +
      `in-flight ${status.throughput.inFlightRequests} queue ${status.throughput.queueDepth} ` +
      `fallbacks ${(status.throughput.fallbackRateBps / 100).toFixed(1)}%`,
  );
  lines.push(
    `usage: ${status.usage.requestsToday} requests / ${status.usage.tokensToday} tokens today; ` +
      `ceilings dailyTokens=${status.usage.ceilings.dailyTokens ?? 'none'}`,
  );
  lines.push(
    `storage: database ${formatBytes(status.storage.databaseBytes)} · archives ${formatBytes(status.storage.archiveBytes)} ` +
      `· free ${formatBytes(status.storage.freeBytes)} · backups ${status.storage.backups}`,
  );
  lines.push(`provider: ${status.provider.mode}${status.provider.model ? ` (${status.provider.model})` : ''}`);
  lines.push(`invariants: ${status.invariants.ok ? 'ok' : 'FAILED'}${status.invariants.detail ? ` — ${status.invariants.detail}` : ''}`);
  return lines.join('\n');
}

async function cmdStatus(args: string[], io: CliIO): Promise<number> {
  const config = loadTownConfig();
  const status = offlineStatus(config, VERSION);
  if (hasFlag(args, '--json')) {
    io.out(JSON.stringify(status, null, 2));
  } else {
    io.out(formatStatus(status));
  }
  return 0;
}

async function cmdDoctor(args: string[], io: CliIO): Promise<number> {
  const probe = hasFlag(args, '--probe');
  const config = loadTownConfig({ allowProbe: probe });
  const report = await doctor(config);
  if (hasFlag(args, '--json')) {
    io.out(JSON.stringify(report, null, 2));
  } else {
    io.out(`Tidehaven ${VERSION} doctor`);
    for (const check of report.checks) {
      const mark = check.status === 'ok' ? 'ok  ' : check.status === 'warn' ? 'warn' : 'FAIL';
      io.out(`  [${mark}] ${check.name}: ${check.detail}`);
    }
    io.out(`  data directory: ${report.dataDir}`);
    io.out(`  database: ${report.databasePath}`);
    if (!report.ok) io.out('Result: FAIL — fix the items above before starting the town.');
    else io.out('Result: ok');
  }

  if (probe) {
    if (config.fixtureProvider) {
      io.out('Probe skipped: running against the fixture provider.');
    } else {
      const { probeProvider } = await import('./model/probe.js');
      const db = openExistingTownDatabase(config);
      try {
        const result = await probeProvider(config, makeLoggerFor(config, false), db ? { db } : {});
        io.out(`Probe: ${result.ok ? 'ok' : 'FAILED'} — ${result.detail}`);
        if (result.ok) {
          io.out(
            `  capability: ${result.capability ?? 'unknown'} (${result.requests ?? 1} probe request(s)` +
              `${result.persisted ? ', profile saved' : ', profile not saved'})`,
          );
        }
        if (!result.ok) return 2;
      } finally {
        db?.close();
      }
    }
  }
  return report.ok ? 0 : 2;
}

export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command = 'help', ...args] = argv;
  switch (command) {
    case 'status':
      return cmdStatus(args, io);
    case 'doctor':
      return cmdDoctor(args, io);
    case 'backup': {
      const config = loadTownConfig();
      const { backupTown } = await import('./application/commands.js');
      const result = await backupTown(config, makeLoggerFor(config, false));
      io.out(result.message);
      return result.ok ? 0 : 2;
    }
    case 'soak': {
      const config = loadTownConfig();
      const { runSoak } = await import('./application/soak.js');
      const result = await runSoak(config, args, io.out);
      return result ? 0 : 2;
    }
    case 'probe': {
      const config = loadTownConfig({ allowProbe: true });
      const { probeProvider } = await import('./model/probe.js');
      const db = openExistingTownDatabase(config);
      try {
        const result = await probeProvider(config, makeLoggerFor(config, false), db ? { db } : {});
        io.out(`Probe: ${result.ok ? 'ok' : 'FAILED'} — ${result.detail}`);
        if (result.ok) {
          io.out(
            `  capability: ${result.capability ?? 'unknown'} (${result.requests ?? 1} probe request(s)` +
              `${result.persisted ? ', profile saved' : ', profile not saved'})`,
          );
        }
        return result.ok ? 0 : 2;
      } finally {
        db?.close();
      }
    }
    case 'version':
      io.out(VERSION);
      return 0;
    case 'help':
    case '--help':
    case '-h':
      io.out(
        [
          'Tidehaven CLI',
          '',
          '  npm start              run (or resume) the town and dashboard',
          '  npm run status         offline status of the saved town',
          '  npm run doctor         offline diagnostics (--probe, or -- --probe, for one paid call)',
          '  npm run backup         consistent database backup',
          '  npm run test:soak      long-run invariant soak (mock provider)',
        ].join('\n'),
      );
      return 0;
    default:
      io.err(`Unknown command: ${command}`);
      io.err('Try: status | doctor | backup | soak | version | help');
      return 2;
  }
}

const isMain = (() => {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('cli.js') || entry.endsWith('cli.ts');
})();

if (isMain) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      if (err instanceof ConfigError) {
        process.stderr.write(`Configuration error: ${err.message}\n`);
        for (const issue of err.issues) process.stderr.write(`  - ${issue}\n`);
      } else {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
      }
      process.exitCode = 2;
    });
}
