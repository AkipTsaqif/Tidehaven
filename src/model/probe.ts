import type { AppConfig } from '../config.js';
import { validateProvider } from '../config.js';
import type { Logger } from '../runtime/telemetry.js';
import type { Db } from '../storage/database.js';
import { readBoundedBody } from './client.js';
import { writeCapability, type ProviderProfile } from './capabilities.js';

export interface ProbeResult {
  ok: boolean;
  detail: string;
  capability?: 'json_schema' | 'json_object' | 'plain_json' | 'unknown';
  latencyMs?: number;
  model?: string;
  /** Requests actually sent. Bounded to 2 (schema probe, then a single object-mode retry). */
  requests?: number;
  /** True when the discovered profile was written to the town database. */
  persisted?: boolean;
}

/**
 * Explicitly authorized capability probe.
 *
 * Sends at most two tiny requests (schema mode, then object mode on a `400` rejection) and reports
 * exactly what came back. It never retries network failures, never selects a different model, never
 * spends more than a handful of tokens per request, and never reads an unbounded response body.
 *
 * When a database is supplied the discovered profile is persisted, so the decision source starts from
 * the probed capability instead of rediscovering it (and paying for it) on the first live day.
 */
export async function probeProvider(
  config: AppConfig,
  logger: Logger,
  options: { db?: Db } = {},
): Promise<ProbeResult> {
  const issues = validateProvider(config.provider);
  if (issues.length > 0) {
    return { ok: false, detail: issues.join('; ') };
  }
  const url = chatUrl(config.provider.baseUrl);
  const started = Date.now();
  let requests = 0;

  const attempt = async (
    responseFormat: Record<string, unknown> | null,
  ): Promise<{ status: number; ok: boolean; body: string; detail: string }> => {
    requests += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(config.provider.apiKey ? { authorization: `Bearer ${config.provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.provider.model,
          messages: [
            { role: 'system', content: 'Reply with a single JSON object and nothing else.' },
            { role: 'user', content: 'Return {"ok": true}.' },
          ],
          max_tokens: 16,
          temperature: 0,
          // `null` means "plain JSON": no structured-output field at all.
          ...(responseFormat === null ? {} : { response_format: responseFormat }),
        }),
      });
      const bounded = await readBoundedBody(
        response,
        Math.max(4_096, Math.min(config.defaults.model.responseMaxBytes, 64_000)),
        () => controller.abort(),
      );
      return {
        status: response.status,
        ok: response.ok && !bounded.truncated,
        body: bounded.text,
        detail: response.ok ? (bounded.truncated ? 'response exceeded the byte bound' : 'ok') : summariseProviderError(bounded.text),
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    // 1. Structured output: the strongest capability, and the one most likely to be refused by a
    //    gateway. A refusal is information, not a failure.
    const rejected = (status: number): boolean => status === 400 || status === 404 || status === 422;
    let used: 'json_schema' | 'json_object' | 'plain_json' = 'json_schema';
    let response = await attempt({
      type: 'json_schema',
      json_schema: {
        name: 'probe',
        strict: true,
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      },
    });
    if (!response.ok && rejected(response.status)) {
      // 2. Object mode: bounded retry, only after an explicit rejection.
      used = 'json_object';
      response = await attempt({ type: 'json_object' });
    }
    if (!response.ok && rejected(response.status)) {
      // 3. Plain JSON: no structured-output field at all. Bounded to three requests total.
      used = 'plain_json';
      response = await attempt(null);
    }
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      logger.warn('provider probe failed', { status: response.status, latencyMs, requests });
      return {
        ok: false,
        detail: `HTTP ${response.status}: ${response.detail}`,
        capability: 'unknown',
        latencyMs,
        requests,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      return { ok: false, detail: 'Provider returned non-JSON body', latencyMs, requests };
    }
    const body = parsed as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
    const content = body.choices?.[0]?.message?.content ?? '';
    if (content.trim() === '') {
      return { ok: false, detail: 'Provider returned an empty message', latencyMs, requests };
    }

    let capability: 'json_schema' | 'json_object' | 'plain_json' = used;
    try {
      const inner = JSON.parse(extractJsonObject(content) ?? 'null') as unknown;
      if (!(inner !== null && typeof inner === 'object')) capability = 'plain_json';
    } catch {
      return {
        ok: false,
        detail: `Model did not return parseable JSON: ${content.slice(0, 120)}`,
        latencyMs,
        requests,
      };
    }

    const detail = `model=${config.provider.model} responded in ${latencyMs} ms with ${capability} mode accepted`;
    let persisted = false;
    if (options.db) {
      try {
        writeCapability(options.db, {
          baseUrl: config.provider.baseUrl,
          model: config.provider.model,
          capability,
          detail,
        });
        persisted = true;
      } catch (err) {
        logger.warn('could not persist provider profile', { err: (err as Error).message });
      }
    }
    return { ok: true, detail, capability, latencyMs, model: config.provider.model, requests, persisted };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = (err as Error).message;
    logger.warn('provider probe error', { message });
    return { ok: false, detail: message, latencyMs, requests };
  }
}

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

/** Pull the first balanced JSON object out of a text blob (fenced or not). No greedy regex. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function summariseProviderError(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty response';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string; type?: string } };
    if (parsed.error?.message) return `${parsed.error.type ?? 'error'}: ${parsed.error.message}`.slice(0, 300);
  } catch {
    // fall through
  }
  return trimmed.slice(0, 300);
}

/** Read persisted provider profiles (diagnostics + tests). */
export function listProviderProfiles(db: Db): ProviderProfile[] {
  return db
    .all<{ profile_key: string; base_url: string; model: string; capability: string; probed_at: string; detail: string | null }>(
      'select profile_key, base_url, model, capability, probed_at, detail from provider_profiles order by probed_at desc',
    )
    .map((row) => ({
      key: row.profile_key,
      baseUrl: row.base_url,
      model: row.model,
      capability: row.capability as ProviderProfile['capability'],
      probedAt: row.probed_at,
      detail: row.detail,
    }));
}
