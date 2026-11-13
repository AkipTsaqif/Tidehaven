import type { Scenario } from '../contracts/scenario.js';
import type { EventInsert, FlowInsert, LedgerInsert, MemoryInsert, ObservationInsert, ShippingInsert, TaxInsert } from '../storage/repositories.js';
import type { Good, OwnerType, WorldState } from './state.js';
import { credit, debit, nextId } from './state.js';
import { streamRng, type Rng } from './rng.js';

/**
 * Per-turn context: the only sanctioned way phases mutate state, emit events, and record accounting.
 *
 * Every money movement goes through transfer() (two ledger rows), every goods movement through
 * shiftGoods() (one flow row). That makes the daily invariants checkable and archives auditable.
 */

export interface TurnContext {
  readonly state: WorldState;
  readonly scenario: Scenario;
  readonly day: number;
  /** Current subphase name, recorded with events/ledger/flows. */
  phase: string;
  readonly events: EventInsert[];
  readonly ledger: LedgerInsert[];
  readonly flows: FlowInsert[];
  readonly observations: ObservationInsert[];
  readonly memories: MemoryInsert[];
  readonly taxRecords: TaxInsert[];
  readonly shipping: ShippingInsert[];
  rngFor(entity: number | string, action: string): Rng;
  setPhase(phase: string): void;
  emit(event: EventInput): number;
  transfer(params: {
    from: OwnerRef;
    to: OwnerRef;
    cents: number;
    reason: string;
    eventId?: number | null;
    phase?: string;
  }): void;
  shiftGoods(params: {
    owner: OwnerRef;
    good: Good;
    delta: number;
    reason: string;
    eventId?: number | null;
    phase?: string;
  }): void;
  observe(actorId: number, eventId: number, summary: string, visibility?: string): void;
  remember(residentId: number, kind: string, text: string, importance: number, sourceEventIds?: number[]): void;
  tax(residentId: number | null, kind: string, amountCents: number): void;
}

export interface OwnerRef {
  type: OwnerType;
  id?: number;
}

export type EventInput = Omit<
  EventInsert,
  'id' | 'day' | 'phase' | 'locationId' | 'causeIds' | 'effectIds'
> & {
  locationId?: number | null;
  causeIds?: number[];
  effectIds?: number[];
  phase?: string;
  detail?: Record<string, unknown>;
};

export function ownerOf(type: OwnerType, id = 0): OwnerRef {
  return { type, id };
}

export function createTurnContext(params: {
  state: WorldState;
  scenario: Scenario;
  day: number;
  phase?: string;
  txnPrefix?: string;
}): TurnContext {
  const { state, scenario, day } = params;
  let phase = params.phase ?? 'schedule';
  let txnSeq = 0;

  const context: TurnContext = {
    state,
    scenario,
    day,
    get phase() {
      return phase;
    },
    events: [],
    ledger: [],
    flows: [],
    observations: [],
    memories: [],
    taxRecords: [],
    shipping: [],
    rngFor(entity, action) {
      return streamRng(state.seed, day, phase, entity, action);
    },
    setPhase(next) {
      phase = next;
    },
    emit(event) {
      const id = nextId(state, 'event');
      context.events.push({
        id,
        day,
        phase: event.phase ?? phase,
        kind: event.kind,
        actorId: event.actorId ?? null,
        targetId: event.targetId ?? null,
        locationId: event.locationId ?? null,
        visibility: event.visibility,
        importance: event.importance,
        title: event.title,
        detail: event.detail,
        causeIds: event.causeIds ?? [],
        effectIds: event.effectIds ?? [],
      });
      return id;
    },
    transfer({ from, to, cents, reason, eventId = null, phase: entryPhase }) {
      if (!Number.isSafeInteger(cents) || cents < 0) {
        throw new Error(`transfer amount must be a non-negative integer, got ${cents}`);
      }
      if (cents === 0) return;
      const fromId = from.id ?? 0;
      const toId = to.id ?? 0;
      if (from.type === to.type && fromId === toId) return;
      debit(state, from.type, fromId, cents);
      credit(state, to.type, toId, cents);
      txnSeq += 1;
      const txnId = `${params.txnPrefix ?? 'd'}${day}-${phase}-${txnSeq}`;
      const effectivePhase = entryPhase ?? phase;
      context.ledger.push(
        {
          day,
          phase: effectivePhase,
          txnId,
          ownerType: from.type,
          ownerId: fromId,
          deltaCents: -cents,
          reason,
          eventId,
        },
        {
          day,
          phase: effectivePhase,
          txnId,
          ownerType: to.type,
          ownerId: toId,
          deltaCents: cents,
          reason,
          eventId,
        },
      );
    },
    shiftGoods({ owner, good, delta, reason, eventId = null, phase: entryPhase }) {
      if (delta === 0) return;
      const ownerId = owner.id ?? 0;
      const previous = state.inventories.get(`${owner.type}:${ownerId}:${good}`) ?? 0;
      // Apply through the state helper (validates negatives/overflow) then record the flow.
      applyGoodsDelta(context, owner, good, delta);
      const next = state.inventories.get(`${owner.type}:${ownerId}:${good}`) ?? 0;
      const actual = next - previous;
      if (actual === 0) return;
      context.flows.push({
        day,
        phase: entryPhase ?? phase,
        ownerType: owner.type,
        ownerId,
        good,
        delta: actual,
        reason,
        eventId,
      });
      // Running per-good flow total: stock must always equal this, regardless of how much raw audit
      // detail has been archived and pruned.
      const counterKey = `goodsFlow:${good}`;
      state.counters.set(counterKey, (state.counters.get(counterKey) ?? 0) + actual);
    },
    observe(actorId, eventId, summary, visibility = 'public') {
      context.observations.push({ day, actorId, eventId, visibility, summary });
    },
    remember(residentId, kind, text, importance, sourceEventIds = []) {
      context.memories.push({ residentId, day, kind, text, importance, sourceEventIds });
    },
    tax(residentId, kind, amountCents) {
      if (amountCents === 0) return;
      context.taxRecords.push({ day, residentId, kind, amountCents });
    },
  };

  return context;
}

function applyGoodsDelta(ctx: TurnContext, owner: OwnerRef, good: Good, delta: number): void {
  const key = `${owner.type}:${owner.id ?? 0}:${good}`;
  const current = ctx.state.inventories.get(key) ?? 0;
  const next = current + delta;
  if (next < 0) throw new Error(`Insufficient ${good} for ${owner.type}:${owner.id ?? 0} (${current} + ${delta})`);
  if (!Number.isSafeInteger(next)) throw new Error('inventory overflow');
  ctx.state.inventories.set(key, next);
}
