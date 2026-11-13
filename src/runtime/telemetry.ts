import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structured JSON logging with credential redaction, daily rotation, and bounded retention.
 *
 * Log records never contain API keys, bearer tokens, or raw prompts: anything whose field name looks
 * secret is redacted defensively before serialisation. Logging is deliberately non-deterministic
 * (wall clock) and therefore lives outside domain state.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|token|secret|password|cookie)/i;

export interface LogRecord {
  ts: string;
  level: LogLevel;
  msg: string;
  [field: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
  /** Recent records, oldest first. Bounded. */
  recent(limit?: number): LogRecord[];
  flush(): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Directory for rotated log files. Omit or null for memory-only logging (tests). */
  logDir?: string | null;
  keepFiles?: number;
  /** Bounded in-memory tail exposed to the dashboard. */
  memorySize?: number;
  /** Also write to stdout/stderr. */
  console?: boolean;
  now?: () => number;
}

interface Sinks {
  memory: LogRecord[];
  memorySize: number;
  level: LogLevel;
  logDir: string | null;
  keepFiles: number;
  toConsole: boolean;
  now: () => number;
  rotatedFor: string;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack?.split('\n').slice(0, 8) };
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}

function pruneLogs(logDir: string, keepFiles: number): void {
  try {
    if (!existsSync(logDir)) return;
    const files = readdirSync(logDir)
      .filter((name) => name.startsWith('tidehaven-') && name.endsWith('.log'))
      .sort();
    const excess = files.length - keepFiles;
    for (let i = 0; i < excess; i += 1) {
      const name = files[i];
      if (!name) continue;
      try {
        unlinkSync(join(logDir, name));
      } catch {
        // Retention is best-effort.
      }
    }
  } catch {
    // Never fail because of retention housekeeping.
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const sinks: Sinks = {
    memory: [],
    memorySize: options.memorySize ?? 500,
    level: options.level ?? 'info',
    logDir: options.logDir ?? null,
    keepFiles: options.keepFiles ?? 14,
    toConsole: options.console ?? true,
    now: options.now ?? (() => Date.now()),
    rotatedFor: '',
  };

  if (sinks.logDir) {
    mkdirSync(sinks.logDir, { recursive: true });
    pruneLogs(sinks.logDir, sinks.keepFiles);
  }

  function emit(recordLevel: LogLevel, msg: string, fields: Record<string, unknown> | undefined): void {
    if (LEVEL_ORDER[recordLevel] < LEVEL_ORDER[sinks.level]) return;
    const ts = sinks.now();
    const record: LogRecord = {
      ts: new Date(ts).toISOString(),
      level: recordLevel,
      msg,
      ...(redact(fields ?? {}) as Record<string, unknown>),
    };
    sinks.memory.push(record);
    if (sinks.memory.length > sinks.memorySize) sinks.memory.splice(0, sinks.memory.length - sinks.memorySize);

    const line = JSON.stringify(record);
    if (sinks.logDir) {
      const day = isoDate(ts);
      if (day !== sinks.rotatedFor) {
        sinks.rotatedFor = day;
        pruneLogs(sinks.logDir, sinks.keepFiles);
      }
      try {
        appendFileSync(join(sinks.logDir, `tidehaven-${day}.log`), `${line}\n`);
      } catch {
        // Logging must never take the simulation down.
      }
    }
    if (sinks.toConsole) {
      const stream = recordLevel === 'error' || recordLevel === 'warn' ? process.stderr : process.stdout;
      stream.write(`${line}\n`);
    }
  }

  function make(bound: Record<string, unknown>): Logger {
    const merge = (fields?: Record<string, unknown>): Record<string, unknown> => ({
      ...bound,
      ...(fields ?? {}),
    });
    return {
      debug: (msg, fields) => emit('debug', msg, merge(fields)),
      info: (msg, fields) => emit('info', msg, merge(fields)),
      warn: (msg, fields) => emit('warn', msg, merge(fields)),
      error: (msg, fields) => emit('error', msg, merge(fields)),
      child: (fields) => make({ ...bound, ...fields }),
      recent: (limit = 100) => sinks.memory.slice(Math.max(0, sinks.memory.length - limit)),
      flush: () => undefined,
    };
  }

  return make({});
}

/** A logger that discards everything. Useful for quiet tests. */
export function silentLogger(): Logger {
  const noop = (): void => undefined;
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
    recent: () => [],
    flush: noop,
  };
  return logger;
}
