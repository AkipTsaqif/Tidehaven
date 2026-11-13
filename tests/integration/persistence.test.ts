import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedTown } from '../fixtures/seed-town.js';
import { acquireLock, LockBusyError, lockPath, readLock } from '../../src/storage/lock.js';
import { openDatabase } from '../../src/storage/database.js';
import { latestSchemaVersion, migrate, needsMigration } from '../../src/storage/migrate.js';
import { schemaVersion } from '../../src/storage/database.js';
import { loadState, readWorld } from '../../src/storage/repositories.js';
import { stateHash } from '../../src/domain/hash.js';
import { findJob, listJobs, markTurnCommitted, markTurnReady, startTurn, upsertJob, getOpenTurn } from '../../src/storage/job-repo.js';
import { createBackup, verifyBackupFile } from '../../src/storage/backup.js';
import { writeCheckpoint, readCheckpoint } from '../../src/storage/checkpoints.js';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `tidehaven-${prefix}-`));
}

describe('single-writer lock', () => {
  it('rejects a second runner while the first holds the lock', () => {
    const dir = tempDir('lock');
    const first = acquireLock(dir, 'test');
    expect(existsSync(lockPath(dir))).toBe(true);
    expect(() => acquireLock(dir, 'test')).toThrow(LockBusyError);
    first.release();
    const second = acquireLock(dir, 'test');
    expect(second.info.pid).toBe(process.pid);
    second.release();
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes over a stale lock left by a dead process', () => {
    const dir = tempDir('stale');
    writeFileSync(
      lockPath(dir),
      JSON.stringify({ pid: 999_999, host: hostname(), startedAt: 'old', version: 'x' }),
    );
    const lock = acquireLock(dir, 'test');
    expect(readLock(dir)?.pid).toBe(process.pid);
    lock.release();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('migrations', () => {
  it('creates the schema once and is idempotent', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(0);
    const first = migrate(db);
    expect(first.applied.length).toBeGreaterThan(0);
    expect(schemaVersion(db)).toBe(latestSchemaVersion());
    expect(needsMigration(db)).toBe(false);
    const second = migrate(db);
    expect(second.applied).toEqual([]);
    db.close();
  });
});

describe('state round-trip', () => {
  it('reloads a committed day with an identical hash', async () => {
    const town = await seedTown({ seed: 'persist' });
    for (let day = 1; day <= 4; day += 1) await town.step();
    const world = readWorld(town.db, town.worldId)!;
    const reloaded = loadState(town.db, world);
    expect(reloaded.day).toBe(town.state.day);
    expect(stateHash(reloaded)).toBe(stateHash(town.state));
    expect(reloaded.residents.size).toBe(town.state.residents.size);
    expect([...reloaded.accounts.entries()].length).toBe([...town.state.accounts.entries()].length);
  }, 30_000);
});

describe('crash boundaries', () => {
  it('leaves the committed day intact when a turn never commits', async () => {
    const town = await seedTown({ seed: 'crash' });
    await town.step();
    const committedDay = town.state.day;
    const committedHash = stateHash(town.state);

    // Open a turn, mark it ready, then "crash" before saveState.
    const turnId = startTurn(town.db, {
      worldId: town.worldId,
      day: committedDay + 1,
      inputHash: 'hash',
      stateHashBefore: committedHash,
      prepared: {},
      schemaVersion: 3,
      rulesVersion: town.state.rulesVersion,
    });
    markTurnReady(town.db, turnId);

    const world = readWorld(town.db, town.worldId)!;
    expect(world.currentDay).toBe(committedDay);
    const reloaded = loadState(town.db, world);
    expect(stateHash(reloaded)).toBe(committedHash);
    const open = getOpenTurn(town.db, town.worldId);
    expect(open?.day).toBe(committedDay + 1);
    expect(open?.status).toBe('ready');

    markTurnCommitted(town.db, turnId, { stateHashAfter: committedHash, durationMs: 1, metrics: {} });
    expect(getOpenTurn(town.db, town.worldId)).toBeNull();
  }, 30_000);

  it('reuses accepted job results instead of re-requesting them', async () => {
    const town = await seedTown({ seed: 'jobs' });
    const actorId = [...town.state.residents.keys()][0]!;
    upsertJob(town.db, {
      worldId: town.worldId,
      day: 1,
      phase: 'collect',
      actorId,
      jobKind: 'plan',
      status: 'done',
      result: { actorId, plan: { primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: '' } },
    });
    const job = findJob(town.db, town.worldId, 1, actorId, 'plan');
    expect(job?.status).toBe('done');
    expect(job?.resultJson).toContain('"work"');
    expect(listJobs(town.db, town.worldId, 1).length).toBe(1);
  });
});

describe('storage durability', () => {
  it('writes a verified backup and a canonical checkpoint', async () => {
    const town = await seedTown({ seed: 'backup' });
    await town.step();
    const dataDir = tempDir('data');
    const result = await createBackup(town.db, dataDir, { keep: 2, label: 'test' });
    expect(result.bytes).toBeGreaterThan(0);
    const verified = await verifyBackupFile(result.path);
    expect(verified.ok).toBe(true);

    const checkpoint = writeCheckpoint(town.db, town.state, dataDir);
    const manifest = readCheckpoint(checkpoint.path);
    expect(manifest?.stateHash).toBe(checkpoint.hash);
    expect(manifest?.day).toBe(town.state.day);

    // A corrupt checkpoint is rejected rather than trusted.
    writeFileSync(checkpoint.path, JSON.stringify({ ...manifest, stateHash: 'deadbeef' }));
    expect(readCheckpoint(checkpoint.path)).toBeNull();
    rmSync(dataDir, { recursive: true, force: true });
  }, 30_000);
});

describe('turns', () => {
  it('persists turn lifecycle states', async () => {
    const town = await seedTown({ seed: 'turns' });
    const turnId = startTurn(town.db, {
      worldId: town.worldId,
      day: 1,
      inputHash: 'abc',
      stateHashBefore: 'zero',
      prepared: { note: 'x' },
      schemaVersion: 3,
      rulesVersion: town.state.rulesVersion,
    });
    expect(getOpenTurn(town.db, town.worldId)?.status).toBe('collecting');
    markTurnReady(town.db, turnId);
    expect(getOpenTurn(town.db, town.worldId)?.status).toBe('ready');
    markTurnCommitted(town.db, turnId, { stateHashAfter: 'hash', durationMs: 5, metrics: { population: 25 } });
    expect(getOpenTurn(town.db, town.worldId)).toBeNull();
    const row = town.db.get<{ phase: string; metrics_json: string }>(
      'select phase, metrics_json from turns where id = ?',
      [turnId],
    );
    expect(row?.phase).toBe('committed');
    expect(row?.metrics_json).toContain('population');
  });
});

describe('backup restoration', () => {
  it('restores a verified backup into a separate directory with matching state, history, and lineage', async () => {
    const town = await seedTown({ seed: 'restore' });
    for (let day = 1; day <= 6; day += 1) await town.step();
    const sourceDir = tempDir('restore-src');
    const targetDir = tempDir('restore-dst');
    const backup = await createBackup(town.db, sourceDir, { keep: 2, label: 'restore' });

    const restore = (await import('../../src/storage/backup.js')).restoreBackupTo(backup.path, targetDir);
    expect(restore.ok).toBe(true);

    const restored = openDatabase(join(targetDir, 'tidehaven.sqlite'), { readOnly: true });
    try {
      const world = readWorld(restored, town.worldId)!;
      const liveWorld = readWorld(town.db, town.worldId)!;
      expect(world.currentDay).toBe(liveWorld.currentDay);
      expect(world.stateHash).toBe(liveWorld.stateHash);

      const restoredState = loadState(restored, world);
      expect(stateHash(restoredState)).toBe(stateHash(town.state));

      // History and lineage survive: the same residents, events, and metrics are present.
      const restoredResidents = restored.get<{ n: number }>('select count(*) as n from residents where world_id = ?', [town.worldId])!.n;
      const liveResidents = town.db.get<{ n: number }>('select count(*) as n from residents where world_id = ?', [town.worldId])!.n;
      expect(restoredResidents).toBe(liveResidents);
      const restoredEvents = restored.get<{ n: number }>('select count(*) as n from events where world_id = ?', [town.worldId])!.n;
      const liveEvents = town.db.get<{ n: number }>('select count(*) as n from events where world_id = ?', [town.worldId])!.n;
      expect(restoredEvents).toBe(liveEvents);
      const restoredMetrics = restored.get<{ n: number }>('select count(*) as n from daily_metrics where world_id = ?', [town.worldId])!.n;
      expect(restoredMetrics).toBeGreaterThanOrEqual(6);
    } finally {
      restored.close();
      town.db.close();
      rmSync(sourceDir, { recursive: true, force: true });
      rmSync(targetDir, { recursive: true, force: true });
    }
  }, 120_000);
});
