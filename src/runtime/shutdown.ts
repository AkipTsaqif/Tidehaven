import type { Logger } from './telemetry.js';
import type { Runner } from './runner.js';

/**
 * Graceful shutdown sequence.
 *
 * Extracted so it can be tested without a terminal: stop scheduling, drain in-flight requests with a
 * finite deadline, close the HTTP server and SSE clients, close the database, release the singleton
 * lock. A second interrupt is allowed to force exit — a stuck drain must not trap the operator.
 */

export interface ShutdownDeps {
  /** `cancelInFlight`/`markResourcesClosed` are optional so lightweight test doubles stay usable. */
  runner: Pick<Runner, 'requestStop' | 'shutdown'> &
    Partial<Pick<Runner, 'cancelInFlight' | 'markResourcesClosed'>>;
  sse: { closeAll(): void };
  server: { close(): Promise<void> };
  db: { close(): void };
  lock: { release(): void };
  logger: Logger;
  drainBudgetMs: number;
  /** Called when the drain exceeded the budget; the caller may still exit. */
  onForced?: (reason: string) => void;
}

export interface ShutdownResult {
  ok: boolean;
  forced: boolean;
  detail: string;
  lockReleased: boolean;
  dbClosed: boolean;
}

export async function shutdown(deps: ShutdownDeps, reason: string): Promise<ShutdownResult> {
  deps.logger.info('shutdown requested', { reason });
  let forced = false;
  let dbClosed = false;
  let lockReleased = false;

  deps.runner.requestStop('shutdown');
  // Cancel outstanding provider calls first: waiting for them to finish on their own can outlive the
  // drain budget and leave a live request holding resources we are about to close.
  deps.runner.cancelInFlight?.('shutdown');

  const cleanup = async (): Promise<void> => {
    await deps.runner.shutdown();
    deps.sse.closeAll();
    await deps.server.close();
  };

  let timeoutHandle: NodeJS.Timeout | undefined;
  const budget = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeout(() => resolve('timeout'), Math.max(500, deps.drainBudgetMs));
  });

  try {
    const outcome = await Promise.race([cleanup().then(() => 'done' as const), budget]);
    if (outcome === 'timeout') {
      forced = true;
      deps.logger.warn('shutdown drain exceeded the budget; continuing', { drainBudgetMs: deps.drainBudgetMs });
      deps.onForced?.('drain-timeout');
    }
  } catch (err) {
    forced = true;
    deps.logger.error('shutdown error', { err });
    deps.onForced?.('error');
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  // Fence any late result before the database handle disappears underneath it.
  deps.runner.markResourcesClosed?.();
  try {
    deps.db.close();
    dbClosed = true;
  } catch (err) {
    deps.logger.warn('database close failed', { err });
  }
  try {
    deps.lock.release();
    lockReleased = true;
  } catch (err) {
    deps.logger.warn('lock release failed', { err });
  }

  deps.logger.info('shutdown complete', { forced, dbClosed, lockReleased });
  return {
    ok: !forced,
    forced,
    detail: forced ? 'drain budget exceeded or error; forced close' : 'drained, closed, lock released',
    lockReleased,
    dbClosed,
  };
}

/** Track repeated interrupts: the second one is allowed to force an immediate exit. */
export function createInterruptGuard(): { interrupt(reason: string): 'graceful' | 'force' } {
  let seen = 0;
  return {
    interrupt(): 'graceful' | 'force' {
      seen += 1;
      return seen === 1 ? 'graceful' : 'force';
    },
  };
}
