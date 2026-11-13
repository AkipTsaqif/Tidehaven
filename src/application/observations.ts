import type { Db } from '../storage/database.js';
import type { PromptEvent } from '../model/prompts.js';

/**
 * Actor observation filtering.
 *
 * A resident prompt may only contain facts that are public (or at least rumoured). Secret crimes,
 * private affairs, private proposals, and operator-only details never reach a prompt: the filter is
 * applied in the query, not left to the prompt builder, so no future template change can leak them.
 */

const PROMPT_LOOKBACK_DAYS = 3;
const PROMPT_EVENT_LIMIT = 60;

export function promptEventsFor(db: Db, worldId: number, day: number): PromptEvent[] {
  const events = db.all<{ day: number; kind: string; title: string; visibility: string }>(
    `select day, kind, title, visibility from events
      where world_id = ? and day >= ? and visibility in ('public', 'rumor')
      order by id desc limit ?`,
    [worldId, Math.max(0, day - PROMPT_LOOKBACK_DAYS), PROMPT_EVENT_LIMIT],
  );
  return events
    .reverse()
    .map((event) => ({ day: event.day, kind: event.kind, title: event.title, public: event.visibility === 'public' }));
}

/** Memories belong to exactly one resident; there is no cross-resident memory read path. */
export function memoriesFor(db: Db, worldId: number, residentId: number, max: number): { day: number; text: string; importance: number }[] {
  const rows = db.all<{ day: number; text: string; importance: number }>(
    `select day, text, importance from memories where world_id = ? and resident_id = ?
      order by importance desc, day desc limit ?`,
    [worldId, residentId, Math.max(0, max)],
  );
  return rows.sort((a, b) => a.day - b.day);
}
