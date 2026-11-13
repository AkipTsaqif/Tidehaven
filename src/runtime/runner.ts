import { statfsSync } from 'node:fs';
import type { AppConfig } from '../config.js';
import type { PauseReason, UsageSnapshot } from '../contracts/api.js';
import type { Scenario } from '../contracts/scenario.js';
import { adoptState, cloneState, population, type Resident, type WorldState } from '../domain/state.js';
import { hashValue, stateHash as computeStateHash, turnInputHash } from '../domain/hash.js';
import { runDay, type DayResult } from '../domain/turn-engine.js';
import { isAdult } from '../domain/clock.js';
import { baselinePlan } from '../model/fallback.js';
import type { DecisionOutcome, DecisionSource } from '../model/jobs.js';
import type { ActorPrompt, PromptEvent } from '../model/prompts.js';
import { buildActorPrompt } from '../model/prompts.js';
import { planJsonSchema, type ActorPlan } from '../contracts/actions.js';
import type { Db } from '../storage/database.js';
import {
  countJobsByStatus,
  findJob,
  getOpenTurn,
  listJobs,
  markTurnReady,
  reconcileTurns,
  startTurn,
  upsertJob,
  type TurnRow,
} from '../storage/job-repo.js';
import { completeCommand, pendingCommands, type OperatorCommand } from '../storage/commands-repo.js';
import { readRunFlag, saveState, writeRunFlag, type SavePayload, type WorldRow } from '../storage/repositories.js';
import { writeCheckpoint } from '../storage/checkpoints.js';
import { dataTreeBytes, runRetention, storageBudgetExceeded } from '../application/retention.js';
import { createBackup } from '../storage/backup.js';
import { crashPoint } from './crash.js';
import { TaskPool, QueueFullError } from './pool.js';
import { UsageTracker, BudgetExceeded } from './usage.js';
import { buildNewspaperDigest } from '../application/newspaper.js';
import { memoriesFor, promptEventsFor } from '../application/observations.js';
import { writePauseFile, writeWorldMirror } from '../application/status.js';
import type { Logger } from './telemetry.js';

/**
 * The continuous runner: one day at a time, sequentially, with bounded concurrency inside the day.
 *
 * Crash safety comes from the turn/job state machine: a `collecting` turn re-requests only the missing
 * jobs, a `ready` turn is applied without any model call, and a committed day is never repeated.
 */

export interface RunnerSnapshot {
  running: boolean;
  paused: { reason: PauseReason; detail: string } | null;
  day: number;
  phase: string;
  inFlightRequests: number;
  queueDepth: number;
  jobsPending: number;
  daysCommitted: number;
  daysPerHour: number | null;
  fallbackRateBps: number;
  lastDayDurationMs: number | null;
  usage: UsageSnapshot;
  invariantsOk: boolean;
  invariantsDetail: string | null;
  startedAt: string | null;
}

export interface RunnerDeps {
  config: AppConfig;
  logger: Logger;
  db: Db;
  world: WorldRow;
  state: WorldState;
  scenario: Scenario;
  source: DecisionSource;
  now?: () => number;
  onDayCommitted?: (info: { day: number; durationMs: number; metrics: Record<string, unknown> }) => void;
  onSnapshot?: () => void;
  /** Injected sleeps in tests to keep the loop fast and deterministic. */
  sleep?: (ms: number) => Promise<void>;
}

const CHECKPOINT_KEY = 'lastCheckpointDay';
const BACKUP_KEY = 'lastBackupDay';

export class Runner {
  private readonly deps: RunnerDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private state: WorldState;
  private pool: TaskPool;
  private usage: UsageTracker;
  private running = false;
  private paused: { reason: PauseReason; detail: string } | null = null;
  private stopping = false;
  private stopReason: PauseReason | null = null;
  private decisions = 0;
  private fallbacks = 0;
  /** Why decisions fell back since the last resume, so a provider_down pause can name the cause. */
  private fallbackCauses = new Map<string, number>();
  private dayDurations: number[] = [];
  private lastDayDurationMs: number | null = null;
  private invariantsOk = true;
  private invariantsDetail: string | null = null;
  private startedAt: string | null = null;
  private currentPhase = 'idle';
  private jobsPending = 0;
  private lastCommittedDay: number;
  /** Cancels in-flight provider work (and retry waits) when shutdown or a pause begins. */
  private abortController = new AbortController();
  private resourcesClosed = false;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
    this.state = deps.state;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.lastCommittedDay = deps.state.day;
    // A new runner starts unpaused; a pause.json left by the previous process would otherwise keep
    // showing a stale reason on the dashboard while time is actually advancing again.
    writePauseFile(deps.config, null);
    // Close any turn the world already committed past, so a restart never re-resolves a saved day.
    const reconciled = reconcileTurns(deps.db, deps.world.id, deps.state.day);
    if (reconciled > 0) {
      deps.logger.warn('reconciled turns left open by an interrupted commit', { count: reconciled });
    }
    this.pool = new TaskPool({
      limit: deps.config.defaults.model.concurrency,
      capacity: deps.config.defaults.model.queueCapacity,
      logger: deps.logger,
    });
    this.usage = new UsageTracker({
      db: deps.db,
      worldId: deps.world.id,
      ceilings: deps.config.defaults.ceilings,
      logger: deps.logger,
    });
  }

  getState(): WorldState {
    return this.state;
  }

  /**
   * Mark the runner's database/lock as closed.
   *
   * Shutdown closes the database after the drain budget expires, which can happen while a provider
   * request is still outstanding. Late results are then fenced instead of writing against a closed
   * handle.
   */
  markResourcesClosed(): void {
    this.resourcesClosed = true;
  }

  /** The signal every model dispatch, retry wait, and HTTP read is fenced by. */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Abort in-flight provider requests immediately, then install a fresh controller so a later resume
   * can dispatch again. Callers holding the previous signal observe the abort exactly once.
   */
  cancelInFlight(reason: string): void {
    const previous = this.abortController;
    this.abortController = new AbortController();
    if (!previous.signal.aborted) {
      this.deps.logger.debug('cancelling in-flight model requests', { reason });
      previous.abort();
    }
  }

  snapshot(): RunnerSnapshot {
    const pool = this.pool.stats();
    const usage = this.usage.snapshot();
    return {
      running: this.running,
      paused: this.paused,
      day: this.state.day,
      phase: this.currentPhase,
      inFlightRequests: pool.active,
      queueDepth: pool.queued,
      jobsPending: this.jobsPending,
      daysCommitted: this.lastCommittedDay,
      daysPerHour: this.computeDaysPerHour(),
      fallbackRateBps: this.decisions === 0 ? 0 : Math.floor((this.fallbacks * 10_000) / this.decisions),
      lastDayDurationMs: this.lastDayDurationMs,
      usage: {
        requestsToday: usage.requestsToday,
        tokensToday: usage.tokensToday,
        requestsThisMonth: usage.requestsThisMonth,
        tokensThisMonth: usage.tokensThisMonth,
        estimateOnly: usage.estimateOnly,
        ceilings: {
          dailyTokens: this.deps.config.defaults.ceilings.dailyTokens,
          monthlyTokens: this.deps.config.defaults.ceilings.monthlyTokens,
          dailyRequests: this.deps.config.defaults.ceilings.dailyRequests,
          monthlyRequests: this.deps.config.defaults.ceilings.monthlyRequests,
        },
      },
      invariantsOk: this.invariantsOk,
      invariantsDetail: this.invariantsDetail,
      startedAt: this.startedAt,
    };
  }

  private computeDaysPerHour(): number | null {
    if (this.dayDurations.length < 3) return null;
    const recent = this.dayDurations.slice(-20);
    const total = recent.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    return Math.round((recent.length * 3_600_000) / total);
  }

  pause(reason: PauseReason, detail: string): void {
    if (this.paused) return;
    this.paused = { reason, detail };
    // A pause freezes time, so nothing further should be spent on the current day's requests.
    this.cancelInFlight(`pause:${reason}`);
    this.deps.logger.warn('simulation paused', { reason, detail, day: this.state.day });
    writePauseFile(this.deps.config, {
      reason,
      detail,
      sinceDay: this.state.day,
      at: new Date(this.now()).toISOString(),
    });
    this.deps.onSnapshot?.();
  }

  resume(): boolean {
    if (!this.paused) return false;
    this.paused = null;
    this.decisions = 0;
    this.fallbacks = 0;
    this.fallbackCauses.clear();
    writePauseFile(this.deps.config, null);
    this.deps.logger.info('simulation resumed', { day: this.state.day });
    this.deps.onSnapshot?.();
    return true;
  }

  requestStop(reason: PauseReason = 'shutdown'): void {
    this.stopping = true;
    this.stopReason = reason;
    this.cancelInFlight(reason);
  }

  /** Main loop. Returns when the runner has been asked to stop. */
  async run(): Promise<void> {
    this.running = true;
    this.startedAt = new Date(this.now()).toISOString();
    this.deps.logger.info('runner started', { worldId: this.deps.world.id, day: this.state.day });
    try {
      while (!this.stopping) {
        if (this.paused) {
          await this.sleep(200);
          continue;
        }
        let keepGoing = true;
        try {
          keepGoing = await this.runOneDay();
        } catch (err) {
          this.deps.logger.error('day failed', { err, day: this.state.day });
          this.pause('engine_error', `Unhandled engine error: ${(err as Error).message}`);
          keepGoing = true;
        }
        if (!keepGoing) break;
        // Yield so HTTP handlers, signals, and the dashboard stay responsive between days.
        await this.sleep(0);
      }
    } finally {
      this.running = false;
      this.currentPhase = 'stopped';
      this.deps.logger.info('runner stopped', { reason: this.stopReason, day: this.state.day });
    }
  }

  async shutdown(): Promise<void> {
    this.requestStop('shutdown');
    await this.pool.stop('shutdown');
  }

  private async runOneDay(): Promise<boolean> {
    const day = this.state.day + 1;
    const started = this.now();
    this.currentPhase = 'schedule';

    // Storage headroom is checked *before* paid collection and before any database write. The guard
    // reserves bounded normal-turn growth plus recovery headroom, so a run near the budget cannot
    // spend its way past the limit and then discover it after the model calls are already billed.
    if (!this.checkStorageHeadroom()) return true;

    // Operator commands are collected before resolution and only published with the day they affect.
    // They are applied to the staged copy, so a day that never commits cannot leave their effects in
    // the live (committed) state.
    const staged = cloneState(this.state);
    const commands = pendingCommands(this.deps.db, this.state.worldId);
    const applied = this.applyOperatorCommands(commands, day, staged);
    if (!applied.advance) {
      // A command asked us to stop advancing time (pause/resume handled by callers).
      if (this.stopping) return false;
      if (this.paused) return true;
    }
    if (this.paused) return true;

    const stateHashBefore = computeStateHash(staged);
    const inputHash = turnInputHash({
      worldId: staged.worldId,
      day,
      rulesVersion: staged.rulesVersion,
      stateHash: stateHashBefore,
      settingsHash: hashValue({
        target: staged.populationTarget,
        populationPolicyEnabled: staged.populationPolicyEnabled,
        drama: staged.drama,
        policies: Object.fromEntries(staged.policies),
      }),
    });

    const turn = this.resumeOrStartTurn(day, inputHash, stateHashBefore);
    this.deps.logger.debug('turn opened', { day, turnId: turn.id, status: turn.status });

    // Resolution runs against the detached staged copy. Authoritative state is only replaced by the
    // staged copy after the day has been committed, so an exception, invariant failure, or database
    // error can never leave half-advanced state behind for the dashboard or the next day.
    const plans = await this.collectPlans(day, turn);
    if (this.paused || this.stopping) return !this.stopping;
    crashPoint('after_collection');

    markTurnReady(this.deps.db, turn.id);
    crashPoint('turn_ready');

    this.currentPhase = 'resolve';
    let result: DayResult;
    try {
      result = runDay({
        state: staged,
        scenario: this.deps.scenario,
        day,
        plans,
      });
    } catch (err) {
      this.deps.logger.error('engine threw', { err, day });
      this.pause('engine_error', `Engine error on day ${day}: ${(err as Error).message}`);
      return true;
    }

    this.invariantsOk = result.invariants.ok;
    this.invariantsDetail = result.invariants.ok
      ? null
      : result.invariants.violations.slice(0, 3).map((v) => `${v.code}: ${v.detail}`).join('; ');

    if (!result.invariants.ok) {
      this.deps.logger.error('invariant failure', {
        day,
        violations: result.invariants.violations.slice(0, 10),
      });
      this.pause('invariant_failure', this.invariantsDetail ?? 'invariant violation');
      return true;
    }

    // Population safety guards are enforced at the runtime boundary, not merely recorded as a counter
    // inside the resolver. The day that trips the guard is not committed at all.
    const populationPause = this.populationGuard(staged);
    if (populationPause !== null) {
      this.pause(populationPause.reason, populationPause.detail);
      return true;
    }

    // Presentation content is derived only from this day's committed events.
    const article = buildNewspaperDigest(result.ctx, result.ctx.events);
    const stateHashAfter = computeStateHash(staged);
    const durationMs = this.now() - started;

    const payload: SavePayload = {
      events: result.ctx.events,
      ledger: result.ctx.ledger,
      flows: result.ctx.flows,
      observations: result.ctx.observations,
      memories: result.ctx.memories,
      taxRecords: result.ctx.taxRecords,
      shipping: result.ctx.shipping,
      articles: [article],
      metrics: { day, metrics: { ...result.metrics, durationMs }, stateHash: stateHashAfter },
      phase: 'committed',
      stateHash: stateHashAfter,
      turnId: turn.id,
      turnMetrics: result.metrics,
      turnDurationMs: durationMs,
      // Only commands whose effects live in this day's staged state are committed here; pause/resume
      // were recorded immediately (they have no authoritative boundary effect).
      commandIds: applied.deferredIds,
    };

    crashPoint('before_commit');
    try {
      // One transaction: authoritative state, its turn lifecycle, and the command dispositions that
      // shaped it become durable together or not at all.
      saveState(this.deps.db, staged, payload);
    } catch (err) {
      this.deps.logger.error('commit failed', { err, day });
      this.pause('engine_error', `Day ${day} could not be committed: ${(err as Error).message}`);
      return true;
    }
    crashPoint('after_commit');

    // Publish in place: every holder of the state reference (decision source, status routes, the
    // dashboard mirror) now sees the committed day, and nothing saw the staged copy before this point.
    adoptState(this.state, staged);
    this.lastCommittedDay = day;
    this.lastDayDurationMs = durationMs;
    this.dayDurations.push(durationMs);
    if (this.dayDurations.length > 200) this.dayDurations.shift();
    writeWorldMirror(this.deps.config, this.state, stateHashAfter);
    this.deps.onDayCommitted?.({ day, durationMs, metrics: result.metrics });
    this.deps.onSnapshot?.();

    // Periodic durable artefacts.
    await this.maybeCheckpoint(day);
    await this.maybeBackup(day);

    // Post-day guards: these pause *after* the day is safely committed.
    if (!this.checkProviderHealth()) return true;
    if (!this.checkStorage()) return true;
    this.currentPhase = 'committed';
    return true;
  }

  /**
   * Explicit runtime consumer for the domain's population safety requests.
   *
   * The resolver refuses to create a household that cannot be housed and records why; the runner turns
   * that into a visible pause with committed time frozen and the correct reason.
   */
  private populationGuard(state: WorldState): { reason: PauseReason; detail: string } | null {
    const living = population(state);
    if (living >= state.hostCeiling) {
      return {
        reason: 'population_ceiling',
        detail:
          `The town reached its host safety ceiling (${living} of ${state.hostCeiling} residents). ` +
          'Simulated time is frozen; lower the target or raise the ceiling.',
      };
    }
    if (living === 0 && state.populationPolicyEnabled && state.populationTarget <= 0) {
      return {
        reason: 'town_empty',
        detail: 'No residents remain and immigration is not permitted at a population target of zero.',
      };
    }
    return null;
  }

  private resumeOrStartTurn(day: number, inputHash: string, stateHashBefore: string): TurnRow & { phase: string } {
    // Any turn older than the committed day is stale (an interrupted commit, or a crash after the world
    // advanced): close it before opening the next one, so restart never leaves it dangling.
    reconcileTurns(this.deps.db, this.state.worldId, this.state.day);
    const open = getOpenTurn(this.deps.db, this.state.worldId);
    if (open && open.day === day && open.status !== 'committed') return open;
    const turnId = startTurn(this.deps.db, {
      worldId: this.state.worldId,
      day,
      inputHash,
      stateHashBefore,
      prepared: { day, target: this.state.populationTarget, drama: this.state.drama },
      schemaVersion: 3,
      rulesVersion: this.state.rulesVersion,
    });
    const created = getOpenTurn(this.deps.db, this.state.worldId);
    if (created && created.id === turnId) return created;
    return {
      id: turnId,
      day,
      phase: 'collecting',
      status: 'collecting',
      inputHash,
      preparedJson: null,
      stateHashBefore,
      stateHashAfter: null,
      startedAt: new Date().toISOString(),
      committedAt: null,
      durationMs: null,
      metricsJson: null,
    };
  }

  private eligibleActors(): number[] {
    return [...this.state.residents.values()]
      .filter((r) => r.status === 'living' && isAdult(r.bornDay, this.state.day + 1, this.deps.scenario.calendar))
      .filter((r) => !r.deathDay)
      .sort((a, b) => a.id - b.id)
      .map((r) => r.id);
  }

  /**
   * Collect one decision per eligible actor.
   *
   * Every actor's job is submitted to the bounded pool *before* any result is awaited, so the whole
   * phase runs at the configured concurrency instead of one resident at a time. The pool still caps
   * active requests, queue length, and total submissions, so a large population cannot fan out
   * without bound. The phase then joins on a barrier: phase ordering stays deterministic because
   * resolution never observes completion order.
   */
  private async collectPlans(day: number, turn: TurnRow): Promise<Map<number, ActorPlan>> {
    const plans = new Map<number, ActorPlan>();
    const actors = this.eligibleActors();
    this.jobsPending = actors.length;
    this.currentPhase = 'collect';

    // Reuse accepted results from an interrupted turn.
    const existingJobs = new Map(listJobs(this.deps.db, this.state.worldId, day).map((job) => [job.actorId, job]));
    const schema = planJsonSchema();
    const promptEvents = promptEventsFor(this.deps.db, this.state.worldId, day);
    const phase = turn.status === 'ready' ? 'resolve' : 'collect';

    /** Results are applied in actor order after the barrier, never in completion order. */
    const outcomes = new Map<number, DecisionOutcome>();
    const failures = new Map<number, Error>();
    const pending: { actorId: number; resident: Resident }[] = [];
    /**
     * Sliding submission window.
     *
     * Submitting the whole population at once overflows the pool's queue (active + queued capacity),
     * and every rejected submission silently becomes a fallback — so adults near the ceiling never get
     * a model opportunity. The window keeps at most the pool's total capacity outstanding, so every
     * eligible actor is fed in as slots free up without exceeding the queue.
     */
    const window = Math.max(1, this.pool.stats().limit + this.pool.stats().capacity);
    let inFlight = 0;
    const slots = new Set<Promise<void>>();
    const awaitSlot = async (): Promise<void> => {
      if (inFlight < window) return;
      await Promise.race(slots);
    };

    for (const actorId of actors) {
      const existing = existingJobs.get(actorId);
      if (existing && existing.status === 'done' && existing.resultJson !== null) {
        try {
          const parsed = JSON.parse(existing.resultJson) as ActorPlan;
          plans.set(actorId, parsed);
          this.jobsPending -= 1;
          continue;
        } catch {
          // fall through and re-request
        }
      }
      if (existing && existing.status === 'fallback' && existing.resultJson !== null) {
        try {
          const parsed = JSON.parse(existing.resultJson) as ActorPlan;
          plans.set(actorId, { ...parsed, source: 'fallback' });
          this.jobsPending -= 1;
          continue;
        } catch {
          // fall through
        }
      }

      const resident = this.state.residents.get(actorId);
      if (!resident) continue;
      const prompt = this.buildPrompt(resident, day, promptEvents);
      const jobId = upsertJob(this.deps.db, {
        worldId: this.state.worldId,
        day,
        phase,
        actorId,
        jobKind: 'plan',
        status: 'running',
        request: { promptVersion: prompt.promptVersion, bytes: prompt.bytes },
      });

      await awaitSlot();
      const promise: Promise<void> = this.pool
        .run(() =>
          this.deps.source.decide({
            day,
            actorId,
            prompt,
            schema,
            signal: this.signal,
            jobId,
            promptVersion: prompt.promptVersion,
          }),
        )
        .then(
          (outcome) => {
            outcomes.set(actorId, outcome);
          },
          (err: unknown) => {
            failures.set(actorId, err instanceof Error ? err : new Error(String(err)));
          },
        )
        .finally(() => {
          this.jobsPending = Math.max(0, this.jobsPending - 1);
          inFlight -= 1;
          slots.delete(promise);
        });
      inFlight += 1;
      slots.add(promise);
      pending.push({ actorId, resident });
    }

    // Phase barrier: wait for every submitted decision before resolving anything.
    await Promise.all([...slots]);
    if (this.paused || this.stopping) return plans;

    for (const { actorId, resident } of pending) {
      const outcome = outcomes.get(actorId);
      if (outcome !== undefined) {
        this.recordOutcome(day, phase, actorId, outcome);
        plans.set(actorId, {
          actorId,
          plan: outcome.plan,
          source: outcome.source,
          fallbackReason: outcome.fallbackReason ?? undefined,
          summary: outcome.summary,
        });
        continue;
      }
      const err = failures.get(actorId) ?? new Error('decision did not complete');
      if (err instanceof BudgetExceeded) {
        this.pause('quota', `${err.message}; no further requests will be made until you resume.`);
        return plans;
      }
      this.degradeToFallback(day, phase, actorId, resident, err);
    }

    this.currentPhase = 'dialogue';
    await this.runDialogue(day, plans, schema);

    // Provider-wide failure detection happens at the day boundary, not mid-day.
    if (this.deps.source.stats().lastErrorClass === 'auth') {
      this.pause('authentication', 'The provider rejected the API key (401/403).');
    }
    return plans;
  }

  /** Deterministic safe baseline for one actor, recorded so the dashboard shows who and why. */
  private degradeToFallback(day: number, phase: string, actorId: number, resident: Resident, err: Error): void {
    if (this.resourcesClosed) return;
    const reason = err instanceof QueueFullError ? 'queue_full' : 'decision_error';
    if (!(err instanceof QueueFullError)) {
      this.deps.logger.warn('decision failed', { actorId, err: err.message });
    }
    const fallback = baselinePlan({
      state: this.state,
      scenario: this.deps.scenario,
      resident,
      day,
      reason,
    });
    // A queue-full fallback is a local capacity artefact, not provider ill health: counting it would
    // dilute the fallback rate and could trigger a spurious `provider_down` pause.
    if (reason !== 'queue_full') {
      this.fallbacks += 1;
      this.countFallbackCause(reason);
    }
    upsertJob(this.deps.db, {
      worldId: this.state.worldId,
      day,
      phase,
      actorId,
      jobKind: 'plan',
      status: 'fallback',
      fallbackReason: reason,
      result: fallback,
    });
  }

  private recordOutcome(day: number, phase: string, actorId: number, outcome: DecisionOutcome): void {
    if (this.resourcesClosed) return;
    this.decisions += 1;
    if (outcome.source === 'fallback') {
      this.fallbacks += 1;
      this.countFallbackCause(outcome.errorClass ?? outcome.fallbackReason ?? 'unknown');
    }
    upsertJob(this.deps.db, {
      worldId: this.state.worldId,
      day,
      phase,
      actorId,
      jobKind: 'plan',
      status: outcome.source === 'fallback' ? 'fallback' : 'done',
      result: {
        actorId,
        plan: outcome.plan,
        source: outcome.source,
        fallbackReason: outcome.fallbackReason ?? undefined,
        summary: outcome.summary,
      },
      fallbackReason: outcome.fallbackReason,
      errorClass: outcome.errorClass,
      latencyMs: outcome.latencyMs,
      promptTokens: outcome.usage.promptTokens,
      completionTokens: outcome.usage.completionTokens,
      attempts: outcome.attempts,
    });
  }

  /** Reciprocal dialogue: at most N conversations, 2 rounds, each reply a bounded model job. */
  private async runDialogue(day: number, plans: Map<number, ActorPlan>, schema: Record<string, unknown>): Promise<void> {
    const rounds = this.deps.config.defaults.model.dialogueRounds;
    const maxConversations = this.deps.config.defaults.model.conversationsPerDay;
    if (rounds <= 0 || maxConversations <= 0) return;

    const candidates: { from: number; to: number; kind: string }[] = [];
    for (const [actorId, actorPlan] of plans) {
      const social = actorPlan.plan.social;
      if (!social || social.targetId === null || social.targetId === undefined) continue;
      if (!['courtship', 'affair', 'conceive'].includes(social.kind)) continue;
      const target = state_get(this.state, social.targetId);
      if (!target || target.status !== 'living') continue;
      candidates.push({ from: actorId, to: social.targetId, kind: social.kind });
      if (candidates.length >= maxConversations) break;
    }
    if (candidates.length === 0) return;

    for (const conversation of candidates) {
      const targetPlan = plans.get(conversation.to);
      const alreadyAnswered = targetPlan?.plan.social;
      if (alreadyAnswered && alreadyAnswered.targetId === conversation.from) continue;
      const targetResident = state_get(this.state, conversation.to);
      if (!targetResident) continue;
      const prompt = this.buildPrompt(targetResident, day, promptEventsFor(this.deps.db, this.state.worldId, day));
      const fromResident = state_get(this.state, conversation.from);
      const dialoguePrompt: ActorPrompt = {
        ...prompt,
        user:
          `${prompt.user}\n\nA MESSAGE FROM ${fromResident?.name ?? 'a resident'} (id ${conversation.from}): ` +
          `they propose ${conversation.kind}.\n` +
          `Answer with a JSON plan whose social action is either {"kind":"accept","targetId":${conversation.from}} ` +
          `or {"kind":"refuse","targetId":${conversation.from}}.`,
      };
      const dialogueJobId = upsertJob(this.deps.db, {
        worldId: this.state.worldId,
        day,
        phase: 'dialogue',
        actorId: conversation.to,
        jobKind: 'dialogue',
        status: 'running',
        request: { promptVersion: dialoguePrompt.promptVersion, bytes: dialoguePrompt.bytes },
      });
      let reply: DecisionOutcome;
      try {
        reply = await this.pool.run(() =>
          this.deps.source.decide({
            day,
            actorId: conversation.to,
            prompt: dialoguePrompt,
            schema,
            signal: this.signal,
            jobId: dialogueJobId,
            promptVersion: dialoguePrompt.promptVersion,
          }),
        );
      } catch (err) {
        this.deps.logger.debug('dialogue skipped', { err: (err as Error).message });
        continue;
      }
      this.decisions += 1;
      upsertJob(this.deps.db, {
        worldId: this.state.worldId,
        day,
        phase: 'dialogue',
        actorId: conversation.to,
        jobKind: 'dialogue',
        status: 'done',
        result: reply.plan,
        latencyMs: reply.latencyMs,
        promptTokens: reply.usage.promptTokens,
        completionTokens: reply.usage.completionTokens,
      });
      const social = reply.plan.social;
      if (social && (social.kind === 'accept' || social.kind === 'refuse') && social.targetId === conversation.from) {
        const current = plans.get(conversation.to) ?? {
          actorId: conversation.to,
          plan: { primary: null, social: null, orders: [], intents: [], summary: '' },
          source: 'model' as const,
          summary: '',
        };
        plans.set(conversation.to, {
          ...current,
          plan: { ...current.plan, social },
          summary: `${current.summary} [dialogue: ${social.kind}]`.trim(),
        });
      }
    }
  }

  private buildPrompt(resident: Resident, day: number, events: PromptEvent[]): ActorPrompt {
    const limits = this.deps.config.defaults.model;
    return buildActorPrompt({
      state: this.state,
      scenario: this.deps.scenario,
      resident,
      day,
      memories: memoriesFor(this.deps.db, this.state.worldId, resident.id, limits.memoriesPerPrompt),
      events,
      maxBytes: limits.promptMaxBytes,
      maxRecords: limits.memoriesPerPrompt,
    });
  }

  /**
   * Apply queued operator commands.
   *
   * Target, setting, and injection changes become durable with the day they affect: the disposition is
   * written in the same transaction as the world commit. A crash before that commit therefore leaves
   * the command `pending`, so a restart replays it exactly once instead of losing a mutation that was
   * already marked applied.
   */
  private applyOperatorCommands(
    commands: OperatorCommand[],
    day: number,
    target: WorldState,
  ): { advance: boolean; deferredIds: number[] } {
    let advance = true;
    const deferredIds: number[] = [];
    for (const command of commands) {
      try {
        switch (command.kind) {
          case 'pause':
            this.pause('operator', typeof command.payload.reason === 'string' ? command.payload.reason : 'Paused by operator');
            advance = false;
            // Pausing is safe to record immediately: it has no authoritative boundary effect.
            completeCommand(this.deps.db, command.id, 'applied', undefined, day);
            break;
          case 'resume':
            this.resume();
            completeCommand(this.deps.db, command.id, 'applied', undefined, day);
            break;
          case 'set_population_policy': {
            if (typeof command.payload.enabled !== 'boolean') {
              throw new Error('population policy enabled must be boolean');
            }
            target.populationPolicyEnabled = command.payload.enabled;
            deferredIds.push(command.id);
            break;
          }
          case 'set_target': {
            const nextTarget = Number(command.payload.value);
            if (!Number.isInteger(nextTarget) || nextTarget < 0) {
              throw new Error('target must be a non-negative integer');
            }
            target.populationTarget = nextTarget;
            deferredIds.push(command.id);
            break;
          }
          case 'set_setting': {
            const key = String(command.payload.key ?? '');
            const value = Number(command.payload.value);
            if (!Number.isFinite(value)) throw new Error('setting value must be numeric');
            if (key === 'incomeTaxBps') {
              const capped = Math.min(Math.max(0, Math.trunc(value)), this.deps.scenario.economy.maxIncomeTaxBps);
              target.policies.set(key, capped);
            } else if (key === 'drama') {
              const drama = String(command.payload.value);
              if (drama !== 'calm' && drama !== 'dramatic' && drama !== 'volatile') throw new Error('invalid drama level');
              target.drama = drama;
            } else {
              throw new Error(`setting ${key} is not operator-changeable`);
            }
            deferredIds.push(command.id);
            break;
          }
          case 'inject_event': {
            const kind = String(command.payload.kind ?? '');
            const allowed = new Set(['storm', 'fire', 'flood', 'outbreak', 'gift']);
            if (!allowed.has(kind)) throw new Error(`event ${kind} is not injectable`);
            this.deps.logger.info('operator event injection', { kind });
            target.counters.set(`injected:${kind}:${day}`, 1);
            deferredIds.push(command.id);
            break;
          }
          default:
            throw new Error(`unknown command ${command.kind}`);
        }
      } catch (err) {
        // A rejected command has no state effect, so its disposition is safe to record immediately.
        completeCommand(this.deps.db, command.id, 'rejected', (err as Error).message, day);
        this.deps.logger.warn('command rejected', { commandId: command.id, err: (err as Error).message });
      }
    }
    return { advance, deferredIds };
  }

  private countFallbackCause(cause: string): void {
    // Bounded: only a handful of distinct classes exist, but cap anyway so free-form reasons cannot grow the map.
    const key = cause.slice(0, 40);
    if (!this.fallbackCauses.has(key) && this.fallbackCauses.size >= 16) return;
    this.fallbackCauses.set(key, (this.fallbackCauses.get(key) ?? 0) + 1);
  }

  private checkProviderHealth(): boolean {
    const stats = this.deps.source.stats();
    if (stats.lastErrorClass === 'auth') {
      this.pause('authentication', 'The provider rejected the API key (401/403). Fix TIDEHAVEN_API_KEY, then Resume.');
      return false;
    }
    const rate = this.decisions === 0 ? 0 : Math.floor((this.fallbacks * 10_000) / this.decisions);
    if (this.decisions >= 8 && rate > this.deps.config.defaults.model.fallbackPauseRateBps) {
      const causes = [...this.fallbackCauses.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([cause, count]) => `${cause} x${count}`)
        .join(', ');
      this.deps.logger.warn('provider health check failed', {
        decisions: this.decisions,
        fallbacks: this.fallbacks,
        causes: Object.fromEntries(this.fallbackCauses),
        hint: 'see "provider attempt failed" / "model output rejected" lines above for per-request detail',
      });
      this.pause(
        'provider_down',
        `${(rate / 100).toFixed(1)}% of today's decisions needed a fallback (${causes || 'unknown cause'}); ` +
          'pausing instead of simulating years without the models.',
      );
      return false;
    }
    return true;
  }

  /**
   * Storage budget guard over the *complete* owned data tree.
   *
   * Counting only the SQLite main file and archive chunks lets WAL files, backups, checkpoints, logs,
   * and anything else in the data directory exceed the configured budget without a pause. The guard
   * therefore measures everything Tidehaven owns, and the periodic artefacts reserve their expected
   * growth before they are written.
   */
  private checkStorage(): boolean {
    const storage = this.deps.config.defaults.storage;
    let freeBytes: number | null = null;
    try {
      const stats = statfsSync(this.deps.config.dataDir);
      freeBytes = Number(stats.bavail) * Number(stats.bsize);
    } catch {
      freeBytes = null;
    }
    if (freeBytes !== null && freeBytes < storage.minFreeBytes) {
      this.pause('disk_pressure', `Only ${Math.floor(freeBytes / 1024 / 1024)} MiB free on the data volume.`);
      return false;
    }
    const usedBytes = dataTreeBytes(this.deps.config.dataDir);
    if (storageBudgetExceeded(this.deps.config, usedBytes, 0)) {
      this.pause(
        'storage_budget',
        `The data directory uses ${Math.round(usedBytes / 1024 / 1024)} MiB of the ` +
          `${Math.round(storage.budgetBytes / 1024 / 1024)} MiB budget (database, WAL, backups, checkpoints, logs).`,
      );
      return false;
    }
    return true;
  }

  /**
   * Bounded growth a normal turn may consume: WAL frames, snapshot upserts, and the day's audit rows.
   * Deliberately generous but small compared with a real data budget.
   */
  private turnGrowthReserveBytes(): number {
    return Math.max(1_048_576, Math.floor(this.databaseBytes() * 0.05));
  }

  /** Space kept free for recovery (export, backup, repair) rather than for normal operation. */
  private recoveryReserveBytes(): number {
    const budget = this.deps.config.defaults.storage.budgetBytes;
    return Math.max(16 * 1_048_576, Math.min(64 * 1_048_576, Math.floor(budget / 10)));
  }

  /** Pre-dispatch guard: normal turn growth and recovery headroom must still fit the budget. */
  private checkStorageHeadroom(): boolean {
    const storage = this.deps.config.defaults.storage;
    const used = dataTreeBytes(this.deps.config.dataDir);
    const reserve = this.turnGrowthReserveBytes() + this.recoveryReserveBytes();
    if (used + reserve > storage.budgetBytes) {
      this.pause(
        'storage_budget',
        `The data directory uses ${Math.round(used / 1024 / 1024)} MiB; a further day needs about ` +
          `${Math.round(reserve / 1024 / 1024)} MiB of growth and recovery headroom, which would exceed the ` +
          `${Math.round(storage.budgetBytes / 1024 / 1024)} MiB budget.`,
      );
      return false;
    }
    try {
      const stats = statfsSync(this.deps.config.dataDir);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      if (freeBytes < storage.minFreeBytes + this.turnGrowthReserveBytes()) {
        this.pause(
          'disk_pressure',
          `Only ${Math.floor(freeBytes / 1024 / 1024)} MiB free; a day needs ` +
            `${Math.ceil(this.turnGrowthReserveBytes() / 1024 / 1024)} MiB of headroom above the minimum.`,
        );
        return false;
      }
    } catch {
      // Unknown free space: keep the size-budget check and proceed.
    }
    return true;
  }

  /** Reserve expected growth before writing a durable artefact; pause instead of overshooting. */
  private reserveStorage(reservedBytes: number, what: string): boolean {
    const storage = this.deps.config.defaults.storage;
    const used = dataTreeBytes(this.deps.config.dataDir);
    if (storageBudgetExceeded(this.deps.config, used + Math.max(0, reservedBytes), 0)) {
      this.pause(
        'storage_budget',
        `Writing ${what} would exceed the ${Math.round(storage.budgetBytes / 1024 / 1024)} MiB data budget ` +
          `(currently ${Math.round(used / 1024 / 1024)} MiB).`,
      );
      return false;
    }
    return true;
  }

  private async maybeCheckpoint(day: number): Promise<void> {
    const interval = this.deps.config.defaults.storage.checkpointIntervalDays;
    const last = readRunFlag(this.deps.db, this.state.worldId, CHECKPOINT_KEY) ?? 0;
    if (day - last < interval) return;
    if (!this.reserveStorage(this.checkpointReserveBytes(), 'a checkpoint')) return;
    try {
      const result = writeCheckpoint(this.deps.db, this.state, this.deps.config.dataDir);
      // Operational bookkeeping stays outside authoritative state (so it cannot change the hash after
      // the commit) but is persisted so a restart does not repeat the work.
      writeRunFlag(this.deps.db, this.state.worldId, CHECKPOINT_KEY, day);
      this.deps.logger.info('checkpoint written', { day, bytes: result.bytes });
    } catch (err) {
      this.deps.logger.warn('checkpoint failed', { err: (err as Error).message });
    }
    try {
      const retention = runRetention({
        db: this.deps.db,
        config: this.deps.config,
        worldId: this.state.worldId,
        currentDay: day,
        logger: this.deps.logger,
      });
      if (retention.archivesWritten > 0) {
        this.deps.logger.info('retention applied', {
          archives: retention.archivesWritten,
          rowsArchived: retention.rowsArchived,
          rowsDeleted: retention.rowsDeleted,
          bytes: retention.bytesWritten,
        });
      }
    } catch (err) {
      this.deps.logger.warn('retention failed', { err: (err as Error).message });
    }
  }

  private async maybeBackup(day: number): Promise<void> {
    const last = readRunFlag(this.deps.db, this.state.worldId, BACKUP_KEY) ?? 0;
    if (day - last < 7 && day !== 1) return;
    // A backup is a full copy of the database: reserve its size before writing.
    if (!this.reserveStorage(this.databaseBytes(), 'a backup')) return;
    try {
      const result = await createBackup(this.deps.db, this.deps.config.dataDir, {
        keep: this.deps.config.defaults.storage.backups,
        label: `day-${day}`,
      });
      writeRunFlag(this.deps.db, this.state.worldId, BACKUP_KEY, day);
      this.deps.logger.info('backup written', { day, path: result.path, bytes: result.bytes });
    } catch (err) {
      this.deps.logger.warn('backup failed', { err: (err as Error).message });
    }
  }

  private databaseBytes(): number {
    const pageCount = Number(this.deps.db.get<{ page_count: number }>('pragma page_count')?.page_count ?? 0);
    const pageSize = Number(this.deps.db.get<{ page_size: number }>('pragma page_size')?.page_size ?? 0);
    return pageCount * pageSize;
  }

  /** A checkpoint is a compact JSON snapshot; a small multiple of its source rows is a safe reserve. */
  private checkpointReserveBytes(): number {
    return Math.max(4_096, Math.floor(this.databaseBytes() / 4));
  }

  /** Jobs still outstanding for the current day (dashboard + tests). */
  jobsStatus(day = this.state.day): Record<string, number> {
    return countJobsByStatus(this.deps.db, this.state.worldId, day);
  }

  /** Resume support: true when the on-disk turn for the next day is already `ready`. */
  pendingTurn(): (TurnRow & { phase: string }) | null {
    return getOpenTurn(this.deps.db, this.state.worldId);
  }

  findJobForActor(day: number, actorId: number) {
    return findJob(this.deps.db, this.state.worldId, day, actorId, 'plan');
  }
}

function state_get(state: WorldState, id: number) {
  return state.residents.get(id);
}
