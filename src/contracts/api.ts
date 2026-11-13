/**
 * Status snapshot shared by the CLI (`npm run status`), the HTTP API, and the dashboard.
 * Serialised as JSON; integers are safe integers on the JS side.
 */

export type PauseReason =
  | 'operator'
  | 'configuration'
  | 'authentication'
  | 'quota'
  | 'provider_down'
  | 'disk_pressure'
  | 'storage_budget'
  | 'invariant_failure'
  | 'engine_error'
  | 'population_ceiling'
  | 'town_empty'
  | 'migration_required'
  | 'shutdown';

export interface PauseInfo {
  reason: PauseReason;
  detail: string;
  sinceDay: number | null;
  at: string | null;
}

export interface WorldSummary {
  id: number;
  name: string;
  seed: string;
  day: number;
  /** collecting | ready | committed | idle */
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

export interface ThroughputSnapshot {
  startedAt: string | null;
  daysCommitted: number;
  daysPerHour: number | null;
  inFlightRequests: number;
  queueDepth: number;
  jobsPending: number;
  fallbackRateBps: number;
  lastDayDurationMs: number | null;
}

export interface UsageSnapshot {
  requestsToday: number;
  tokensToday: number;
  requestsThisMonth: number;
  tokensThisMonth: number;
  estimateOnly: boolean;
  ceilings: {
    dailyTokens: number | null;
    monthlyTokens: number | null;
    dailyRequests: number | null;
    monthlyRequests: number | null;
  };
}

export interface StorageSnapshot {
  /** SQLite main file plus its WAL and shared-memory companions. */
  databaseBytes: number;
  freeBytes: number | null;
  budgetBytes: number;
  minFreeBytes: number;
  backups: number;
  archiveBytes: number;
  /** Everything Tidehaven owns under the data directory (the figure the budget guard enforces). */
  totalBytes: number;
  checkpointBytes: number;
  logBytes: number;
}

export interface StatusSnapshot {
  version: string;
  townExists: boolean;
  running: boolean;
  migrateRequired: boolean;
  pause: PauseInfo | null;
  world: WorldSummary | null;
  throughput: ThroughputSnapshot;
  usage: UsageSnapshot;
  storage: StorageSnapshot;
  provider: { mode: 'fixture' | 'live' | 'unconfigured'; model: string | null; baseUrl: string | null };
  invariants: { ok: boolean; checkedAtDay: number | null; detail: string | null };
  server: { host: string; port: number; startedAt: string | null };
  /** Human-readable recovery hint when paused or set up incorrectly. */
  recovery: string | null;
}
