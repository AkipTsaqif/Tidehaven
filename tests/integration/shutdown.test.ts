import { describe, expect, it } from 'vitest';
import { createInterruptGuard, shutdown, type ShutdownDeps } from '../../src/runtime/shutdown.js';
import { silentLogger } from '../../src/runtime/telemetry.js';

function harness(overrides: Partial<ShutdownDeps> = {}): ShutdownDeps & { events: string[] } {
  const events: string[] = [];
  const deps: ShutdownDeps = {
    runner: {
      requestStop: () => events.push('requestStop'),
      shutdown: async () => {
        events.push('drain');
      },
    },
    sse: { closeAll: () => events.push('sse') },
    server: {
      close: async () => {
        events.push('server');
      },
    },
    db: { close: () => events.push('db') },
    lock: { release: () => events.push('lock') },
    logger: silentLogger(),
    drainBudgetMs: 1_000,
    ...overrides,
  };
  return Object.assign(deps, { events });
}

describe('graceful shutdown', () => {
  it('drains, closes the server, closes the database, and releases the lock in order', async () => {
    const deps = harness();
    const result = await shutdown(deps, 'SIGINT');
    expect(result.ok).toBe(true);
    expect(result.forced).toBe(false);
    expect(result.lockReleased).toBe(true);
    expect(result.dbClosed).toBe(true);
    expect(deps.events).toEqual(['requestStop', 'drain', 'sse', 'server', 'db', 'lock']);
  });

  it('continues to close resources when the drain exceeds the budget', async () => {
    const deps = harness({
      runner: {
        requestStop: () => undefined,
        shutdown: () => new Promise<void>(() => undefined),
      },
      drainBudgetMs: 100,
      onForced: (reason) => {
        expect(reason).toBe('drain-timeout');
      },
    });
    const result = await shutdown(deps, 'SIGINT');
    expect(result.ok).toBe(false);
    expect(result.forced).toBe(true);
    expect(result.dbClosed).toBe(true);
    expect(result.lockReleased).toBe(true);
  });

  it('releases the lock even when server close throws', async () => {
    const deps = harness({
      server: {
        close: async () => {
          throw new Error('socket stuck');
        },
      },
    });
    const result = await shutdown(deps, 'SIGTERM');
    expect(result.forced).toBe(true);
    expect(result.lockReleased).toBe(true);
    expect(result.dbClosed).toBe(true);
  });

  it('treats the second interrupt as a forced exit', () => {
    const guard = createInterruptGuard();
    expect(guard.interrupt('SIGINT')).toBe('graceful');
    expect(guard.interrupt('SIGINT')).toBe('force');
    expect(guard.interrupt('SIGTERM')).toBe('force');
  });
});
