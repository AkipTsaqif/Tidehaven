import type { Logger } from './telemetry.js';

/**
 * Bounded task pool.
 *
 * Concurrency is capped and the waiting queue is capped too: when the queue is full, submission fails
 * fast instead of growing memory without limit. Used for the day's model jobs so a large population
 * cannot spawn thousands of parallel requests.
 */

export class QueueFullError extends Error {
  constructor(capacity: number) {
    super(`Task queue is full (capacity ${capacity})`);
    this.name = 'QueueFullError';
  }
}

export interface PoolStats {
  limit: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
  capacity: number;
}

export class TaskPool {
  private readonly limit: number;
  private readonly capacity: number;
  private readonly logger: Logger;
  private active = 0;
  private completed = 0;
  private failed = 0;
  private readonly queue: { run: () => void; reject: (err: Error) => void }[] = [];
  private waiters: (() => void)[] = [];
  private stopped = false;

  constructor(params: { limit: number; capacity: number; logger: Logger }) {
    this.limit = Math.max(1, params.limit);
    this.capacity = Math.max(1, params.capacity);
    this.logger = params.logger;
  }

  stats(): PoolStats {
    return {
      limit: this.limit,
      active: this.active,
      queued: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      capacity: this.capacity,
    };
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.stopped) throw new Error('pool stopped');
    if (this.active < this.limit && this.queue.length === 0) {
      return this.execute(task);
    }
    if (this.queue.length >= this.capacity) {
      this.logger.warn('task queue full', { capacity: this.capacity, active: this.active });
      throw new QueueFullError(this.capacity);
    }
    return new Promise<T>((resolve, reject) => {
      const entry = {
        run: () => {
          if (signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }
          void this.execute(task).then(resolve, reject);
        },
        reject,
      };
      this.queue.push(entry);
    });
  }

  private async execute<T>(task: () => Promise<T>): Promise<T> {
    this.active += 1;
    try {
      const result = await task();
      this.completed += 1;
      return result;
    } catch (err) {
      this.failed += 1;
      throw err;
    } finally {
      this.active -= 1;
      this.pump();
    }
  }

  private pump(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) break;
      next.run();
    }
    if (this.active === 0 && this.queue.length === 0) {
      const waiters = this.waiters;
      this.waiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  async waitIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  async stop(reason: string): Promise<void> {
    this.stopped = true;
    this.logger.debug('pool stopping', { reason, queued: this.queue.length });
    for (const entry of this.queue.splice(0)) entry.reject(new Error(`pool stopped: ${reason}`));
    await this.waitIdle();
  }
}
