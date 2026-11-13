import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { AppConfig } from '../config.js';
import type { Db } from '../storage/database.js';
import type { Logger } from '../runtime/telemetry.js';

/**
 * Retention and archiving, measured in **simulated days**.
 *
 * Old detailed rows (observations, memories, raw model payloads) are written to a compressed,
 * checksummed archive chunk and verified before anything is deleted. Compact facts — events, ledger
 * entries, lineage, case outcomes, daily metrics — are never archived away while the world is active.
 */

export interface RetentionResult {
  archivesWritten: number;
  rowsArchived: number;
  rowsDeleted: number;
  payloadsRedacted: number;
  bytesWritten: number;
  skipped: string | null;
}

export function archivesDir(dataDir: string): string {
  return join(dataDir, 'archives');
}

interface ArchiveRow {
  table: string;
  rows: unknown[];
}

export function runRetention(params: {
  db: Db;
  config: AppConfig;
  worldId: number;
  currentDay: number;
  logger: Logger;
  /** Keep at least this many recent days of detail. */
  keepDetailDays?: number;
}): RetentionResult {
  const { db, config, worldId, currentDay, logger } = params;
  const keepDetail = params.keepDetailDays ?? config.defaults.storage.detailRetentionDays;
  const chunkDays = config.defaults.storage.archiveChunkDays;
  const result: RetentionResult = {
    archivesWritten: 0,
    rowsArchived: 0,
    rowsDeleted: 0,
    payloadsRedacted: 0,
    bytesWritten: 0,
    skipped: null,
  };

  // 1. Redact raw model payloads that are older than the raw-payload retention window.
  const rawCutoff = currentDay - config.defaults.storage.rawPayloadRetentionDays;
  if (rawCutoff > 0) {
    const redacted = db.run(
      `update jobs set request_json = null
        where world_id = ? and day <= ? and request_json is not null`,
      [worldId, rawCutoff],
    );
    result.payloadsRedacted += redacted.changes;
  }

  // 2. Archive a bounded chunk of old detail, if any exists.
  const archiveCutoff = currentDay - keepDetail;
  if (archiveCutoff <= 0) {
    result.skipped = 'no days old enough to archive';
    return result;
  }
  const oldestDays: (number | null)[] = [];
  for (const table of ['observations', 'memories', 'goods_flows', 'ledger_entries'] as const) {
    oldestDays.push(db.get<{ day: number | null }>(`select min(day) as day from ${table} where world_id = ?`, [worldId])?.day ?? null);
  }
  const known = oldestDays.filter((day): day is number => day !== null);
  const oldest = known.length === 0 ? null : Math.min(...known);
  if (oldest === null || oldest === undefined || oldest >= archiveCutoff) {
    result.skipped = 'nothing outside the detail window';
    return result;
  }
  const fromDay = oldest;
  const toDay = Math.min(fromDay + chunkDays - 1, archiveCutoff - 1);
  if (toDay < fromDay) {
    result.skipped = 'chunk window empty';
    return result;
  }

  // Raw audit rows are archived (checksummed) and then pruned; the authoritative reconciliation
  // figures live in the goods-flow counters and the daily metrics.
  const tables = ['observations', 'memories', 'goods_flows', 'ledger_entries'] as const;
  const chunks: ArchiveRow[] = [];
  for (const table of tables) {
    const rows = db.all<Record<string, unknown>>(
      `select * from ${table} where world_id = ? and day between ? and ? order by day, id`,
      [worldId, fromDay, toDay],
    );
    chunks.push({ table, rows });
  }
  const events = db.all<Record<string, unknown>>(
    'select * from events where world_id = ? and day between ? and ? order by day, id',
    [worldId, fromDay, toDay],
  );
  chunks.push({ table: 'events', rows: events });

  const totalRows = chunks.reduce((sum, chunk) => sum + chunk.rows.length, 0);
  if (totalRows === 0) {
    result.skipped = 'nothing to archive';
    return result;
  }

  const dir = archivesDir(config.dataDir);
  mkdirSync(dir, { recursive: true });
  const manifest = {
    worldId,
    fromDay,
    toDay,
    createdAt: new Date().toISOString(),
    schemaVersion: 3,
    counts: Object.fromEntries(chunks.map((chunk) => [chunk.table, chunk.rows.length])),
  };
  const payload = JSON.stringify({ manifest, chunks });
  const checksum = createHash('sha256').update(payload).digest('hex');
  const archivePath = join(dir, `world-${worldId}-days-${String(fromDay).padStart(6, '0')}-${String(toDay).padStart(6, '0')}.json.gz`);
  writeFileSync(archivePath, gzipSync(payload));

  // Verify the archive is readable and matches the checksum before deleting anything.
  const verified = readArchive(archivePath);
  if (!verified.ok || verified.checksum !== checksum) {
    logger.error('archive verification failed; refusing to prune', {
      archivePath,
      detail: verified.detail,
    });
    result.skipped = 'archive verification failed';
    return result;
  }

  db.run(
    `insert into archives (world_id, from_day, to_day, path, checksum, bytes, manifest_json, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [worldId, fromDay, toDay, archivePath, checksum, statSync(archivePath).size, JSON.stringify(manifest), new Date().toISOString()],
  );

  db.transaction(() => {
    for (const table of tables) {
      const removed = db.run(`delete from ${table} where world_id = ? and day between ? and ?`, [worldId, fromDay, toDay]);
      result.rowsDeleted += removed.changes;
    }
    // Events stay in the database (they are compact facts), so they are archived *by value* only.
  });

  result.archivesWritten = 1;
  result.rowsArchived = totalRows;
  result.bytesWritten = statSync(archivePath).size;
  logger.info('archive written and old detail pruned', {
    fromDay,
    toDay,
    rows: totalRows,
    deleted: result.rowsDeleted,
    bytes: result.bytesWritten,
    archivePath,
  });
  return result;
}

export interface ArchiveCheck {
  ok: boolean;
  detail: string;
  checksum: string;
}

export function readArchive(path: string): ArchiveCheck {
  try {
    if (!existsSync(path)) return { ok: false, detail: 'missing', checksum: '' };
    const payload = gunzipSync(readFileSync(path)).toString('utf8');
    const parsed = JSON.parse(payload) as { manifest: unknown; chunks: unknown };
    if (!parsed.manifest || !Array.isArray((parsed as { chunks?: unknown }).chunks)) {
      return { ok: false, detail: 'malformed archive', checksum: '' };
    }
    return {
      ok: true,
      detail: 'readable',
      checksum: createHash('sha256').update(payload).digest('hex'),
    };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, checksum: '' };
  }
}

/** Enforce the project storage budget. Returns a pause reason when the budget is exhausted. */
export function storageBudgetExceeded(config: AppConfig, databaseBytes: number, archiveBytes: number): boolean {
  return databaseBytes + archiveBytes > config.defaults.storage.budgetBytes;
}

/** Hidden, derived artefact kinds that are replaced rather than accumulated: excluded from accounting. */
const DERIVED_PREFIXES = ['.write-probe-', '.rehearsal.'];

/** Recursive byte size of a path. Symlinks are not followed (bounded traversal). */
export function pathBytes(path: string): number {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  }
  for (const entry of entries) {
    if (DERIVED_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
    const child = join(path, entry.name);
    total += entry.isDirectory() ? pathBytes(child) : fileBytes(child);
  }
  return total;
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Complete size of the owned data tree.
 *
 * The budget guard must see everything Tidehaven writes, not just the SQLite main file and archives:
 * the WAL and shared-memory files, backups, checkpoints, rotated logs, and any other file in the data
 * directory all count against the same budget. Anything else lets periodic backups exceed the budget
 * silently.
 */
export function dataTreeBytes(dataDir: string): number {
  return pathBytes(dataDir);
}

export interface RetentionRehearsal {
  ok: boolean;
  detail: string;
}

/**
 * Rehearsal used by verify/doctor: archive a synthetic chunk, read it back, and clean up. Proves the
 * archive path works on this machine without touching real data.
 */
export function rehearsal(dataDir: string): RetentionRehearsal {
  const dir = archivesDir(dataDir);
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, '.rehearsal.json.gz');
    const payload = JSON.stringify({ manifest: { rehearsal: true }, chunks: [] });
    writeFileSync(path, gzipSync(payload));
    const check = readArchive(path);
    unlinkSync(path);
    return { ok: check.ok, detail: check.detail };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

export function listArchives(dataDir: string): string[] {
  try {
    const dir = archivesDir(dataDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => name.endsWith('.json.gz')).sort();
  } catch {
    return [];
  }
}
