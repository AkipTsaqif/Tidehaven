import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logger } from '../runtime/telemetry.js';
import { openDatabase } from '../storage/database.js';
import { migrate } from '../storage/migrate.js';
import { createBackup, restoreBackupTo, verifyBackupFile } from '../storage/backup.js';
import { databasePath } from './diagnostics.js';

/**
 * Operator commands that work without a running simulation (CLI entry points).
 * They never start the engine, never call a model, and never overwrite existing data.
 */

export interface CommandResult {
  ok: boolean;
  message: string;
}

export async function backupTown(config: AppConfig, logger: Logger): Promise<CommandResult> {
  const path = databasePath(config);
  if (!existsSync(path)) {
    return { ok: false, message: `No town database at ${path}; nothing to back up.` };
  }
  const db = openDatabase(path);
  try {
    migrate(db);
    const result = await createBackup(db, config.dataDir, { keep: config.defaults.storage.backups });
    logger.info('backup created', { bytes: result.bytes, backupsRotatedOut: result.rotatedOut.length });
    return {
      ok: true,
      message:
        `Backup written: ${result.path}\n` +
        `  size ${result.bytes} bytes, integrity ${result.integrity}, schema ${result.schemaVersion}` +
        (result.rotatedOut.length > 0 ? `\n  rotated out: ${result.rotatedOut.join(', ')}` : ''),
    };
  } catch (err) {
    logger.error('backup failed', { err });
    return { ok: false, message: `Backup failed: ${(err as Error).message}` };
  } finally {
    db.close();
  }
}

export async function verifyBackupCommand(backupPath: string): Promise<CommandResult> {
  const result = await verifyBackupFile(backupPath);
  return {
    ok: result.ok,
    message: `${backupPath}: ${result.ok ? 'ok' : 'FAILED'} (${result.detail}, schema ${result.schemaVersion})`,
  };
}

export function restoreCommand(backupPath: string, targetDataDir: string): CommandResult {
  const result = restoreBackupTo(backupPath, targetDataDir);
  return {
    ok: result.ok,
    message: result.ok
      ? `Restored to ${result.target}. Verify with: TIDEHAVEN_DATA_DIR=${targetDataDir} npm run status`
      : `${result.detail} (${result.target})`,
  };
}

export function backupDirFor(config: AppConfig): string {
  return join(config.dataDir, 'backups');
}
