/**
 * Deterministic crash-point injection for resilience tests.
 *
 * Set `TIDEHAVEN_CRASH_AT` to a named point (comma-separated for several) to make the process die
 * exactly there, as if power was lost. Used by tests/fixtures/crash-points.ts and the integration
 * suite; inert in normal operation.
 */

export type CrashMode = 'exit' | 'throw';

const configured = (process.env.TIDEHAVEN_CRASH_AT ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '');

const enabled = new Set(configured);
const throwMode = process.env.TIDEHAVEN_CRASH_MODE !== 'exit';

export class InjectedCrash extends Error {
  readonly point: string;
  constructor(point: string) {
    super(`Injected crash at ${point}`);
    this.name = 'InjectedCrash';
    this.point = point;
  }
}

/** True when tests asked us to die at this point. */
export function crashEnabled(point: string): boolean {
  return enabled.has(point);
}

/**
 * Optionally crash. In 'throw' mode (default) the caller can catch and assert; in 'exit' mode the
 * process terminates without cleanup so on-disk state is exactly as a real crash would leave it.
 */
export function crashPoint(point: string, mode: CrashMode = throwMode ? 'throw' : 'exit'): void {
  if (!enabled.has(point)) return;
  if (mode === 'exit') {
    // Deliberately skip graceful shutdown: simulate a hard kill.
    process.stderr.write(`[crash-point] exiting at ${point}\n`);
    process.exit(137);
  }
  throw new InjectedCrash(point);
}
