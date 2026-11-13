import type { Db } from './database.js';

/** Operator command queue: validated requests applied at a documented turn boundary. */

export type OperatorCommandKind =
  | 'pause'
  | 'resume'
  | 'set_population_policy'
  | 'set_target'
  | 'set_setting'
  | 'inject_event';

export interface OperatorCommand {
  id: number;
  kind: OperatorCommandKind;
  payload: Record<string, unknown>;
  status: 'pending' | 'applied' | 'rejected';
  requestedAt: string;
  error: string | null;
}

interface RawRow {
  id: number;
  kind: OperatorCommandKind;
  payload_json: string;
  status: OperatorCommand['status'];
  requested_at: string;
  error: string | null;
}

export function enqueueCommand(db: Db, worldId: number, kind: OperatorCommandKind, payload: Record<string, unknown>): number {
  const result = db.run(
    `insert into operator_commands (world_id, kind, payload_json, status, requested_at) values (?, ?, ?, 'pending', ?)`,
    [worldId, kind, JSON.stringify(payload), new Date().toISOString()],
  );
  return result.lastInsertRowid;
}

export function pendingCommands(db: Db, worldId: number, limit = 50): OperatorCommand[] {
  return db
    .all<RawRow>(
      `select id, kind, payload_json, status, requested_at, error from operator_commands
        where world_id = ? and status = 'pending' order by id limit ?`,
      [worldId, limit],
    )
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      payload: safeParse(row.payload_json),
      status: row.status,
      requestedAt: row.requested_at,
      error: row.error,
    }));
}

export function completeCommand(db: Db, id: number, status: 'applied' | 'rejected', error?: string, appliedDay?: number): void {
  db.run(`update operator_commands set status = ?, applied_at = ?, applied_day = ?, error = ? where id = ?`, [
    status,
    new Date().toISOString(),
    appliedDay ?? null,
    error ?? null,
    id,
  ]);
}

function safeParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
