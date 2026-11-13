import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { validateProvider } from '../config.js';

/** Offline diagnostics: no server, no model calls. */

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorReport {
  checks: Check[];
  ok: boolean;
  dataDir: string;
  databasePath: string;
  freeBytes: number | null;
}

export function databasePath(config: AppConfig): string {
  return join(config.dataDir, 'tidehaven.sqlite');
}

/**
 * Does this data directory hold a *saved town*?
 *
 * File existence is not enough: `doctor` and other tools can leave an empty database behind, and a
 * bare file must never be mistaken for a town. The record in `worlds` is the authoritative answer.
 */
export function savedWorldExists(config: AppConfig): boolean {
  const path = databasePath(config);
  if (!existsSync(path)) return false;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare('select count(*) as n from worlds').get() as { n?: number } | undefined;
    return Number(row?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** Legacy alias kept for callers that only care whether a database file is present. */
export function dataDirExists(config: AppConfig): boolean {
  return existsSync(databasePath(config));
}

async function freeBytesAt(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Verify that the data directory can actually be written to. */
function checkWritable(config: AppConfig): Check {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    const probe = join(config.dataDir, `.write-probe-${process.pid}`);
    writeFileSync(probe, 'ok');
    unlinkSync(probe);
    return { name: 'data-directory', status: 'ok', detail: `${config.dataDir} is writable` };
  } catch (err) {
    return {
      name: 'data-directory',
      status: 'fail',
      detail: `Cannot write to ${config.dataDir}: ${(err as Error).message}`,
    };
  }
}

/**
 * Confirm node:sqlite works here (module presence, WAL, foreign keys).
 *
 * Probes a throwaway database in temporary storage: `doctor` must not create the authoritative
 * database file, because a later start would then mistake it for an existing town.
 */
function checkSqlite(): Check {
  const path = join(tmpdir(), `tidehaven-doctor-${process.pid}-${Date.now()}.sqlite`);
  try {
    const db = new DatabaseSync(path);
    try {
      const row = db.prepare('select sqlite_version() as v').get() as { v?: string } | undefined;
      db.exec('pragma journal_mode = wal');
      db.exec('pragma foreign_keys = on');
      const fk = db.prepare('pragma foreign_keys').get() as { foreign_keys?: number } | undefined;
      return {
        name: 'sqlite',
        status: fk?.foreign_keys === 1 ? 'ok' : 'warn',
        detail: `SQLite ${row?.v ?? 'unknown'}; WAL requested; foreign_keys=${fk?.foreign_keys ?? 'unknown'}`,
      };
    } finally {
      db.close();
      try {
        unlinkSync(path);
      } catch {
        // temporary file; removal is best effort
      }
    }
  } catch (err) {
    return { name: 'sqlite', status: 'fail', detail: `SQLite unavailable: ${(err as Error).message}` };
  }
}

function checkBuild(config: AppConfig): Check {
  const serverEntry = join(config.projectRoot, 'dist', 'main.js');
  const clientEntry = join(config.projectRoot, 'dist', 'client', 'index.html');
  if (existsSync(serverEntry) && existsSync(clientEntry)) {
    return { name: 'build', status: 'ok', detail: 'dist/ present (server + dashboard)' };
  }
  const missing = [serverEntry, clientEntry].filter((p) => !existsSync(p));
  return {
    name: 'build',
    status: 'warn',
    detail: `Missing build output: ${missing.join(', ')}. Run: npm run build`,
  };
}

export async function doctor(config: AppConfig): Promise<DoctorReport> {
  const checks: Check[] = [];

  // Archive/restore rehearsal: proves the durability path works on this machine without real data.
  const { rehearsal } = await import('./retention.js');
  const rehearsalResult = rehearsal(config.dataDir);
  checks.push({
    name: 'archive-rehearsal',
    status: rehearsalResult.ok ? 'ok' : 'fail',
    detail: rehearsalResult.ok ? 'archive write/read/checksum works' : rehearsalResult.detail,
  });

  const providerIssues = validateProvider(config.provider);
  if (config.fixtureProvider) {
    checks.push({ name: 'provider', status: 'ok', detail: 'fixture provider (offline, no network)' });
  } else if (providerIssues.length === 0) {
    checks.push({
      name: 'provider',
      status: 'ok',
      detail: `configured: ${redactUrl(config.provider.baseUrl)} model=${config.provider.model}`,
    });
  } else {
    checks.push({
      name: 'provider',
      status: 'fail',
      detail: providerIssues.join('; '),
    });
  }

  checks.push(checkWritable(config));
  checks.push(checkSqlite());
  checks.push(checkBuild(config));

  const free = await freeBytesAt(config.dataDir);
  const minFree = config.defaults.storage.minFreeBytes;
  if (free === null) {
    checks.push({ name: 'free-space', status: 'warn', detail: 'Could not determine free space' });
  } else if (free < minFree) {
    checks.push({
      name: 'free-space',
      status: 'fail',
      detail: `${formatBytes(free)} free, below the ${formatBytes(minFree)} minimum`,
    });
  } else {
    checks.push({ name: 'free-space', status: 'ok', detail: `${formatBytes(free)} free` });
  }

  // The budget covers the whole owned tree (database + WAL + backups + checkpoints + logs + archives).
  const { dataTreeBytes } = await import('./retention.js');
  const usedBytes = dataTreeBytes(config.dataDir);
  checks.push({
    name: 'storage-budget',
    status: usedBytes > config.defaults.storage.budgetBytes ? 'fail' : 'ok',
    detail: `data directory ${formatBytes(usedBytes)} of ${formatBytes(config.defaults.storage.budgetBytes)} budget`,
  });

  checks.push({
    name: 'runtime-limits',
    status: 'ok',
    detail: `concurrency=${config.defaults.model.concurrency} timeout=${config.defaults.model.requestTimeoutMs}ms ` +
      `ceilings=${describeCeilings(config)}`,
  });

  return {
    checks,
    ok: checks.every((c) => c.status !== 'fail'),
    dataDir: config.dataDir,
    databasePath: databasePath(config),
    freeBytes: free,
  };
}

function describeCeilings(config: AppConfig): string {
  const c = config.defaults.ceilings;
  const parts = [
    `dailyTokens=${c.dailyTokens ?? 'none'}`,
    `monthlyTokens=${c.monthlyTokens ?? 'none'}`,
    `dailyRequests=${c.dailyRequests ?? 'none'}`,
  ];
  return parts.join(' ');
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[invalid]';
  }
}
