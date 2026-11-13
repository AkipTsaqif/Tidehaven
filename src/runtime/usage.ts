import type { Db } from '../storage/database.js';
import type { Logger } from './telemetry.js';

/**
 * Usage accounting and spending ceilings.
 *
 * A reservation is persisted *before* dispatch and settled afterwards:
 *
 *   reserve()  -> durable row with the estimated input + maximum output, checked against the ceilings
 *   settle()   -> reads back the provider's reported usage (or a conservative estimate) and closes
 *                 the reservation in the same transaction
 *
 * Because the reservation is durable, a crash after a billable dispatch but before the response is
 * retained as spending rather than forgotten, and concurrent callers cannot both pass the same
 * remaining allowance (the check and the insert are one transaction, so reservations are serialised).
 *
 * A null ceiling means "the operator chose maximum throughput", not "no safety bounds": concurrency,
 * timeouts, retries, bytes, population, and storage remain capped independently.
 */

export interface Ceilings {
  dailyTokens: number | null;
  monthlyTokens: number | null;
  dailyRequests: number | null;
  monthlyRequests: number | null;
  monthlyResetDayOfMonth: number;
  monthlyResetUtcHour: number;
}

export interface UsageSnapshot {
  dayKey: string;
  monthKey: string;
  requestsToday: number;
  tokensToday: number;
  requestsThisMonth: number;
  tokensThisMonth: number;
  estimateOnly: boolean;
}

export class BudgetExceeded extends Error {
  readonly scope: 'daily' | 'monthly';
  readonly metric: 'tokens' | 'requests';
  constructor(scope: 'daily' | 'monthly', metric: 'tokens' | 'requests') {
    super(`Configured ${scope} ${metric} ceiling reached`);
    this.name = 'BudgetExceeded';
    this.scope = scope;
    this.metric = metric;
  }
}

interface PeriodUse {
  requests: number;
  tokens: number;
  estimateOnly: boolean;
}

export class UsageTracker {
  private readonly db: Db;
  private readonly worldId: number;
  private readonly ceilings: Ceilings;
  private readonly logger: Logger;

  private readonly now: () => Date;
  private cache: UsageSnapshot;

  constructor(params: {
    db: Db;
    worldId: number;
    ceilings: Ceilings;
    logger: Logger;
    now?: () => Date;
  }) {
    this.db = params.db;
    this.worldId = params.worldId;
    this.ceilings = params.ceilings;
    this.logger = params.logger;
    this.now = params.now ?? (() => new Date());
    this.reconcileOrphanedReservations();
    this.cache = this.read();
  }

  private keys(): { dayKey: string; monthKey: string } {
    const now = this.now();
    const dayKey = `day:${now.toISOString().slice(0, 10)}`;
    const monthKey = `month:${now.toISOString().slice(0, 7)}`;
    return { dayKey, monthKey };
  }

  private recorded(key: string): PeriodUse {
    const row = this.db.get<{ requests: number; tokens: number; estimate_only: number }>(
      'select requests, tokens, estimate_only from usage_counters where world_id = ? and period_key = ?',
      [this.worldId, key],
    );
    return {
      requests: row?.requests ?? 0,
      tokens: row?.tokens ?? 0,
      estimateOnly: (row?.estimate_only ?? 0) === 1,
    };
  }

  private reserved(key: string): PeriodUse {
    const row = this.db.get<{ requests: number | null; tokens: number | null }>(
      `select sum(requests) as requests, sum(tokens) as tokens from usage_reservations
        where world_id = ? and status = 'reserved' and (day_key = ? or month_key = ?)`,
      [this.worldId, key, key],
    );
    return { requests: row?.requests ?? 0, tokens: row?.tokens ?? 0, estimateOnly: false };
  }

  /** Recorded plus still-open reservations: the figure ceilings are checked against. */
  private committed(key: string): PeriodUse {
    const recorded = this.recorded(key);
    const reserved = this.reserved(key);
    return {
      requests: recorded.requests + reserved.requests,
      tokens: recorded.tokens + reserved.tokens,
      estimateOnly: recorded.estimateOnly,
    };
  }

  private read(): UsageSnapshot {
    const { dayKey, monthKey } = this.keys();
    const day = this.committed(dayKey);
    const month = this.committed(monthKey);
    return {
      dayKey,
      monthKey,
      requestsToday: day.requests,
      tokensToday: day.tokens,
      requestsThisMonth: month.requests,
      tokensThisMonth: month.tokens,
      estimateOnly: day.estimateOnly || month.estimateOnly,
    };
  }

  snapshot(): UsageSnapshot {
    this.cache = this.read();
    return this.cache;
  }

  /**
   * A crash can leave a reservation open forever. Treat it as spending: the request may well have been
   * billable, and forgetting it would understate the operator's costs.
   */
  private reconcileOrphanedReservations(): void {
    const open = this.db.all<{ id: number; day_key: string; month_key: string; requests: number; tokens: number }>(
      `select id, day_key, month_key, requests, tokens from usage_reservations
        where world_id = ? and status = 'reserved'`,
      [this.worldId],
    );
    if (open.length === 0) return;
    this.db.transaction(() => {
      for (const reservation of open) {
        // Both period rows carry the requests and the tokens: the monthly ceiling must see the same
        // interrupted dispatch as the daily one.
        this.addToCounters(reservation.day_key, reservation.requests, reservation.tokens, true);
        this.addToCounters(reservation.month_key, reservation.requests, reservation.tokens, true);
        this.db.run(
          `update usage_reservations set status = 'uncertain', settled_at = ? where id = ?`,
          [this.now().toISOString(), reservation.id],
        );
      }
    });
    this.logger.warn('retained conservative spend for interrupted dispatches', { count: open.length });
  }

  /**
   * Reserve (and validate) an estimate before dispatch. Throws `BudgetExceeded` instead of spending.
   * Returns a reservation id that must be settled — even when the call fails — so the estimate is
   * replaced by what actually happened.
   */
  reserve(params: { promptTokens: number; maxOutputTokens: number; requests?: number }): number {
    const requests = Math.max(1, params.requests ?? 1);
    const tokens = Math.max(0, params.promptTokens) + Math.max(0, params.maxOutputTokens);
    const { dayKey, monthKey } = this.keys();
    return this.db.transaction(() => {
      const c = this.ceilings;
      const day = this.committed(dayKey);
      const month = this.committed(monthKey);
      if (c.dailyRequests !== null && day.requests + requests > c.dailyRequests) {
        throw new BudgetExceeded('daily', 'requests');
      }
      if (c.monthlyRequests !== null && month.requests + requests > c.monthlyRequests) {
        throw new BudgetExceeded('monthly', 'requests');
      }
      if (c.dailyTokens !== null && day.tokens + tokens > c.dailyTokens) {
        throw new BudgetExceeded('daily', 'tokens');
      }
      if (c.monthlyTokens !== null && month.tokens + tokens > c.monthlyTokens) {
        throw new BudgetExceeded('monthly', 'tokens');
      }
      const result = this.db.run(
        `insert into usage_reservations (world_id, day_key, month_key, requests, tokens, status, created_at)
         values (?, ?, ?, ?, ?, 'reserved', ?)`,
        [this.worldId, dayKey, monthKey, requests, tokens, this.now().toISOString()],
      );
      this.cache = this.read();
      return result.lastInsertRowid;
    });
  }

  /**
   * Close a reservation with the usage that actually happened.
   *
   * `estimateOnly` travels with the numbers so the dashboard never claims a hard tokenizer guarantee:
   * when the provider omits usage, the input estimate and the output estimate are both labelled.
   */
  settle(
    reservationId: number,
    usage: { promptTokens: number; completionTokens: number; estimateOnly: boolean },
  ): void {
    this.db.transaction(() => {
      const reservation = this.db.get<{ id: number; day_key: string; month_key: string; status: string }>(
        'select id, day_key, month_key, status from usage_reservations where id = ? and world_id = ?',
        [reservationId, this.worldId],
      );
      if (!reservation || reservation.status !== 'reserved') return;
      const total = Math.max(0, usage.promptTokens) + Math.max(0, usage.completionTokens);
      this.db.run(`update usage_reservations set status = 'settled', settled_at = ? where id = ?`, [
        this.now().toISOString(),
        reservationId,
      ]);
      this.addToCounters(reservation.day_key, 1, total, usage.estimateOnly);
      this.addToCounters(reservation.month_key, 1, total, usage.estimateOnly);
    });
    this.cache = this.read();
  }

  /** Record usage without a reservation (tests and retrospective accounting). */
  record(params: { promptTokens: number; completionTokens: number; estimateOnly: boolean }): void {
    const { dayKey, monthKey } = this.keys();
    const total = Math.max(0, params.promptTokens) + Math.max(0, params.completionTokens);
    this.db.transaction(() => {
      this.addToCounters(dayKey, 1, total, params.estimateOnly);
      this.addToCounters(monthKey, 1, total, params.estimateOnly);
    });
    this.cache = this.read();
  }

  private addToCounters(key: string, requests: number, tokens: number, estimateOnly: boolean): void {
    this.db.run(
      `insert into usage_counters (world_id, period_key, requests, tokens, estimate_only, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(world_id, period_key) do update set
         requests = requests + excluded.requests,
         tokens = tokens + excluded.tokens,
         estimate_only = max(estimate_only, excluded.estimate_only),
         updated_at = excluded.updated_at`,
      [this.worldId, key, Math.max(0, requests), Math.max(0, tokens), estimateOnly ? 1 : 0, this.now().toISOString()],
    );
  }

  /** Daily/monthly report line; also used by the dashboard. */
  describe(): string {
    const s = this.snapshot();
    return (
      `today ${s.requestsToday} req / ${s.tokensToday} tok${s.estimateOnly ? ' (est.)' : ''}; ` +
      `month ${s.requestsThisMonth} req / ${s.tokensThisMonth} tok`
    );
  }
}
