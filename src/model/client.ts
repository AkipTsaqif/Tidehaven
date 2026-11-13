import type { Logger } from '../runtime/telemetry.js';

/**
 * Narrow OpenAI-compatible Chat Completions client.
 *
 * Deliberately small: no SDK, no streaming, no tools, no cross-origin redirects, no automatic model
 * switching. It reports exactly what happened (status, latency, bytes, usage, error class) so the
 * runner can decide between retry, repair, fallback, and pausing.
 *
 * Response bodies are read through a hard byte bound: the client stops reading and aborts the
 * connection as soon as the limit is crossed, so an oversized (or endless chunked) provider response
 * can never be buffered into memory first and rejected afterwards. A request timeout bounds time; the
 * byte bound bounds memory.
 */

export type Capability = 'json_schema' | 'json_object' | 'plain_json';

export type ErrorClass =
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'empty'
  | 'truncated'
  | 'refusal'
  | 'too_large'
  | 'unknown';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  maxOutputTokens: number;
  temperature?: number;
  /** JSON Schema for providers that support structured output. */
  schema?: Record<string, unknown>;
  capability: Capability;
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  estimateOnly: boolean;
}

export interface CompletionResult {
  ok: boolean;
  text: string;
  httpStatus: number | null;
  latencyMs: number;
  usage: TokenUsage;
  errorClass: ErrorClass | null;
  detail: string;
  retryAfterMs: number | null;
  finishReason: string | null;
  responseBytes: number;
}

export interface ModelClientOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  maxResponseBytes: number;
  logger: Logger;
}

export function estimateTokens(text: string): number {
  // Conservative: ~4 bytes per token. Always labelled an estimate when the provider omits usage.
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

export interface BoundedBody {
  text: string;
  bytes: number;
  /** True when the body exceeded the bound; the stream was cancelled at the limit. */
  truncated: boolean;
}

/**
 * Read at most `maxBytes` of a response body.
 *
 * The reader is cancelled (and the caller aborts the request) the moment the bound is crossed, so
 * memory use is bounded by `maxBytes` regardless of what the provider sends or how slowly it sends it.
 */
export async function readBoundedBody(response: Response, maxBytes: number, onOverflow?: () => void): Promise<BoundedBody> {
  const bound = Math.max(1, Math.trunc(maxBytes));
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // No stream support (or an empty body): a plain text read is all that is available. It is still
    // checked against the bound before the body is used.
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > bound) {
      onOverflow?.();
      return { text: text.slice(0, bound), bytes: bound, truncated: true };
    }
    return { text, bytes, truncated: false };
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = bound - bytes;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(Buffer.from(value.subarray(0, remaining)));
          bytes += remaining;
        }
        truncated = true;
        onOverflow?.();
        try {
          await reader.cancel('response exceeded the configured byte limit');
        } catch {
          // The connection may already be gone.
        }
        break;
      }
      chunks.push(Buffer.from(value));
      bytes += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes, truncated };
}

export class ModelClient {
  private readonly options: ModelClientOptions;

  constructor(options: ModelClientOptions) {
    this.options = options;
  }

  get endpoint(): string {
    const trimmed = this.options.baseUrl.replace(/\/+$/, '');
    return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const { timeoutMs, maxResponseBytes, model, apiKey, logger } = this.options;
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    request.signal?.addEventListener('abort', onAbort, { once: true });

    const body: Record<string, unknown> = {
      model,
      messages: request.messages,
      max_tokens: request.maxOutputTokens,
      temperature: request.temperature ?? 0.7,
    };
    if (request.capability === 'json_schema' && request.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'resident_plan', strict: true, schema: request.schema },
      };
    } else if (request.capability === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    const payload = JSON.stringify(body);
    const estimatedPrompt = estimateTokens(request.messages.map((m) => m.content).join('\n'));

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: payload,
      });

      let overflow = false;
      const bounded = await readBoundedBody(response, maxResponseBytes, () => {
        overflow = true;
        controller.abort();
      });
      const responseBytes = bounded.bytes;
      const raw = bounded.text;
      const latencyMs = Date.now() - started;

      if (overflow || bounded.truncated) {
        logger.warn('provider response too large', { responseBytes, maxResponseBytes });
        return {
          ok: false,
          text: '',
          httpStatus: response.status,
          latencyMs,
          usage: { promptTokens: estimatedPrompt, completionTokens: 0, estimateOnly: true },
          errorClass: 'too_large',
          detail: `response exceeded ${maxResponseBytes} bytes; reading stopped at the limit`,
          retryAfterMs: null,
          finishReason: null,
          responseBytes,
        };
      }

      if (!response.ok) {
        const errorClass = classifyHttp(response.status);
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        return {
          ok: false,
          text: '',
          httpStatus: response.status,
          latencyMs,
          usage: { promptTokens: estimatedPrompt, completionTokens: 0, estimateOnly: true },
          errorClass,
          detail: summariseError(raw),
          retryAfterMs,
          finishReason: null,
          responseBytes,
        };
      }

      let parsed: {
        choices?: {
          message?: {
            content?: string | null;
            refusal?: string | null;
            reasoning_content?: string | null;
            reasoning?: string | null;
          };
          finish_reason?: string | null;
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        return {
          ok: false,
          text: '',
          httpStatus: response.status,
          latencyMs,
          usage: { promptTokens: estimatedPrompt, completionTokens: 0, estimateOnly: true },
          errorClass: 'unknown',
          detail: 'provider returned a non-JSON body',
          retryAfterMs: null,
          finishReason: null,
          responseBytes,
        };
      }

      const choice = parsed.choices?.[0];
      const content = choice?.message?.content ?? '';
      const finishReason = choice?.finish_reason ?? null;
      const usage: TokenUsage = {
        promptTokens: parsed.usage?.prompt_tokens ?? estimatedPrompt,
        completionTokens: parsed.usage?.completion_tokens ?? estimateTokens(content),
        estimateOnly: parsed.usage?.prompt_tokens === undefined,
      };

      if (choice?.message?.refusal) {
        return {
          ok: false,
          text: '',
          httpStatus: response.status,
          latencyMs,
          usage,
          errorClass: 'refusal',
          detail: choice.message.refusal.slice(0, 200),
          retryAfterMs: null,
          finishReason,
          responseBytes,
        };
      }
      if (content.trim() === '') {
        return {
          ok: false,
          text: '',
          httpStatus: response.status,
          latencyMs,
          usage,
          errorClass: 'empty',
          detail: describeEmpty(choice?.message, finishReason, usage.completionTokens, request.maxOutputTokens),
          retryAfterMs: null,
          finishReason,
          responseBytes,
        };
      }
      if (finishReason === 'length') {
        return {
          ok: false,
          text: content,
          httpStatus: response.status,
          latencyMs,
          usage,
          errorClass: 'truncated',
          detail: 'response hit the output token limit',
          retryAfterMs: null,
          finishReason,
          responseBytes,
        };
      }

      return {
        ok: true,
        text: content,
        httpStatus: response.status,
        latencyMs,
        usage,
        errorClass: null,
        detail: 'ok',
        retryAfterMs: null,
        finishReason,
        responseBytes,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const aborted = controller.signal.aborted;
      const errorClass: ErrorClass = aborted
        ? 'timeout'
        : (err as Error).name === 'TypeError'
          ? 'network'
          : 'unknown';
      return {
        ok: false,
        text: '',
        httpStatus: null,
        latencyMs,
        usage: { promptTokens: estimatedPrompt, completionTokens: 0, estimateOnly: true },
        errorClass,
        detail: aborted ? `request timed out after ${timeoutMs}ms` : (err as Error).message,
        retryAfterMs: null,
        finishReason: null,
        responseBytes: 0,
      };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}

function classifyHttp(status: number): ErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status === 400 || status === 404 || status === 422) return 'bad_request';
  return 'unknown';
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300_000, Math.round(seconds * 1000));
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(300_000, date - Date.now()));
  return null;
}

/**
 * Explain an empty answer. Reasoning models often spend the whole output allowance "thinking" and
 * return no content; saying so (sizes only, never the reasoning text) makes the cause obvious.
 */
function describeEmpty(
  message: { reasoning_content?: string | null; reasoning?: string | null } | undefined,
  finishReason: string | null,
  completionTokens: number,
  maxOutputTokens: number,
): string {
  const reasoning = message?.reasoning_content ?? message?.reasoning ?? '';
  const parts = [`empty message content (finish_reason=${finishReason ?? 'none'}`];
  parts.push(`completion_tokens=${completionTokens}/${maxOutputTokens}`);
  if (reasoning.length > 0) parts.push(`reasoning ${reasoning.length} chars`);
  let detail = `${parts.join(', ')})`;
  if (reasoning.length > 0 && (finishReason === 'length' || completionTokens >= maxOutputTokens)) {
    detail +=
      ': the model spent its whole output allowance on reasoning; raise model.maxOutputTokens or use a non-reasoning model';
  }
  return detail;
}

function summariseError(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return 'empty error body';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string; type?: string } };
    if (parsed.error?.message) return `${parsed.error.type ?? 'error'}: ${parsed.error.message}`.slice(0, 300);
  } catch {
    // fall through to the raw summary
  }
  return trimmed.slice(0, 300);
}
