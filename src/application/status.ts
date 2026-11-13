import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import { validateProvider } from '../config.js';
import type {
  PauseInfo,
  StatusSnapshot,
  StorageSnapshot,
  ThroughputSnapshot,
  UsageSnapshot,
  WorldSummary,
} from '../contracts/api.js';
import { databasePath } from './diagnostics.js';
import { dataTreeBytes } from './retention.js';
import type { WorldState } from '../domain/state.js';

export interface StatusSources {
  running: boolean;
  migrateRequired?: boolean;
  world?: WorldSummary | null;
  pause?: PauseInfo | null;
  throughput?: Partial<ThroughputSnapshot>;
  usage?: Partial<UsageSnapshot>;
  invariants?: { ok: boolean; checkedAtDay: number | null; detail: string | null };
  serverStartedAt?: string | null;
}

const EMPTY_THROUGHPUT: ThroughputSnapshot = {
  startedAt: null,
  daysCommitted: 0,
  daysPerHour: null,
  inFlightRequests: 0,
  queueDepth: 0,
  jobsPending: 0,
  fallbackRateBps: 0,
  lastDayDurationMs: null,
};

const EMPTY_USAGE: UsageSnapshot = {
  requestsToday: 0,
  tokensToday: 0,
  requestsThisMonth: 0,
  tokensThisMonth: 0,
  estimateOnly: false,
  ceilings: { dailyTokens: null, monthlyTokens: null, dailyRequests: null, monthlyRequests: null },
};

function dirBytes(path: string): number {
  try {
    if (!existsSync(path)) return 0;
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function countBackups(config: AppConfig): number {
  try {
    const dir = join(config.dataDir, 'backups');
    if (!existsSync(dir)) return 0;
    return readdirSync(dir).filter((name) => name.endsWith('.sqlite')).length;
  } catch {
    return 0;
  }
}

function archiveBytes(config: AppConfig): number {
  try {
    const dir = join(config.dataDir, 'archives');
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const name of readdirSync(dir)) total += dirBytes(join(dir, name));
    return total;
  } catch {
    return 0;
  }
}

function freeBytes(config: AppConfig): number | null {
  try {
    const stats = statfsSync(config.dataDir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

export function buildStorage(config: AppConfig): StorageSnapshot {
  const database = databasePath(config);
  return {
    databaseBytes:
      dirBytes(database) + dirBytes(`${database}-wal`) + dirBytes(`${database}-shm`),
    freeBytes: freeBytes(config),
    budgetBytes: config.defaults.storage.budgetBytes,
    minFreeBytes: config.defaults.storage.minFreeBytes,
    backups: countBackups(config),
    archiveBytes: archiveBytes(config),
    totalBytes: dataTreeBytes(config.dataDir),
    checkpointBytes: dirBytes(join(config.dataDir, 'checkpoints')),
    logBytes: dirBytes(join(config.dataDir, 'logs')),
  };
}

export function providerMode(config: AppConfig): 'fixture' | 'live' | 'unconfigured' {
  if (config.fixtureProvider) return 'fixture';
  return validateProvider(config.provider).length === 0 ? 'live' : 'unconfigured';
}

export function recoveryHint(_config: AppConfig, pause: PauseInfo | null): string | null {
  if (!pause) return null;
  switch (pause.reason) {
    case 'configuration':
      return 'Set TIDEHAVEN_API_BASE_URL, TIDEHAVEN_API_KEY, and TIDEHAVEN_MODEL in .env, then restart.';
    case 'authentication':
      return 'The provider rejected the API key (401/403). Fix TIDEHAVEN_API_KEY, then Resume.';
    case 'quota':
      return 'Provider quota or allowance exhausted. Top up or raise the configured ceilings, then Resume.';
    case 'provider_down':
      return 'Too many provider failures. Check the endpoint, then Resume.';
    case 'disk_pressure':
      return 'Free disk space or set TIDEHAVEN_DATA_DIR to another volume, then Resume.';
    case 'storage_budget':
      return 'The data budget is exhausted. Export/archive data or raise the budget explicitly, then Resume.';
    case 'engine_error':
      return 'The simulation hit an internal error and stopped before committing. See data/logs; the last committed day is safe.';
    case 'invariant_failure':
      return 'An accounting invariant failed. Inspect data/diagnostics/, restore a backup into a NEW data dir.';
    case 'population_ceiling':
      return 'The host safety ceiling was reached. Lower the population target or raise the ceiling.';
    case 'town_empty':
      return 'No residents remain and immigration is not permitted. Raise the target or adjust rules.';
    case 'migration_required':
      return 'The database needs a schema upgrade. Run npm run backup, then restart to migrate.';
    case 'shutdown':
      return 'Restart with npm start to resume.';
    case 'operator':
      return 'Paused from the dashboard. Press Resume to continue.';
    default:
      return null;
  }
}

export function makeStatus(config: AppConfig, version: string, sources: StatusSources): StatusSnapshot {
  const pause = sources.pause ?? null;
  const world = sources.world ?? null;
  return {
    version,
    townExists: world !== null,
    running: sources.running,
    migrateRequired: sources.migrateRequired ?? false,
    pause,
    world: world
      ? {
          ...world,
          populationPolicyEnabled: world.populationPolicyEnabled ?? true,
          hostCeiling: world.hostCeiling ?? 500,
        }
      : null,
    throughput: { ...EMPTY_THROUGHPUT, ...(sources.throughput ?? {}) },
    usage: {
      ...EMPTY_USAGE,
      ...(sources.usage ?? {}),
      ceilings: {
        dailyTokens: config.defaults.ceilings.dailyTokens,
        monthlyTokens: config.defaults.ceilings.monthlyTokens,
        dailyRequests: config.defaults.ceilings.dailyRequests,
        monthlyRequests: config.defaults.ceilings.monthlyRequests,
        ...(sources.usage?.ceilings ?? {}),
      },
    },
    storage: buildStorage(config),
    provider: {
      mode: providerMode(config),
      model: config.provider.model === '' ? null : config.provider.model,
      baseUrl: config.provider.baseUrl === '' ? null : config.provider.baseUrl,
    },
    invariants: sources.invariants ?? { ok: true, checkedAtDay: null, detail: null },
    server: {
      host: config.host,
      port: config.port,
      startedAt: sources.serverStartedAt ?? null,
    },
    recovery: recoveryHint(config, pause),
  };
}

/** Offline status: reads files only. Safe to run while the runner is active. */
export function offlineStatus(config: AppConfig, version: string): StatusSnapshot {
  const pause = readPauseFile(config);
  const world = readWorldSummary(config);
  return makeStatus(config, version, {
    running: false,
    world,
    pause,
    migrateRequired: world === null && existsSync(databasePath(config)),
  });
}

export function pauseFilePath(config: AppConfig): string {
  return join(config.dataDir, 'pause.json');
}

export function readPauseFile(config: AppConfig): PauseInfo | null {
  try {
    const raw = readFileText(pauseFilePath(config));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<PauseInfo>;
    if (typeof parsed.reason !== 'string') return null;
    return {
      reason: parsed.reason as PauseInfo['reason'],
      detail: typeof parsed.detail === 'string' ? parsed.detail : '',
      sinceDay: typeof parsed.sinceDay === 'number' ? parsed.sinceDay : null,
      at: typeof parsed.at === 'string' ? parsed.at : null,
    };
  } catch {
    return null;
  }
}

function readFileText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export interface PersistedWorld {
  id: number;
  name: string;
  seed: string;
  day: number;
  phase: string;
  rulesVersion: string;
}

/** Reads the tiny `world.json` mirror the runner keeps beside pause.json. */
export function readWorldSummary(config: AppConfig): WorldSummary | null {
  const raw = readFileText(join(config.dataDir, 'world.json'));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorldSummary>;
    if (typeof parsed.id !== 'number' || typeof parsed.day !== 'number') return null;
    return {
      id: parsed.id,
      name: parsed.name ?? 'Tidehaven',
      seed: parsed.seed ?? '',
      day: parsed.day,
      phase: parsed.phase ?? 'idle',
      rulesVersion: parsed.rulesVersion ?? 'unknown',
      population: parsed.population ?? 0,
      populationTarget: parsed.populationTarget ?? 0,
      populationPolicyEnabled: parsed.populationPolicyEnabled ?? true,
      hostCeiling: parsed.hostCeiling ?? 500,
      expectedBirths: parsed.expectedBirths ?? 0,
      households: parsed.households ?? 0,
      businesses: parsed.businesses ?? 0,
      treasuryCents: parsed.treasuryCents ?? 0,
      moneySupplyCents: parsed.moneySupplyCents ?? 0,
      stateHash: parsed.stateHash ?? null,
    };
  } catch {
    return null;
  }
}

export function writePauseFile(config: AppConfig, pause: PauseInfo | null): void {
  const path = pauseFilePath(config);
  try {
    if (pause === null) {
      if (existsSync(path)) unlinkSync(path);
      return;
    }
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(path, JSON.stringify(pause, null, 2));
  } catch {
    // Pause reporting is best-effort; the log and stdout carry the same information.
  }
}

/** Small world mirror so `npm run status` works offline while the runner is active. */
export function writeWorldMirror(config: AppConfig, state: WorldState, stateHash: string): void {
  const summary: WorldSummary = {
    id: state.worldId,
    name: state.name,
    seed: state.seed,
    day: state.day,
    phase: 'committed',
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
    stateHash,
  };
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(join(config.dataDir, 'world.json'), JSON.stringify(summary, null, 2));
  } catch {
    // best effort
  }
}
