import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * One writer per data directory.
 *
 * Mechanism: an exclusively created lock file (`wx`) whose handle stays open for the lifetime of the
 * runner. On Windows an open handle cannot be unlinked, so a *stale* lock (crash without cleanup) is
 * detectable by attempting the unlink exactly like a competitor would: it fails (EBUSY/EPERM) while a
 * live owner holds it and succeeds once the OS released the handle. A PID is recorded for diagnostics
 * only — liveness never depends on it, so PID reuse cannot revoke a live lock or honour a dead one.
 */

export interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
  version: string;
}

export interface AcquiredLock {
  readonly path: string;
  readonly info: LockInfo;
  release(): void;
  isHeld(): boolean;
}

export class LockBusyError extends Error {
  readonly holder: LockInfo | null;
  constructor(path: string, holder: LockInfo | null) {
    super(
      `Another Tidehaven runner already owns this data directory (lock ${path}` +
        (holder ? `, pid ${holder.pid} on ${holder.host}, started ${holder.startedAt}` : '') +
        ').',
    );
    this.name = 'LockBusyError';
    this.holder = holder;
  }
}

export function lockPath(dataDir: string): string {
  return join(dataDir, 'runner.lock');
}

function readLockInfo(path: string): LockInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockInfo>;
    if (typeof parsed.pid !== 'number') return null;
    return {
      pid: parsed.pid,
      host: typeof parsed.host === 'string' ? parsed.host : 'unknown',
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : 'unknown',
      version: typeof parsed.version === 'string' ? parsed.version : 'unknown',
    };
  } catch {
    return null;
  }
}

function tryCreate(path: string, info: LockInfo): number | null {
  try {
    const fd = openSync(path, 'wx');
    writeSync(fd, JSON.stringify(info));
    return fd;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return null;
    throw err;
  }
}

export function acquireLock(dataDir: string, version: string): AcquiredLock {
  mkdirSync(dataDir, { recursive: true });
  const path = lockPath(dataDir);
  const info: LockInfo = {
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
    version,
  };

  let fd = tryCreate(path, info);
  if (fd === null) {
    const holder = readLockInfo(path);
    // A live owner on this host is authoritative: never steal a lock from a running process. That
    // check is what makes the scheme safe on POSIX too, where an open file can be unlinked.
    if (holder !== null && holder.host === info.host && isProcessAlive(holder.pid)) {
      throw new LockBusyError(path, holder);
    }
    const removed = tryUnlinkStale(path);
    if (!removed) throw new LockBusyError(path, holder);
    fd = tryCreate(path, info);
    if (fd === null) throw new LockBusyError(path, readLockInfo(path));
  }

  const handle = fd;
  let held = true;

  return {
    path,
    info,
    isHeld: () => held,
    release: () => {
      if (!held) return;
      held = false;
      try {
        closeSync(handle);
      } catch {
        // Already closed by a crash path.
      }
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // Another process may have taken over after our handle closed; leave its file alone.
      }
    },
  };
}

/**
 * Returns true when the stale lock file was removed. A file that cannot be removed is owned by a live
 * process (open handle), which is exactly the signal we need on every supported platform.
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM means the process exists but belongs to someone else.
    return code === 'EPERM';
  }
}

function tryUnlinkStale(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function readLock(dataDir: string): LockInfo | null {
  return readLockInfo(lockPath(dataDir));
}
