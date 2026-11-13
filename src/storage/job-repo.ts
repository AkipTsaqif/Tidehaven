import type { Db } from './database.js';

/**
 * Turn and job state machine persistence.
 *
 * Turn: collecting -> ready -> committed. A `ready` turn can be applied without another model call; an
 * interrupted `collecting` turn only re-requests the missing jobs. Jobs are keyed uniquely by
 * (world, day, phase, actor, kind) and store terminal fallback outcomes so a restart never duplicates
 * an accepted decision.
 */

export type TurnStatus = 'collecting' | 'ready' | 'committed';
export type JobStatus = 'pending' | 'running' | 'done' | 'fallback' | 'failed' | 'expired';

export interface TurnRow {
  id: number;
  day: number;
  status: TurnStatus;
  inputHash: string;
  preparedJson: string | null;
  stateHashBefore: string | null;
  stateHashAfter: string | null;
  startedAt: string;
  committedAt: string | null;
  durationMs: number | null;
  metricsJson: string | null;
}

export interface JobRow {
  id: number;
  day: number;
  phase: string;
  actorId: number;
  jobKind: string;
  status: JobStatus;
  attempts: number;
  requestJson: string | null;
  resultJson: string | null;
  fallbackReason: string | null;
  errorClass: string | null;
  latencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
  providerRequestId: string | null;
}

interface RawTurnRow {
  id: number;
  day: number;
  phase: string;
  input_hash: string;
  prepared_json: string | null;
  state_hash_before: string | null;
  state_hash_after: string | null;
  started_at: string;
  committed_at: string | null;
  duration_ms: number | null;
  metrics_json: string | null;
}

interface RawJobRow {
  id: number;
  day: number;
  phase: string;
  actor_id: number;
  job_kind: string;
  status: JobStatus;
  attempts: number;
  request_json: string | null;
  result_json: string | null;
  fallback_reason: string | null;
  error_class: string | null;
  latency_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  provider_request_id: string | null;
}

export function getOpenTurn(db: Db, worldId: number): (TurnRow & { phase: string }) | null {
  const row = db.get<RawTurnRow>(
    `select * from turns where world_id = ? and phase != 'committed' order by day desc limit 1`,
    [worldId],
  );
  return row ? mapTurn(row) : null;
}

export function getTurn(db: Db, worldId: number, day: number): (TurnRow & { phase: string }) | null {
  const row = db.get<RawTurnRow>(`select * from turns where world_id = ? and day = ?`, [worldId, day]);
  return row ? mapTurn(row) : null;
}

function mapTurn(row: RawTurnRow): TurnRow & { phase: string } {
  return {
    id: row.id,
    day: row.day,
    phase: row.phase,
    status: row.phase as TurnStatus,
    inputHash: row.input_hash,
    preparedJson: row.prepared_json,
    stateHashBefore: row.state_hash_before,
    stateHashAfter: row.state_hash_after,
    startedAt: row.started_at,
    committedAt: row.committed_at,
    durationMs: row.duration_ms,
    metricsJson: row.metrics_json,
  };
}

export function startTurn(db: Db, params: {
  worldId: number;
  day: number;
  inputHash: string;
  stateHashBefore: string;
  prepared: unknown;
  schemaVersion: number;
  rulesVersion: string;
}): number {
  const existing = db.get<{ id: number }>('select id from turns where world_id = ? and day = ?', [
    params.worldId,
    params.day,
  ]);
  if (existing) {
    // Never reset a committed row: the world is behind its own turn record, which the runner
    // reconciles instead of silently re-running a committed day.
    db.run(
      `update turns set phase = 'collecting', input_hash = ?, prepared_json = ?
        where id = ? and phase != 'committed'`,
      [params.inputHash, JSON.stringify(params.prepared), existing.id],
    );
    return existing.id;
  }
  const result = db.run(
    `insert into turns (world_id, day, phase, input_hash, rules_version, schema_version, prepared_json,
                        state_hash_before, started_at)
     values (?, ?, 'collecting', ?, ?, ?, ?, ?, ?)`,
    [
      params.worldId,
      params.day,
      params.inputHash,
      params.rulesVersion,
      params.schemaVersion,
      JSON.stringify(params.prepared),
      params.stateHashBefore,
      new Date().toISOString(),
    ],
  );
  return result.lastInsertRowid;
}

export function markTurnReady(db: Db, turnId: number): void {
  // A committed turn is history: reopening it would let a stale writer re-resolve a saved day.
  const updated = db.run(`update turns set phase = 'ready' where id = ? and phase != 'committed'`, [turnId]);
  if (updated.changes === 0) {
    throw new Error(`Turn ${turnId} is already committed and cannot be reopened`);
  }
}

export function markTurnCommitted(db: Db, turnId: number, params: {
  stateHashAfter: string;
  durationMs: number;
  metrics: unknown;
}): void {
  db.run(
    `update turns set phase = 'committed', committed_at = ?, state_hash_after = ?, duration_ms = ?, metrics_json = ?
     where id = ?`,
    [new Date().toISOString(), params.stateHashAfter, params.durationMs, JSON.stringify(params.metrics), turnId],
  );
}

/**
 * Reconcile turn records with the committed world.
 *
 * A crash between the world commit and the turn transition (or a tool that advanced the world) can
 * leave a turn older than the committed day stuck in `collecting`/`ready`. Those turns must be closed
 * rather than replayed, or restart would resolve a day the world already contains.
 */
export function reconcileTurns(db: Db, worldId: number, currentDay: number): number {
  const stale = db.all<{ id: number; day: number }>(
    `select id, day from turns where world_id = ? and day <= ? and phase != 'committed' order by day`,
    [worldId, currentDay],
  );
  if (stale.length === 0) return 0;
  db.transaction(() => {
    for (const turn of stale) {
      const metrics = db.get<{ state_hash: string | null; metrics_json: string | null }>(
        'select state_hash, metrics_json from daily_metrics where world_id = ? and day = ?',
        [worldId, turn.day],
      );
      db.run(
        `update turns set phase = 'committed', committed_at = ?, state_hash_after = ?, metrics_json = ?
          where id = ?`,
        [
          new Date().toISOString(),
          metrics?.state_hash ?? null,
          metrics?.metrics_json ?? null,
          turn.id,
        ],
      );
    }
  });
  return stale.length;
}

export function listJobs(db: Db, worldId: number, day: number): JobRow[] {
  return db
    .all<RawJobRow>(`select * from jobs where world_id = ? and day = ? order by actor_id, job_kind`, [worldId, day])
    .map(mapJob);
}

export function findJob(db: Db, worldId: number, day: number, actorId: number, kind: string): JobRow | null {
  const row = db.get<RawJobRow>(
    `select * from jobs where world_id = ? and day = ? and actor_id = ? and job_kind = ?`,
    [worldId, day, actorId, kind],
  );
  return row ? mapJob(row) : null;
}

function mapJob(row: RawJobRow): JobRow {
  return {
    id: row.id,
    day: row.day,
    phase: row.phase,
    actorId: row.actor_id,
    jobKind: row.job_kind,
    status: row.status,
    attempts: row.attempts,
    requestJson: row.request_json,
    resultJson: row.result_json,
    fallbackReason: row.fallback_reason,
    errorClass: row.error_class,
    latencyMs: row.latency_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    providerRequestId: row.provider_request_id,
  };
}

export function upsertJob(db: Db, params: {
  worldId: number;
  day: number;
  phase: string;
  actorId: number;
  jobKind: string;
  status: JobStatus;
  priority?: number;
  request?: unknown;
  result?: unknown;
  fallbackReason?: string | null;
  errorClass?: string | null;
  latencyMs?: number | null;
  promptTokens?: number;
  completionTokens?: number;
  providerRequestId?: string | null;
  attempts?: number;
}): number {
  const now = new Date().toISOString();
  const existing = findJob(db, params.worldId, params.day, params.actorId, params.jobKind);
  if (existing) {
    db.run(
      `update jobs set status = ?, request_json = coalesce(?, request_json), result_json = coalesce(?, result_json),
         fallback_reason = ?, error_class = ?, latency_ms = ?, prompt_tokens = ?, completion_tokens = ?,
         provider_request_id = coalesce(?, provider_request_id), attempts = ?, updated_at = ?
       where id = ?`,
      [
        params.status,
        params.request === undefined ? null : JSON.stringify(params.request),
        params.result === undefined ? null : JSON.stringify(params.result),
        params.fallbackReason ?? null,
        params.errorClass ?? null,
        params.latencyMs ?? null,
        params.promptTokens ?? 0,
        params.completionTokens ?? 0,
        params.providerRequestId ?? null,
        params.attempts ?? existing.attempts,
        now,
        existing.id,
      ],
    );
    return existing.id;
  }
  const result = db.run(
    `insert into jobs (world_id, day, phase, actor_id, job_kind, status, priority, attempts, request_json,
                       result_json, fallback_reason, error_class, latency_ms, prompt_tokens, completion_tokens,
                       provider_request_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.worldId,
      params.day,
      params.phase,
      params.actorId,
      params.jobKind,
      params.status,
      params.priority ?? 0,
      params.attempts ?? 0,
      params.request === undefined ? null : JSON.stringify(params.request),
      params.result === undefined ? null : JSON.stringify(params.result),
      params.fallbackReason ?? null,
      params.errorClass ?? null,
      params.latencyMs ?? null,
      params.promptTokens ?? 0,
      params.completionTokens ?? 0,
      params.providerRequestId ?? null,
      now,
      now,
    ],
  );
  return result.lastInsertRowid;
}

export function recordAttempt(db: Db, params: {
  jobId: number;
  attemptNo: number;
  status: string;
  httpStatus?: number | null;
  latencyMs?: number | null;
  requestBytes?: number | null;
  responseBytes?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  errorClass?: string | null;
  capability?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  schemaVersion?: number | null;
}): void {
  db.run(
    `insert into model_attempts (job_id, attempt_no, status, http_status, latency_ms, request_bytes, response_bytes,
                                 prompt_tokens, completion_tokens, error_class, capability, model, prompt_version,
                                 schema_version, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.jobId,
      params.attemptNo,
      params.status,
      params.httpStatus ?? null,
      params.latencyMs ?? null,
      params.requestBytes ?? null,
      params.responseBytes ?? null,
      params.promptTokens ?? null,
      params.completionTokens ?? null,
      params.errorClass ?? null,
      params.capability ?? null,
      params.model ?? null,
      params.promptVersion ?? null,
      params.schemaVersion ?? null,
      new Date().toISOString(),
    ],
  );
}

export function countJobsByStatus(db: Db, worldId: number, day: number): Record<string, number> {
  const rows = db.all<{ status: string; count: number }>(
    'select status, count(*) as count from jobs where world_id = ? and day = ? group by status',
    [worldId, day],
  );
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = row.count;
  return out;
}
