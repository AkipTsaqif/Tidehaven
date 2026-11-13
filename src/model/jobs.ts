import type { Plan } from '../contracts/actions.js';
import type { ActorPrompt } from './prompts.js';
import type { Capability, ChatMessage, CompletionResult, ErrorClass, ModelClient, TokenUsage } from './client.js';
import { estimateTokens } from './client.js';
import { baselinePlan } from './fallback.js';
import { validatePlanText } from './validate.js';
import { downgrade, readCapability, writeCapability } from './capabilities.js';
import { BudgetExceeded, type UsageTracker } from '../runtime/usage.js';
import { recordAttempt } from '../storage/job-repo.js';
import type { Scenario } from '../contracts/scenario.js';
import type { Db } from '../storage/database.js';
import type { Logger } from '../runtime/telemetry.js';
import type { WorldState } from '../domain/state.js';

/**
 * One decision = one job. Retries, repair, and fallback are bounded here so no single actor can stall
 * a day or spend without limit.
 */

export interface DecisionRequest {
  day: number;
  actorId: number;
  prompt: ActorPrompt;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
  /** Durable job row this decision belongs to; per-attempt audit rows point at it. */
  jobId?: number;
  promptVersion?: string;
  schemaVersion?: number;
}

export interface DecisionOutcome {
  actorId: number;
  plan: Plan;
  source: 'model' | 'fallback';
  summary: string;
  fallbackReason: string | null;
  usage: TokenUsage;
  latencyMs: number;
  errorClass: ErrorClass | null;
  attempts: number;
  capability: Capability | null;
}

export interface DecisionSource {
  readonly mode: 'live' | 'fixture' | 'unavailable';
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
  stats(): {
    inFlight: number;
    terminalFallbacks: number;
    decisions: number;
    lastErrorClass: ErrorClass | null;
    rateLimitedUntil: number | null;
  };
  capability(): Capability | null;
}

/**
 * A source that refuses every decision.
 *
 * Used when a *saved* town exists but no usable provider is configured: the dashboard and status
 * endpoints must stay available (paused for inspection), while simulated time never advances and no
 * request is ever made.
 */
export class DisabledDecisionSource implements DecisionSource {
  readonly mode = 'unavailable' as const;

  decide(): Promise<DecisionOutcome> {
    return Promise.reject(new Error('model provider is not configured; the town is paused'));
  }

  stats() {
    return {
      inFlight: 0,
      terminalFallbacks: 0,
      decisions: 0,
      lastErrorClass: null,
      rateLimitedUntil: null,
    };
  }

  capability(): null {
    return null;
  }
}

export interface ModelSourceDeps {
  db: Db;
  client: ModelClient;
  logger: Logger;
  usage: UsageTracker;
  state: WorldState;
  scenario: Scenario;
  model: string;
  capability: Capability;
  maxDispatches: number;
  /** Hard per-request input budget for the *complete* message list, repairs included. */
  maxInputTokens: number;
  maxOutputTokens: number;
  retryBaseDelayMs: number;
  maxRetryDelayMs: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class ModelDecisionSource implements DecisionSource {
  readonly mode = 'live' as const;
  private currentCapability: Capability;
  private inFlight = 0;
  private terminalFallbacks = 0;
  private decisions = 0;
  private lastErrorClass: ErrorClass | null = null;
  private rateLimitedUntil: number | null = null;
  private readonly deps: ModelSourceDeps;
  private readonly now: () => number;

  constructor(deps: ModelSourceDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.currentCapability =
      readCapability(deps.db, deps.client.endpoint, deps.model) ?? deps.capability;
  }

  capability(): Capability {
    return this.currentCapability;
  }

  stats() {
    return {
      inFlight: this.inFlight,
      terminalFallbacks: this.terminalFallbacks,
      decisions: this.decisions,
      lastErrorClass: this.lastErrorClass,
      rateLimitedUntil: this.rateLimitedUntil,
    };
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.deps.sleep) return this.deps.sleep(ms, signal);
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  async decide(request: DecisionRequest): Promise<DecisionOutcome> {
    this.inFlight += 1;
    this.decisions += 1;
    const started = this.now();
    let attempts = 0;
    let repairUsed = false;
    let provisional: string | null = null;
    let validationDetail = '';
    let usage: TokenUsage = {
      promptTokens: estimateTokens(request.prompt.user),
      completionTokens: 0,
      estimateOnly: true,
    };
    let errorClass: ErrorClass | null = null;
    /** Human-readable cause of the most recent failed attempt, for the fallback log line. */
    let lastDetail = 'no attempt completed';

    try {
      while (attempts < this.deps.maxDispatches) {
        attempts += 1;

        // Bound the *complete* message list (system, original prompt, and any repair turn) before the
        // request is reserved or dispatched. Token counts are estimates by contract, never a claim
        // about the provider's tokenizer.
        const messages = boundMessages(
          provisional === null
            ? [
                { role: 'system' as const, content: request.prompt.system },
                { role: 'user' as const, content: request.prompt.user },
              ]
            : [
                { role: 'system' as const, content: request.prompt.system },
                { role: 'user' as const, content: request.prompt.user },
                {
                  role: 'assistant' as const,
                  content: provisional.slice(0, 2_000),
                },
                {
                  role: 'user' as const,
                  content:
                    'That answer was rejected by the town clerk: ' +
                    `${validationDetail}. Reply again with a single valid JSON object for the schema.`,
                },
              ],
          this.deps.maxInputTokens,
        );
        const requestTokens = estimateTokens(messages.map((message) => message.content).join('\n'));

        // Durable reservation *before* the billable dispatch. Concurrent callers are serialised by the
        // transaction, so they cannot both pass the same remaining allowance.
        const reservation = this.deps.usage.reserve({
          promptTokens: requestTokens,
          maxOutputTokens: this.deps.maxOutputTokens,
        });

        let result: CompletionResult;
        try {
          result = await this.deps.client.complete({
            messages,
            maxOutputTokens: this.deps.maxOutputTokens,
            schema: request.schema,
            capability: this.currentCapability,
            signal: request.signal,
          });
        } catch (err) {
          // A dispatch that threw may already have been billable. Settle at the *reserved* ceiling
          // (input estimate plus the maximum output allowance) rather than quietly releasing it.
          this.deps.usage.settle(reservation, {
            promptTokens: requestTokens,
            completionTokens: this.deps.maxOutputTokens,
            estimateOnly: true,
          });
          throw err;
        }
        usage = result.usage;
        this.deps.usage.settle(reservation, unsettledUsage(result, requestTokens, this.deps.maxOutputTokens));
        this.recordAttemptRow(request, attempts, result, messages, requestTokens);

        if (result.ok) {
          const validation = validatePlanText(result.text);
          if (validation.ok) {
            this.lastErrorClass = null;
            return {
              actorId: request.actorId,
              plan: validation.plan,
              source: 'model',
              summary: validation.plan.summary,
              fallbackReason: null,
              usage,
              latencyMs: this.now() - started,
              errorClass: null,
              attempts,
              capability: this.currentCapability,
            };
          }
          provisional = result.text;
          validationDetail = validation.detail ?? validation.reason ?? 'schema_mismatch';
          errorClass = null;
          lastDetail = `invalid output: ${validationDetail}`;
          this.deps.logger.warn('model output rejected', {
            actorId: request.actorId,
            day: request.day,
            attempt: attempts,
            capability: this.currentCapability,
            finishReason: result.finishReason,
            detail: validationDetail.slice(0, 300),
          });
          if (this.currentCapability !== 'plain_json') {
            this.tryDowngrade('invalid output under structured mode');
            continue;
          }
          if (repairUsed) break;
          repairUsed = true;
          continue;
        }

        errorClass = result.errorClass;
        this.lastErrorClass = result.errorClass;
        lastDetail = result.detail;
        this.deps.logger.warn('provider attempt failed', {
          actorId: request.actorId,
          day: request.day,
          attempt: attempts,
          errorClass: result.errorClass,
          httpStatus: result.httpStatus,
          finishReason: result.finishReason,
          latencyMs: result.latencyMs,
          completionTokens: result.usage.completionTokens,
          capability: this.currentCapability,
          detail: result.detail,
        });
        if (request.signal?.aborted) break;
        if (result.errorClass === 'auth') break;
        if (result.errorClass === 'bad_request') {
          if (!this.tryDowngrade(result.detail)) break;
          continue;
        }
        if (result.errorClass === 'rate_limit') {
          const wait =
            result.retryAfterMs ?? Math.min(this.deps.maxRetryDelayMs, this.deps.retryBaseDelayMs * 2 ** attempts);
          this.rateLimitedUntil = this.now() + wait;
          this.deps.logger.warn('rate limited', { waitMs: wait, attempts });
          await this.sleep(wait, request.signal);
          if (request.signal?.aborted) break;
          continue;
        }
        if (result.errorClass === 'server' || result.errorClass === 'timeout' || result.errorClass === 'network') {
          const wait = Math.min(this.deps.maxRetryDelayMs, this.deps.retryBaseDelayMs * 2 ** (attempts - 1));
          this.deps.logger.warn('provider retry', { errorClass: result.errorClass, waitMs: wait, attempts });
          await this.sleep(wait, request.signal);
          if (request.signal?.aborted) break;
          continue;
        }
        break;
      }

      // Exhausted: deterministic safe baseline. Recorded so the dashboard shows who used it and why.
      this.terminalFallbacks += 1;
      this.deps.logger.warn('decision fell back to baseline', {
        actorId: request.actorId,
        day: request.day,
        attempts,
        errorClass: errorClass ?? 'invalid_output',
        detail: lastDetail.slice(0, 300),
      });
      const resident = this.deps.state.residents.get(request.actorId);
      if (!resident) throw new Error(`unknown resident ${request.actorId}`);
      const fallback = baselinePlan({
        state: this.deps.state,
        scenario: this.deps.scenario,
        resident,
        day: request.day,
        reason: errorClass ?? 'invalid_output',
      });
      return {
        actorId: request.actorId,
        plan: fallback.plan,
        source: 'fallback',
        summary: fallback.summary,
        fallbackReason: fallback.fallbackReason ?? 'invalid_output',
        usage,
        latencyMs: this.now() - started,
        errorClass,
        attempts,
        capability: this.currentCapability,
      };
    } catch (err) {
      if (err instanceof BudgetExceeded) throw err;
      this.deps.logger.warn('decision threw; using fallback', { err: (err as Error).message, actorId: request.actorId });
      this.terminalFallbacks += 1;
      this.lastErrorClass = 'unknown';
      const resident = this.deps.state.residents.get(request.actorId);
      if (!resident) throw err;
      const fallback = baselinePlan({
        state: this.deps.state,
        scenario: this.deps.scenario,
        resident,
        day: request.day,
        reason: (err as Error).message.slice(0, 120),
      });
      return {
        actorId: request.actorId,
        plan: fallback.plan,
        source: 'fallback',
        summary: fallback.summary,
        fallbackReason: `exception: ${(err as Error).message.slice(0, 120)}`,
        usage,
        latencyMs: this.now() - started,
        errorClass: 'unknown',
        attempts,
        capability: this.currentCapability,
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  /** One audit row per actual dispatch, including retries, repairs, and capability downgrades. */
  private recordAttemptRow(
    request: DecisionRequest,
    attemptNo: number,
    result: CompletionResult,
    messages: ChatMessage[],
    requestTokens: number,
  ): void {
    if (request.jobId === undefined) return;
    try {
      recordAttempt(this.deps.db, {
        jobId: request.jobId,
        attemptNo,
        status: result.ok ? 'ok' : 'failed',
        httpStatus: result.httpStatus,
        latencyMs: result.latencyMs,
        requestBytes: messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0),
        responseBytes: result.responseBytes,
        promptTokens: result.usage.promptTokens ?? requestTokens,
        completionTokens: result.usage.completionTokens,
        errorClass: result.errorClass,
        capability: this.currentCapability,
        model: this.deps.model,
        promptVersion: request.promptVersion ?? null,
        schemaVersion: request.schemaVersion ?? null,
      });
    } catch (err) {
      // An audit failure must never turn a usable answer into a lost day.
      this.deps.logger.warn('attempt audit failed', { err: (err as Error).message });
    }
  }

  private tryDowngrade(detail: string): boolean {
    const next = downgrade(this.currentCapability);
    if (next === null) return false;
    this.deps.logger.warn('downgrading provider capability', {
      from: this.currentCapability,
      to: next,
      detail: detail.slice(0, 160),
    });
    this.currentCapability = next;
    writeCapability(this.deps.db, {
      baseUrl: this.deps.client.endpoint,
      model: this.deps.model,
      capability: next,
      detail,
    });
    return true;
  }
}

/**
 * What to book for a dispatch whose outcome is uncertain.
 *
 * A timeout, cancellation, transport failure, server error, or oversized response can still have cost
 * the operator input *and* generated output. Those settle at the reserved ceiling (input estimate plus
 * the maximum output allowance). Only an explicit rejection (auth, bad request, rate limit) and a
 * provider-reported usage settle to the smaller figure.
 */
function unsettledUsage(
  result: CompletionResult,
  requestTokens: number,
  maxOutputTokens: number,
): { promptTokens: number; completionTokens: number; estimateOnly: boolean } {
  if (result.ok) return result.usage;
  const uncertain: ReadonlySet<string> = new Set(['timeout', 'network', 'server', 'unknown', 'too_large']);
  if (!uncertain.has(result.errorClass ?? 'unknown')) return result.usage;
  return {
    promptTokens: Math.max(requestTokens, result.usage.promptTokens),
    completionTokens: maxOutputTokens,
    estimateOnly: true,
  };
}

/**
 * Enforce the configured input-token bound on a complete message list.
 *
 * The budget is applied newest-first so a repair instruction and the tail of the current prompt
 * survive longest; the system message is preserved because it carries the behavioural contract. The
 * resulting counts are *estimates* (any honest implementation relies on the provider's own tokenizer),
 * and the usage record is labelled as such.
 */
export function boundMessages(messages: ChatMessage[], maxInputTokens: number): ChatMessage[] {
  const budget = Math.max(64, Math.trunc(maxInputTokens));
  const total = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  if (total <= budget) return messages;

  const system = messages[0]?.role === 'system' ? messages[0] : null;
  const rest = system === null ? messages : messages.slice(1);
  const systemCost = system === null ? 0 : estimateTokens(system.content);
  let remaining = Math.max(0, budget - systemCost);

  // Allocate from the end (newest instruction first).
  const allocated = new Array<number>(rest.length).fill(0);
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const content = rest[index]?.content ?? '';
    const cost = estimateTokens(content);
    const share = Math.min(cost, remaining);
    allocated[index] = share;
    remaining -= share;
  }

  const bounded = rest.map((message, index) => ({
    role: message.role,
    content: truncateToTokens(message.content, allocated[index] ?? 0),
  }));
  return system === null ? bounded : [system, ...bounded];
}

function truncateToTokens(content: string, tokens: number): string {
  if (tokens <= 0) return '';
  const maxBytes = tokens * 4;
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content;
  // Cut on a byte boundary that never splits a UTF-8 sequence.
  const buffer = Buffer.from(content, 'utf8').subarray(0, Math.max(0, maxBytes - 24));
  let text = buffer.toString('utf8');
  if (text.endsWith('\uFFFD')) text = text.slice(0, -1);
  return `${text}\n[truncated to fit the configured input token budget]`;
}
