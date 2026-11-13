import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Thin, defensive wrapper over node:sqlite.
 *
 * - WAL, foreign keys, a busy timeout, defensive mode, and durable (FULL) synchronous commits.
 * - Statements are cached per SQL string; all values are bound, never interpolated.
 * - Transactions are explicit and nestable; nested calls reuse the outer transaction.
 * - Every transaction is short by contract: no network await is allowed inside one.
 */

export type BindValue = string | number | bigint | null;
export type Params = BindValue[];

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  exec(sql: string): void;
  get<T>(sql: string, params?: Params): T | undefined;
  all<T>(sql: string, params?: Params): T[];
  run(sql: string, params?: Params): RunResult;
  transaction<T>(fn: () => T): T;
  inTransaction(): boolean;
  integrityCheck(): string;
  close(): void;
}

export interface OpenOptions {
  readOnly?: boolean;
  /** Skip WAL/durable pragmas for throwaway in-memory databases in tests. */
  memory?: boolean;
}

export function openDatabase(path: string, options: OpenOptions = {}): Db {
  if (path !== ':memory:' && !options.readOnly) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const raw = new DatabaseSync(path, {
    readOnly: options.readOnly === true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    defensive: true,
    timeout: 5000,
  });

  if (path !== ':memory:' && options.readOnly !== true) {
    raw.exec('pragma journal_mode = wal');
    raw.exec('pragma synchronous = full');
    raw.exec('pragma busy_timeout = 5000');
    raw.exec('pragma foreign_keys = on');
    raw.exec('pragma wal_autocheckpoint = 1000');
    raw.exec('pragma temp_store = memory');
  } else if (path !== ':memory:') {
    // Read-only connections keep the connection-level pragmas only.
    raw.exec('pragma busy_timeout = 5000');
    raw.exec('pragma foreign_keys = on');
  }

  const cache = new Map<string, StatementSync>();
  let depth = 0;

  function statement(sql: string): StatementSync {
    const cached = cache.get(sql);
    if (cached) return cached;
    const prepared = raw.prepare(sql);
    cache.set(sql, prepared);
    return prepared;
  }

  const db: Db = {
    raw,
    path,
    exec(sql) {
      raw.exec(sql);
    },
    get<T>(sql: string, params: Params = []): T | undefined {
      const row = statement(sql).get(...params);
      return row as T | undefined;
    },
    all<T>(sql: string, params: Params = []): T[] {
      return statement(sql).all(...params) as T[];
    },
    run(sql, params = []): RunResult {
      const result = statement(sql).run(...params);
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid),
      };
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      raw.exec('begin immediate');
      depth += 1;
      try {
        const result = fn();
        raw.exec('commit');
        return result;
      } catch (err) {
        try {
          raw.exec('rollback');
        } catch {
          // A failed rollback leaves the connection unusable; surface the original error.
        }
        throw err;
      } finally {
        depth -= 1;
      }
    },
    inTransaction: () => depth > 0,
    integrityCheck(): string {
      const row = db.get<{ integrity_check?: string }>('pragma integrity_check');
      return row?.integrity_check ?? 'unknown';
    },
    close() {
      cache.clear();
      raw.close();
    },
  };

  return db;
}

/** Current schema version, or 0 when the database has no migration table yet. */
export function schemaVersion(db: Db): number {
  try {
    const row = db.get<{ v: number | null }>('select max(version) as v from schema_migrations');
    return Number(row?.v ?? 0);
  } catch {
    return 0;
  }
}
