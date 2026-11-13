import { backup } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, type Db } from './database.js';
import { schemaVersion } from './database.js';

/**
 * Consistent backups using SQLite's online backup API (WAL-safe), verified with integrity_check on
 * the copy. Never a raw file copy of a live database.
 */

export interface BackupResult {
  path: string;
  bytes: number;
  integrity: string;
  schemaVersion: number;
  rotatedOut: string[];
}

export function backupsDir(dataDir: string): string {
  return join(dataDir, 'backups');
}

function timestamp(date: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

export async function verifyBackupFile(path: string): Promise<{ ok: boolean; detail: string; schemaVersion: number }> {
  if (!existsSync(path)) return { ok: false, detail: 'backup file is missing', schemaVersion: 0 };
  let db: Db | null = null;
  try {
    db = openDatabase(path, { readOnly: true });
    const integrity = db.integrityCheck();
    return {
      ok: integrity === 'ok',
      detail: integrity,
      schemaVersion: schemaVersion(db),
    };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, schemaVersion: 0 };
  } finally {
    db?.close();
  }
}

export async function createBackup(
  db: Db,
  dataDir: string,
  options: { keep?: number; label?: string; now?: Date } = {},
): Promise<BackupResult> {
  const keep = options.keep ?? 3;
  const dir = backupsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const stamp = timestamp(options.now ?? new Date());
  const label = options.label ? `-${options.label.replace(/[^a-z0-9_-]/gi, '')}` : '';
  const finalPath = join(dir, `tidehaven-${stamp}${label}.sqlite`);
  const tempPath = `${finalPath}.partial`;

  await backup(db.raw, tempPath);
  const check = await verifyBackupFile(tempPath);
  if (!check.ok) {
    try {
      unlinkSync(tempPath);
    } catch {
      // leave the failed partial for inspection if it cannot be removed
    }
    throw new Error(`Backup verification failed: ${check.detail}`);
  }
  renameSync(tempPath, finalPath);

  const rotatedOut = rotate(dir, keep);
  return {
    path: finalPath,
    bytes: statSync(finalPath).size,
    integrity: check.detail,
    schemaVersion: check.schemaVersion,
    rotatedOut,
  };
}

function rotate(dir: string, keep: number): string[] {
  const files = readdirSync(dir)
    .filter((name) => /^tidehaven-\d{8}-\d{6}.*\.sqlite$/.test(name))
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  for (const file of files.slice(keep)) {
    try {
      unlinkSync(join(dir, file.name));
      removed.push(file.name);
    } catch {
      // best effort
    }
  }
  return removed;
}

/** Restore a backup into a *new* directory. Refuses to overwrite an existing database. */
export function restoreBackupTo(backupPath: string, targetDir: string): { ok: boolean; detail: string; target: string } {
  mkdirSync(targetDir, { recursive: true });
  const target = join(targetDir, 'tidehaven.sqlite');
  if (existsSync(target)) {
    return { ok: false, detail: 'target already has a database; refusing to overwrite', target };
  }
  copyFileSync(backupPath, target);
  return { ok: true, detail: 'restored; verify with `npm run status -- --data-dir` before use', target };
}
