/**
 * Tiny typed fetch wrapper for the local dashboard API.
 * Read routes are plain GETs; mutations carry the ephemeral CSRF token issued by /api/session.
 */

let csrfToken: string | null = null;

async function ensureToken(): Promise<string> {
  if (csrfToken !== null) return csrfToken;
  const response = await fetch('/api/session', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`session request failed (${response.status})`);
  const body = (await response.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return (await response.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const token = await ensureToken();
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tidehaven-csrf': token,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

/**
 * Subscribe to revision notifications.
 *
 * The callback receives the server revision id (and the day, when present), so open detail views can
 * use it as a cache-invalidation dependency instead of only refreshing when the tab remounts.
 */
export function subscribe(onRevision: (revision: number, day: number | null) => void): () => void {
  const events = new EventSource('/api/stream');
  events.onmessage = (message) => {
    try {
      const parsed = JSON.parse(message.data) as { id?: number; day?: number; type?: string };
      const revision = typeof parsed.id === 'number' ? parsed.id : Date.now();
      const day = typeof parsed.day === 'number' ? parsed.day : null;
      onRevision(revision, day);
    } catch {
      onRevision(Date.now(), null);
    }
  };
  events.onerror = () => {
    // EventSource reconnects automatically and replays from Last-Event-ID; nothing else to do.
  };
  return () => events.close();
}

export interface WorldSummary {
  id: number;
  name: string;
  seed: string;
  day: number;
  phase: string;
  rulesVersion: string;
  population: number;
  populationTarget: number;
  populationPolicyEnabled?: boolean;
  hostCeiling?: number;
  expectedBirths: number;
  households: number;
  businesses: number;
  treasuryCents: number;
  moneySupplyCents: number;
  stateHash: string | null;
}

export interface StatusSnapshotView {
  version: string;
  townExists: boolean;
  running: boolean;
  pause: { reason: string; detail: string } | null;
  world: WorldSummary | null;
  throughput: {
    daysPerHour: number | null;
    inFlightRequests: number;
    queueDepth: number;
    jobsPending: number;
    fallbackRateBps: number;
    lastDayDurationMs: number | null;
    daysCommitted: number;
  };
  usage: {
    requestsToday: number;
    tokensToday: number;
    requestsThisMonth: number;
    tokensThisMonth: number;
    estimateOnly: boolean;
    ceilings: { dailyTokens: number | null; monthlyTokens: number | null };
  };
  storage: { databaseBytes: number; freeBytes: number | null; backups: number; archiveBytes: number };
  provider: { mode: string; model: string | null };
  invariants: { ok: boolean; detail: string | null };
  recovery: string | null;
}

/** Money is stored as integer cents; show it as dollars: 1234 -> "$12.34", -50 -> "-$0.50". */
export function cents(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const dollars = (Math.abs(value) / 100).toFixed(2);
  const [whole = '0', fraction = '00'] = dollars.split('.');
  return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/** Days since founding are shown as a calendar: day 400 -> "Year 2, day 35" (365-day years). */
export function calendarDay(day: number, daysPerYear = 365): string {
  if (!Number.isFinite(day)) return '—';
  if (day < 0) return `${Math.ceil(-day / daysPerYear)} years before founding`;
  return `Year ${Math.floor(day / daysPerYear) + 1}, day ${(day % daysPerYear) + 1}`;
}

/** Age in whole years on a given day (365-day years). */
export function ageYears(bornDay: number, today: number, daysPerYear = 365): number {
  return Math.max(0, Math.floor((today - bornDay) / daysPerYear));
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
