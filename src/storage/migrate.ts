import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaVersion, type Db } from './database.js';

/**
 * Numbered, immutable migrations. Applied in order, each inside its own transaction, recorded with a
 * checksum. A database created by a newer binary is refused rather than silently downgraded.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

function migrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export function listMigrations(dir = migrationsDir()): Migration[] {
  const files = readdirSync(dir)
    .filter((name) => /^\d{3}-.*\.sql$/.test(name))
    .sort();
  return files.map((file) => {
    const version = Number(file.slice(0, 3));
    const sql = readFileSync(join(dir, file), 'utf8');
    return {
      version,
      name: file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });
}

export interface MigrateResult {
  from: number;
  to: number;
  applied: string[];
}

export interface MigrateOptions {
  /** Called before the first apply; used to take a verified backup before any schema change. */
  beforeMigrate?: (fromVersion: number, toVersion: number) => void;
  dir?: string;
}

export function migrate(db: Db, options: MigrateOptions = {}): MigrateResult {
  const migrations = listMigrations(options.dir);
  if (migrations.length === 0) throw new MigrationError('No migration files found');
  const from = schemaVersion(db);

  // Integrity of already-applied migrations: applied files must still match their checksum.
  if (from > 0) {
    const applied = db.all<{ version: number; name: string; checksum: string }>(
      'select version, name, checksum from schema_migrations order by version',
    );
    for (const row of applied) {
      const known = migrations.find((m) => m.version === row.version);
      if (!known) {
        throw new MigrationError(`Applied migration ${row.version} (${row.name}) is missing from this build`);
      }
      if (known.checksum !== row.checksum) {
        throw new MigrationError(
          `Migration ${row.name} was modified after being applied (checksum mismatch). ` +
            'Add a new migration instead of editing an applied one.',
        );
      }
    }
  }

  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, applied: [] };

  const latestKnown = migrations[migrations.length - 1]?.version ?? 0;
  if (from > latestKnown) {
    throw new MigrationError(
      `Database schema version ${from} is newer than this build (${latestKnown}). Upgrade the application; ` +
        'refusing to run against a newer schema.',
    );
  }

  options.beforeMigrate?.(from, latestKnown);

  const applied: string[] = [];
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.run('insert into schema_migrations (version, name, checksum, applied_at) values (?, ?, ?, ?)', [
        migration.version,
        migration.name,
        migration.checksum,
        new Date().toISOString(),
      ]);
    });
    applied.push(migration.name);
  }

  const to = schemaVersion(db);
  if (to !== latestKnown) {
    throw new MigrationError(`Migration finished at version ${to}, expected ${latestKnown}`);
  }
  return { from, to, applied };
}

/** Latest schema version this build can create. */
export function latestSchemaVersion(): number {
  const migrations = listMigrations();
  return migrations[migrations.length - 1]?.version ?? 0;
}

/** True when the on-disk database needs an upgrade before use. */
export function needsMigration(db: Db): boolean {
  return schemaVersion(db) < latestSchemaVersion();
}
