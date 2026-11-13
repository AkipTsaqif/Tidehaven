import type { Db } from '../storage/database.js';

/**
 * Chart history from `daily_metrics` (one compact row per committed day, never archived away).
 *
 * A long-running town has tens of thousands of days, so "whole history" is evenly sampled down to at
 * most `maxPoints` rows and always includes the newest day. Each metric is flattened to a number:
 * nested maps (goods, prices, demand...) become `goods.grain`, `prices.bread`, and so on.
 */

export const HISTORY_MAX_POINTS = 2_000;

export interface HistoryResult {
  /** Requested window in days, or null for the whole history. */
  windowDays: number | null;
  /** First and last committed day in the whole history (null before day 1). */
  firstDay: number | null;
  lastDay: number | null;
  /** True when the window had more days than `points.length` and was sampled. */
  sampled: boolean;
  days: number[];
  series: Record<string, number[]>;
}

export function metricHistory(db: Db, worldId: number, windowDays: number | null, maxPoints = HISTORY_MAX_POINTS): HistoryResult {
  const bounds = db.get<{ first: number | null; last: number | null; total: number }>(
    'select min(day) as first, max(day) as last, count(*) as total from daily_metrics where world_id = ?', [worldId],
  );
  const firstDay = bounds?.first ?? null;
  const lastDay = bounds?.last ?? null;
  const empty: HistoryResult = { windowDays, firstDay, lastDay, sampled: false, days: [], series: {} };
  if (firstDay === null || lastDay === null) return empty;

  const fromDay = windowDays === null ? firstDay : Math.max(firstDay, lastDay - windowDays + 1);
  const total = db.get<{ n: number }>(
    'select count(*) as n from daily_metrics where world_id = ? and day >= ?', [worldId, fromDay],
  )?.n ?? 0;
  const limit = Math.max(2, Math.min(HISTORY_MAX_POINTS, Math.trunc(maxPoints)));
  const step = Math.max(1, Math.ceil(total / limit));
  // Sample by row position, then always add the newest day so the chart ends at "today".
  const rows = db.all<{ day: number; metrics_json: string }>(
    `select day, metrics_json from (
       select day, metrics_json, row_number() over (order by day) - 1 as idx
         from daily_metrics where world_id = ? and day >= ?
     ) where idx % ? = 0 or day = ? order by day`,
    [worldId, fromDay, step, lastDay],
  );

  const days: number[] = [];
  const series: Record<string, number[]> = {};
  rows.forEach((row, index) => {
    days.push(row.day);
    const flat = flatten(parse(row.metrics_json));
    for (const [key, value] of Object.entries(flat)) {
      // A key that first appears later starts with gaps (NaN) so every series stays aligned with `days`.
      if (!series[key]) series[key] = new Array<number>(index).fill(Number.NaN);
      series[key].push(value);
    }
    for (const values of Object.values(series)) if (values.length < days.length) values.push(Number.NaN);
  });
  return { windowDays, firstDay, lastDay, sampled: step > 1, days, series };
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Numbers and booleans only; one level of nesting (`goods.grain`). Strings and deeper data are skipped. */
function flatten(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === 'number' && Number.isFinite(inner)) out[key] = inner;
    else if (typeof inner === 'boolean') out[key] = inner ? 1 : 0;
    else if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      for (const [sub, leaf] of Object.entries(inner)) {
        if (typeof leaf === 'number' && Number.isFinite(leaf)) out[`${key}.${sub}`] = leaf;
      }
    }
  }
  return out;
}
