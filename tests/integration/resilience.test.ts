import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/database.js';

/**
 * Process-level resilience: start the real server with the offline fixture provider, kill it hard,
 * restart it on the same data directory, and verify the town resumed instead of restarting or
 * duplicating a day. Also verifies the single-writer lock against a real second process.
 *
 * The build gate (`npm run verify`) builds before running these tests; a source-only checkout without
 * `dist/` still builds here so `npm test` alone cannot wait on a server that cannot start.
 */

interface StatusBody {
  world: { day: number; moneySupplyCents: number; population: number } | null;
  running: boolean;
  pause: { reason: string } | null;
}

const children: ChildProcess[] = [];
let dir: string | null = null;
let port = 4580;

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.pid && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }
  if (dir) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may still hold a log handle briefly
    }
    dir = null;
  }
});

function startServer(dataDir: string, listenPort: number, extraEnv: Record<string, string> = {}): ChildProcess {
  const child = spawn(process.execPath, ['dist/main.js', 'start'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TIDEHAVEN_FIXTURE: '1',
      TIDEHAVEN_DATA_DIR: dataDir,
      TIDEHAVEN_PORT: String(listenPort),
      TIDEHAVEN_LOG_LEVEL: 'warn',
      TIDEHAVEN_MIN_FREE_MB: '10',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  if (process.env.TIDEHAVEN_TEST_VERBOSE === '1') {
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[child ${child.pid}] ${chunk.toString()}`));
  }
  return child;
}

async function waitForDay(listenPort: number, minimum: number, timeoutMs = 30_000): Promise<StatusBody> {
  const deadline = Date.now() + timeoutMs;
  let last: StatusBody | null = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${listenPort}/api/status`);
      if (response.ok) {
        last = (await response.json()) as StatusBody;
        if ((last.world?.day ?? 0) >= minimum) return last;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for day ${minimum}; last status ${JSON.stringify(last)}`);
}

/** Kill a child and wait until it has actually exited, so no runner survives into the next step. */
async function killHardAndWait(child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' });
  } else {
    process.kill(child.pid, 'SIGKILL');
  }
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

async function waitForExit(child: ChildProcess, timeoutMs = 60_000): Promise<number | null> {
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
    setTimeout(() => resolve(null), timeoutMs);
  });
}

describe('process resilience', () => {
  it('resumes the same town after a hard kill without duplicating a day', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tidehaven-resilience-'));
    port += 1;
    const first = startServer(dir, port);
    const before = await waitForDay(port, 2);
    expect(before.running).toBe(true);
    expect(before.pause).toBeNull();
    const dayBefore = before.world!.day;
    const moneyBefore = before.world!.moneySupplyCents;

    await killHardAndWait(first);
    await new Promise((resolve) => setTimeout(resolve, 500));

    port += 1;
    startServer(dir, port);
    const after = await waitForDay(port, dayBefore + 1);
    expect(after.world!.day).toBeGreaterThanOrEqual(dayBefore + 1);
    expect(after.world!.moneySupplyCents).toBe(moneyBefore);
    expect(after.pause).toBeNull();

    // Each simulated day appears exactly once in the turn ledger.
    const db = openDatabase(join(dir, 'tidehaven.sqlite'), { readOnly: true });
    const duplicates = db.all<{ day: number; n: number }>(
      'select day, count(*) as n from turns group by day having count(*) > 1',
    );
    expect(duplicates).toEqual([]);
    const committed = db.all<{ day: number }>("select day from turns where phase = 'committed' order by day");
    expect(committed.length).toBeGreaterThanOrEqual(dayBefore);
    db.close();
    expect(existsSync(join(dir, 'tidehaven.sqlite'))).toBe(true);
  }, 120_000);

  it('refuses a second runner on the same data directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'tidehaven-lock-'));
    port += 1;
    const first = startServer(dir, port);
    await waitForDay(port, 1);

    // A second process must exit with a clear error and not touch the data.
    const second = spawn(process.execPath, ['dist/main.js', 'start'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TIDEHAVEN_FIXTURE: '1',
        TIDEHAVEN_DATA_DIR: dir,
        TIDEHAVEN_PORT: String(port + 100),
        TIDEHAVEN_LOG_LEVEL: 'warn',
        TIDEHAVEN_MIN_FREE_MB: '10',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(second);
    const exitCode = await waitForExit(second, 20_000);
    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(first.killed).toBe(false);
    await killHardAndWait(first);
  }, 120_000);

  it('leaves the world and its turn lifecycle coherent across every crash boundary', async () => {
    // Each boundary gets its own fresh data directory: the point is the boundary's own atomicity, not
    // the accumulation of stale turns from a previous kill.
    for (const boundary of ['after_collection', 'turn_ready', 'before_commit', 'after_commit']) {
      dir = mkdtempSync(join(tmpdir(), `tidehaven-crash-${boundary}-`));
      port += 1;
      const crashPort = port;

      const child = startServer(dir, crashPort, { TIDEHAVEN_CRASH_AT: boundary, TIDEHAVEN_CRASH_MODE: 'exit' });
      const code = await waitForExit(child, 60_000);
      expect(code, `crash at ${boundary} should terminate the process`).not.toBeNull();
      await killHardAndWait(child);

      const afterCrash = openDatabase(join(dir, 'tidehaven.sqlite'), { readOnly: true });
      const worldAfterCrash = afterCrash.get<{ current_day: number }>('select current_day from worlds order by id limit 1');
      const duplicatesAfterCrash = afterCrash.all<{ day: number; n: number }>(
        'select day, count(*) as n from turns group by day having count(*) > 1',
      );
      expect(duplicatesAfterCrash, `duplicate turns after crash at ${boundary}`).toEqual([]);
      afterCrash.close();

      // Restart without the crash point: reconciliation closes any stale turn and the town advances.
      const resumePort = ++port;
      startServer(dir, resumePort);
      const resumed = await waitForDay(resumePort, (worldAfterCrash?.current_day ?? 0) + 1);
      expect(resumed.pause).toBeNull();

      const check = openDatabase(join(dir, 'tidehaven.sqlite'), { readOnly: true });
      const world = check.get<{ current_day: number }>('select current_day from worlds order by id limit 1');
      const openTurns = check.all<{ day: number; phase: string }>(
        `select day, phase from turns where phase != 'committed' and day <= ?`,
        [world?.current_day ?? 0],
      );
      expect(openTurns, `boundary ${boundary}: world day ${world?.current_day}`).toEqual([]);
      const dupes = check.all<{ day: number; n: number }>(
        'select day, count(*) as n from turns group by day having count(*) > 1',
      );
      expect(dupes).toEqual([]);
      check.close();

      await killHardAndWait(children[children.length - 1]!);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }, 240_000);
});
