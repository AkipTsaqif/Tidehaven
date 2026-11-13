import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { hashValue, stateSnapshot } from '../domain/hash.js';
import type { WorldState } from '../domain/state.js';
import type { Db } from './database.js';

/**
 * Periodic canonical checkpoints.
 *
 * A checkpoint is a compact JSON snapshot plus its hash, written under data/checkpoints/. It exists
 * to (a) anchor replay verification, (b) give operators a bounded point to diagnose from. The
 * normalized tables remain the authoritative state — a checkpoint never becomes a second copy that
 * could drift, and restore still goes through SQLite backups.
 */

export interface CheckpointManifest {
  worldId: number;
  day: number;
  rulesVersion: string;
  stateHash: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export function checkpointsDir(dataDir: string): string {
  return join(dataDir, 'checkpoints');
}

export interface CheckpointResult {
  path: string;
  bytes: number;
  hash: string;
  day: number;
}

export function writeCheckpoint(db: Db, state: WorldState, dataDir: string): CheckpointResult {
  const dir = checkpointsDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const snapshot = stateSnapshot(state);
  const hash = hashValue(snapshot);
  const manifest: CheckpointManifest = {
    worldId: state.worldId,
    day: state.day,
    rulesVersion: state.rulesVersion,
    stateHash: hash,
    createdAt: new Date().toISOString(),
    snapshot,
  };
  const path = join(dir, `world-${state.worldId}-day-${String(state.day).padStart(6, '0')}.json`);
  writeFileSync(path, JSON.stringify(manifest));
  db.run(
    'insert into checkpoints (world_id, day, path, hash, bytes, created_at) values (?, ?, ?, ?, ?, ?)',
    [state.worldId, state.day, path, hash, statSync(path).size, new Date().toISOString()],
  );
  return { path, bytes: statSync(path).size, hash, day: state.day };
}

export function readCheckpoint(path: string): CheckpointManifest | null {
  try {
    if (!existsSync(path)) return null;
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as CheckpointManifest;
    const recomputed = hashValue(manifest.snapshot);
    if (recomputed !== manifest.stateHash) return null;
    return manifest;
  } catch {
    return null;
  }
}

export function latestCheckpoint(db: Db, worldId: number): { path: string; day: number; hash: string } | null {
  const row = db.get<{ path: string; day: number; hash: string }>(
    'select path, day, hash from checkpoints where world_id = ? order by day desc limit 1',
    [worldId],
  );
  return row ?? null;
}
