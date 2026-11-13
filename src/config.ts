import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { MAX_HOST_CEILING } from './domain/growth-limits.js';

/**
 * Configuration loading.
 *
 * Sources, in increasing precedence:
 *   1. config/defaults.json (checked in, contains no credentials)
 *   2. environment variables (see .env.example)
 *   3. explicit CLI overrides
 *
 * Credentials only ever come from the server environment. Nothing here writes secrets to disk.
 */

const nullableInt = z.number().int().min(0).nullable();

const defaultsSchema = z.object({
  simulation: z.object({
    populationTarget: z.number().int().min(0),
    populationPolicyEnabled: z.boolean(),
    hostCeiling: z.number().int().min(1).max(MAX_HOST_CEILING),
    drama: z.enum(['calm', 'dramatic', 'volatile']),
    worldName: z.string().min(1),
    seedPhrase: z.string().min(1),
  }),
  calendar: z.object({
    daysPerYear: z.number().int().positive(),
    adultDays: z.number().int().positive(),
    elderDays: z.number().int().positive(),
    pregnancyDays: z.number().int().positive(),
    weekDays: z.number().int().positive(),
  }),
  model: z.object({
    concurrency: z.number().int().min(1).max(64),
    queueCapacity: z.number().int().min(1).max(4096),
    requestTimeoutMs: z.number().int().min(1000).max(600000),
    maxDispatchesPerJob: z.number().int().min(1).max(5),
    maxInputTokens: z.number().int().min(256).max(200000),
    maxOutputTokens: z.number().int().min(64).max(32000),
    dialogueRounds: z.number().int().min(0).max(4),
    conversationsPerDay: z.number().int().min(0).max(50),
    memoriesPerPrompt: z.number().int().min(0).max(200),
    reflectionsPerDay: z.number().int().min(0).max(100),
    promptMaxBytes: z.number().int().min(1024).max(1048576),
    responseMaxBytes: z.number().int().min(1024).max(8388608),
    fallbackPauseRateBps: z.number().int().min(0).max(10000),
    retryBaseDelayMs: z.number().int().min(10).max(60000),
    maxRetryDelayMs: z.number().int().min(100).max(600000),
  }),
  ceilings: z.object({
    dailyTokens: nullableInt,
    monthlyTokens: nullableInt,
    dailyRequests: nullableInt,
    monthlyRequests: nullableInt,
    monthlyResetDayOfMonth: z.number().int().min(1).max(28),
    monthlyResetUtcHour: z.number().int().min(0).max(23),
  }),
  storage: z.object({
    budgetBytes: z.number().int().positive(),
    minFreeBytes: z.number().int().positive(),
    backups: z.number().int().min(1).max(20),
    logFiles: z.number().int().min(1).max(365),
    checkpointIntervalDays: z.number().int().min(1).max(3650),
    rawPayloadRetentionDays: z.number().int().min(0).max(36500),
    detailRetentionDays: z.number().int().min(0).max(365000),
    archiveChunkDays: z.number().int().min(1).max(36500),
  }),
  runtime: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    drainBudgetMs: z.number().int().min(100).max(120000),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
    statusPollMs: z.number().int().min(100).max(60000),
  }),
});

export type Defaults = z.infer<typeof defaultsSchema>;

export interface ProviderConfig {
  /** API root, e.g. https://example.com/v1 */
  baseUrl: string;
  /** Bearer token, or null when a local endpoint needs no authentication. */
  apiKey: string | null;
  /** Model identifier. Never defaulted: never silently choose a model. */
  model: string;
}

export interface AppConfig {
  projectRoot: string;
  dataDir: string;
  host: string;
  port: number;
  defaults: Defaults;
  provider: ProviderConfig;
  /** Explicit opt-in for a paid probe request (`doctor --probe`). */
  allowProbe: boolean;
  /** Fixture provider mode used by tests and soaks: no network, no credentials. */
  fixtureProvider: boolean;
  /** Scenario file, relative to the project root (default `scenarios/tidehaven.json`). */
  scenarioFile: string;
  /** True when TIDEHAVEN_DATA_DIR was set; false when the per-scenario default is in use. */
  dataDirExplicit: boolean;
  /** Explicit founding-only override from TIDEHAVEN_POPULATION_POLICY. */
  populationPolicyOverride: boolean | undefined;
}

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Project root is resolved from this module's location, never the caller's cwd. */
export function projectRoot(): string {
  if (process.env.TIDEHAVEN_PROJECT_ROOT) return resolve(process.env.TIDEHAVEN_PROJECT_ROOT);
  // dist/config.js -> project root; src/config.ts -> project root (tests)
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

export function loadDefaults(root = projectRoot()): Defaults {
  const path = join(root, 'config', 'defaults.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`Cannot read default configuration at ${path}`, [String(err)]);
  }
  const parsed = defaultsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid default configuration at ${path}`,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  return parsed.data;
}

function readEnvNumber(env: NodeJS.ProcessEnv, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new ConfigError(`Environment variable ${key} must be an integer`, [raw]);
  }
  return value;
}

function readEnvCeiling(env: NodeJS.ProcessEnv, key: string): number | null | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  if (raw.trim() === '') return null;
  const value = readEnvNumber(env, key);
  return value === undefined ? undefined : value;
}

/** Parent of the per-scenario default data directories: `<project>/data/<scenario>`. */
export function defaultDataRoot(root: string): string {
  return join(root, 'data');
}

function resolveDataDir(root: string, raw: string | undefined, scenarioName: string): string {
  if (!raw || raw.trim() === '') return join(defaultDataRoot(root), scenarioName);
  return isAbsolute(raw) ? raw : resolve(root, raw);
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  root?: string;
  /** Test/dev hook: run against the in-process fixture provider instead of the network. */
  fixtureProvider?: boolean;
  allowProbe?: boolean;
}

/**
 * Load and validate configuration. Does not require provider credentials: a town can be opened,
 * inspected, backed up, and paused without them. Live simulation checks credentials separately
 * (see `requireProvider`).
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const root = options.root ?? projectRoot();
  const defaults = loadDefaults(root);

  const port = readEnvNumber(env, 'TIDEHAVEN_PORT') ?? defaults.runtime.port;
  const concurrency = readEnvNumber(env, 'TIDEHAVEN_CONCURRENCY');
  const target = readEnvNumber(env, 'TIDEHAVEN_POPULATION_TARGET');
  const hostCeiling = readEnvNumber(env, 'TIDEHAVEN_HOST_CEILING');
  const populationPolicy = env.TIDEHAVEN_POPULATION_POLICY;
  const dailyTokens = readEnvCeiling(env, 'TIDEHAVEN_DAILY_TOKEN_CEILING');
  const monthlyTokens = readEnvCeiling(env, 'TIDEHAVEN_MONTHLY_TOKEN_CEILING');
  const dailyRequests = readEnvCeiling(env, 'TIDEHAVEN_DAILY_REQUEST_CEILING');
  const drama = env.TIDEHAVEN_DRAMA;

  if (concurrency !== undefined) {
    if (concurrency < 1 || concurrency > 64) {
      throw new ConfigError('TIDEHAVEN_CONCURRENCY must be between 1 and 64', [String(concurrency)]);
    }
    defaults.model.concurrency = concurrency;
  }
  if (target !== undefined) {
    if (target < 0) throw new ConfigError('TIDEHAVEN_POPULATION_TARGET must be >= 0', [String(target)]);
    defaults.simulation.populationTarget = target;
  }
  if (hostCeiling !== undefined) {
    if (hostCeiling < 1 || hostCeiling > MAX_HOST_CEILING) {
      throw new ConfigError(`TIDEHAVEN_HOST_CEILING must be an integer between 1 and ${MAX_HOST_CEILING}`, [String(hostCeiling)]);
    }
    defaults.simulation.hostCeiling = hostCeiling;
  }
  let populationPolicyOverride: boolean | undefined;
  if (populationPolicy !== undefined) {
    if (populationPolicy === 'soft_target') populationPolicyOverride = true;
    else if (populationPolicy === 'disabled') populationPolicyOverride = false;
    else throw new ConfigError('TIDEHAVEN_POPULATION_POLICY must be soft_target or disabled', [populationPolicy]);
  }
  if (drama !== undefined) {
    if (drama !== 'calm' && drama !== 'dramatic' && drama !== 'volatile') {
      throw new ConfigError('TIDEHAVEN_DRAMA must be calm, dramatic, or volatile', [drama]);
    }
    defaults.simulation.drama = drama;
  }
  if (dailyTokens !== undefined) defaults.ceilings.dailyTokens = dailyTokens;
  if (monthlyTokens !== undefined) defaults.ceilings.monthlyTokens = monthlyTokens;
  if (dailyRequests !== undefined) defaults.ceilings.dailyRequests = dailyRequests;

  const maxOutputTokens = readEnvNumber(env, 'TIDEHAVEN_MAX_OUTPUT_TOKENS');
  if (maxOutputTokens !== undefined) {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 32000) {
      throw new ConfigError('TIDEHAVEN_MAX_OUTPUT_TOKENS must be an integer between 64 and 32000', [String(maxOutputTokens)]);
    }
    defaults.model.maxOutputTokens = maxOutputTokens;
  }

  const minFreeMb = readEnvNumber(env, 'TIDEHAVEN_MIN_FREE_MB');
  if (minFreeMb !== undefined) {
    if (minFreeMb < 0) throw new ConfigError('TIDEHAVEN_MIN_FREE_MB must be >= 0', [String(minFreeMb)]);
    defaults.storage.minFreeBytes = minFreeMb * 1024 * 1024;
  }

  const logLevel = env.TIDEHAVEN_LOG_LEVEL;
  if (logLevel !== undefined) {
    if (logLevel !== 'debug' && logLevel !== 'info' && logLevel !== 'warn' && logLevel !== 'error') {
      throw new ConfigError('TIDEHAVEN_LOG_LEVEL must be debug, info, warn, or error', [logLevel]);
    }
    defaults.runtime.logLevel = logLevel;
  }

  const worldName = (env.TIDEHAVEN_WORLD_NAME ?? '').trim();
  if (worldName !== '') {
    if (worldName.length > 60) throw new ConfigError('TIDEHAVEN_WORLD_NAME must be at most 60 characters', [worldName]);
    defaults.simulation.worldName = worldName;
  }

  // A bare name only (no paths): the scenario always comes from the project's scenarios/ folder.
  const scenarioName = (env.TIDEHAVEN_SCENARIO ?? '').trim() || 'tidehaven';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(scenarioName)) {
    throw new ConfigError('TIDEHAVEN_SCENARIO must be a scenario name such as "tidehaven" or "eden"', [scenarioName]);
  }

  const baseUrl = (env.TIDEHAVEN_API_BASE_URL ?? '').trim();
  const apiKeyRaw = (env.TIDEHAVEN_API_KEY ?? '').trim();
  const model = (env.TIDEHAVEN_MODEL ?? '').trim();

  return {
    projectRoot: root,
    dataDir: resolveDataDir(root, env.TIDEHAVEN_DATA_DIR, scenarioName),
    dataDirExplicit: (env.TIDEHAVEN_DATA_DIR ?? '').trim() !== '',
    host: defaults.runtime.host,
    port,
    defaults,
    provider: {
      baseUrl,
      apiKey: apiKeyRaw === '' ? null : apiKeyRaw,
      model,
    },
    allowProbe: options.allowProbe === true,
    fixtureProvider: options.fixtureProvider === true,
    scenarioFile: `scenarios/${scenarioName}.json`,
    populationPolicyOverride,
  };
}

/**
 * Validate the provider block. Returns human-readable problems; an empty array means usable.
 * Deliberately strict: no model and no base URL is a setup error, not something to guess.
 */
export function validateProvider(provider: ProviderConfig): string[] {
  const issues: string[] = [];
  if (provider.baseUrl === '') {
    issues.push('TIDEHAVEN_API_BASE_URL is not set');
  } else {
    let url: URL;
    try {
      url = new URL(provider.baseUrl);
    } catch {
      return [...issues, `TIDEHAVEN_API_BASE_URL is not a valid URL: ${provider.baseUrl}`];
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      issues.push('TIDEHAVEN_API_BASE_URL must use http or https');
    }
    if (url.protocol === 'http:') {
      const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
      if (!localHosts.has(url.hostname)) {
        issues.push('TIDEHAVEN_API_BASE_URL uses plain http for a non-local host; use https');
      }
    }
    if (url.username !== '' || url.password !== '') {
      issues.push('TIDEHAVEN_API_BASE_URL must not embed credentials; use TIDEHAVEN_API_KEY');
    }
  }
  if (provider.model === '') issues.push('TIDEHAVEN_MODEL is not set');
  return issues;
}

/** Throw unless the provider configuration is usable for live calls. */
export function requireProvider(provider: ProviderConfig): ProviderConfig {
  const issues = validateProvider(provider);
  if (issues.length > 0) {
    throw new ConfigError('Provider configuration is incomplete', issues);
  }
  return provider;
}

/** Normalise a base URL into an absolute chat-completions endpoint. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}
