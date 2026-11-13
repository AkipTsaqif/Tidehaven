/**
 * Authoritative in-memory world state and the primitives every rule uses.
 *
 * The normalized SQLite tables and this snapshot are the same state (loaded/committed, never two
 * independently mutable copies). Append-only tables (events, ledger entries, goods flows, memories,
 * articles) are written only at commit time.
 *
 * Money is integer cents. Goods are integer units. Percentages are bps, probabilities ppm.
 */

import { emptyDevelopmentState, type DevelopmentState } from './development-types.js';

export const GOODS = ['grain', 'fish', 'bread', 'timber', 'tools', 'medicine', 'cloth'] as const;
export type Good = (typeof GOODS)[number];

export const FOOD_GOODS: readonly Good[] = ['grain', 'fish', 'bread'];

export const OWNER_TYPES = [
  'resident',
  'household',
  'business',
  'treasury',
  'external',
  'escrow',
] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export type DramaLevel = 'calm' | 'dramatic' | 'volatile';
export type LifeStatus = 'living' | 'dead' | 'emigrated';
export type HealthState = 'healthy' | 'exposed' | 'infectious' | 'recovering' | 'injured' | 'disabled' | 'dead';
export type Sex = 'female' | 'male';

export const MAX_CENTS = Number.MAX_SAFE_INTEGER - 1;
export const MAX_QUANTITY = 1_000_000_000;

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

export interface Resident {
  id: number;
  name: string;
  sex: Sex;
  bornDay: number;
  origin: 'founder' | 'born' | 'immigrant';
  status: LifeStatus;
  deathDay: number | null;
  deathCause: string | null;
  householdId: number | null;
  partnerId: number | null;
  motherId: number | null;
  fatherId: number | null;
  guardianId: number | null;
  traits: Record<string, number>;
  skills: Record<string, number>;
  healthState: HealthState;
  health: Record<string, number>;
  hungerDays: number;
  educationDays: number;
  legacyOf: number | null;
  emigratedDay: number | null;
  destination: string | null;
  rngSalt: number;
}

export interface Household {
  id: number;
  name: string;
  buildingId: number | null;
  capacity: number;
  formedDay: number;
  dissolvedDay: number | null;
}

export interface Building {
  id: number;
  name: string;
  kind: string;
  capacity: number;
  conditionBps: number;
  builtDay: number;
  destroyedDay: number | null;
  privateFlag: boolean;
}

export interface Business {
  id: number;
  name: string;
  kind: string;
  ownerType: 'resident' | 'town';
  ownerId: number | null;
  managerId: number | null;
  buildingId: number | null;
  cashCents: number;
  openedDay: number;
  closedDay: number | null;
  status: 'open' | 'closed' | 'bankrupt';
  settings: Record<string, number>;
}

export interface Account {
  ownerType: OwnerType;
  ownerId: number;
  balanceCents: number;
}

export interface Relationship {
  key: string;
  aId: number;
  bId: number;
  kind: 'partner' | 'affair' | 'feud' | 'friend' | 'rival';
  trust: number;
  intimacy: number;
  publicBelief: number;
  sinceDay: number;
  untilDay: number | null;
  cooldownUntil: number | null;
}

export interface Pregnancy {
  id: number;
  motherId: number;
  fatherId: number;
  conceivedDay: number;
  dueDay: number;
  status: 'active' | 'delivered' | 'lost';
  childId: number | null;
  resolvedDay: number | null;
}

export interface Contract {
  id: number;
  kind: 'employment' | 'tenancy' | 'sale';
  aId: number;
  bId: number | null;
  businessId: number | null;
  terms: Record<string, number | string>;
  startDay: number;
  endDay: number | null;
  status: 'active' | 'ended' | 'breached';
}

export interface HealthCase {
  id: number;
  residentId: number;
  disease: string;
  state: 'exposed' | 'infectious' | 'recovering' | 'recovered' | 'chronic';
  severity: number;
  sinceDay: number;
  infectiousUntil: number | null;
  treatedDays: number;
  resolvedDay: number | null;
  outcome: string | null;
}

export interface Injury {
  id: number;
  residentId: number;
  kind: string;
  severity: number;
  sinceDay: number;
  untilDay: number | null;
  disability: number;
  resolvedDay: number | null;
}

export interface Disaster {
  id: number;
  kind: 'storm' | 'flood' | 'fire' | 'drought' | 'outbreak';
  day: number;
  severity: number;
  buildingId: number | null;
  stage: 'occurred' | 'relief' | 'rebuilding' | 'closed';
  damage: Record<string, number>;
  closedDay: number | null;
}

export type CaseKind =
  | 'theft'
  | 'fraud'
  | 'corruption'
  | 'assault'
  | 'murder'
  | 'estate_dispute'
  | 'unrest'
  | 'rebelling';

export interface CaseRecord {
  id: number;
  kind: CaseKind;
  defendantId: number;
  plaintiffId: number | null;
  openedDay: number;
  status: 'investigating' | 'trial' | 'sentenced' | 'closed';
  investigationDays: number;
  prosecutionBps: number;
  defenceBps: number;
  verdict: string | null;
  closedDay: number | null;
  disputedEstateId: number | null;
  truth: Record<string, number | string>;
}

export interface Evidence {
  id: number;
  caseId: number;
  kind: string;
  weightBps: number;
  public: boolean;
  sourceEventId: number | null;
  createdDay: number;
}

export interface Sentence {
  id: number;
  caseId: number;
  kind: 'fine' | 'restitution' | 'probation' | 'imprisonment' | 'acquittal' | 'dismissal';
  amountCents: number;
  days: number;
  startDay: number;
  endDay: number | null;
  status: 'active' | 'served' | 'paid';
  /** Simulated day the prisoner was released; `null` until the one-time release transition. */
  releasedDay: number | null;
}

export interface Faction {
  id: number;
  name: string;
  interest: string;
  leaderId: number | null;
  fundsCents: number;
  supportBps: number;
  createdDay: number;
  dissolvedDay: number | null;
}

export interface FactionMember {
  key: string;
  factionId: number;
  residentId: number;
  joinedDay: number;
  leftDay: number | null;
  loyalty: number;
}

export const OFFICES = ['councillor', 'magistrate', 'guard_captain', 'clerk'] as const;
export type Office = (typeof OFFICES)[number];

export interface OfficeSeat {
  key: string;
  office: Office;
  seat: number;
  holderId: number | null;
  sinceDay: number;
  untilDay: number | null;
}

export interface Unrest {
  id: number;
  kind: 'protest' | 'strike' | 'riot' | 'rebellion';
  startedDay: number;
  endedDay: number | null;
  demands: Record<string, number | string>;
  participants: number[];
  status: 'active' | 'resolved' | 'suppressed';
  severity: number;
}

export interface Grievance {
  id: number;
  residentId: number;
  kind: string;
  severity: number;
  sinceDay: number;
  untilDay: number | null;
  reason: string;
}

export interface Proposal {
  id: number;
  day: number;
  fromId: number;
  toId: number;
  kind: 'courtship' | 'affair' | 'conception' | 'divorce' | 'hire' | 'settle' | 'trade';
  status: 'pending' | 'accepted' | 'refused' | 'expired';
  expiresDay: number;
  detail: Record<string, number | string>;
}

export interface Estate {
  id: number;
  deceasedId: number;
  openedDay: number;
  closedDay: number | null;
  status: 'open' | 'disputed' | 'closed';
  totalCents: number;
  will: Record<string, number> | null;
  escrowCents: number;
  /** Deadline day for a disputed estate; the court must rule by then. */
  disputeDeadlineDay: number | null;
}

/**
 * A recorded will: shares are basis points of the *distributable* estate (after obligations), keyed by
 * claimant id. The unallocated remainder follows the intestate rules.
 */
export interface Will {
  residentId: number;
  shares: Record<string, number>;
  recordedDay: number;
}

export interface EstateClaim {
  id: number;
  estateId: number;
  claimantId: number | null;
  kind: 'partner' | 'descendant' | 'guardian' | 'creditor' | 'treasury';
  amountCents: number;
  status: 'pending' | 'paid' | 'rejected';
  resolvedDay: number | null;
}

export type EntityKind =
  | 'resident'
  | 'household'
  | 'building'
  | 'business'
  | 'contract'
  | 'pregnancy'
  | 'healthCase'
  | 'injury'
  | 'disaster'
  | 'case'
  | 'evidence'
  | 'sentence'
  | 'faction'
  | 'unrest'
  | 'grievance'
  | 'proposal'
  | 'estate'
  | 'estateClaim'
  | 'event';

export interface WorldState {
  worldId: number;
  name: string;
  seed: string;
  rulesVersion: string;
  drama: DramaLevel;
  populationTarget: number;
  populationPolicyEnabled: boolean;
  hostCeiling: number;
  day: number;
  nextIds: Record<EntityKind, number>;
  residents: Map<number, Resident>;
  households: Map<number, Household>;
  buildings: Map<number, Building>;
  businesses: Map<number, Business>;
  development: DevelopmentState;
  accounts: Map<string, Account>;
  /** ownerKey|good -> quantity */
  inventories: Map<string, number>;
  /** ownerKey|good -> reserved quantity */
  reserved: Map<string, number>;
  prices: Map<Good, number>;
  relationships: Map<string, Relationship>;
  pregnancies: Map<number, Pregnancy>;
  contracts: Map<number, Contract>;
  healthCases: Map<number, HealthCase>;
  injuries: Map<number, Injury>;
  disasters: Map<number, Disaster>;
  cases: Map<number, CaseRecord>;
  evidence: Map<number, Evidence>;
  sentences: Map<number, Sentence>;
  factions: Map<number, Faction>;
  factionMembers: Map<string, FactionMember>;
  offices: Map<string, OfficeSeat>;
  unrest: Map<number, Unrest>;
  grievances: Map<number, Grievance>;
  proposals: Map<number, Proposal>;
  estates: Map<number, Estate>;
  estateClaims: Map<number, EstateClaim>;
  wills: Map<number, Will>;
  policies: Map<string, number | string>;
  /** Named counters: pressureDays, legitimacyBps, lastElectionDay, strikeDays, ... */
  counters: Map<string, number>;
}

export function ownerKey(ownerType: OwnerType, ownerId = 0): string {
  return `${ownerType}:${ownerId}`;
}

export function inventoryKey(ownerType: OwnerType, ownerId: number, good: Good): string {
  return `${ownerType}:${ownerId}:${good}`;
}

export function relationshipKey(aId: number, bId: number, kind: Relationship['kind']): string {
  const [lo, hi] = aId <= bId ? [aId, bId] : [bId, aId];
  return `${kind}:${lo}:${hi}`;
}

export function emptyState(params: {
  worldId: number;
  name: string;
  seed: string;
  rulesVersion: string;
  drama: DramaLevel;
  populationTarget: number;
  populationPolicyEnabled?: boolean;
  hostCeiling: number;
  nextIds?: Partial<Record<EntityKind, number>>;
}): WorldState {
  const nextIds: Record<EntityKind, number> = {
    resident: 1,
    household: 1,
    building: 1,
    business: 1,
    contract: 1,
    pregnancy: 1,
    healthCase: 1,
    injury: 1,
    disaster: 1,
    case: 1,
    evidence: 1,
    sentence: 1,
    faction: 1,
    unrest: 1,
    grievance: 1,
    proposal: 1,
    estate: 1,
    estateClaim: 1,
    event: 1,
    ...(params.nextIds ?? {}),
  };
  const prices = new Map<Good, number>();
  for (const good of GOODS) prices.set(good, 0);
  return {
    worldId: params.worldId,
    name: params.name,
    seed: params.seed,
    rulesVersion: params.rulesVersion,
    drama: params.drama,
    populationTarget: params.populationTarget,
    populationPolicyEnabled: params.populationPolicyEnabled ?? true,
    hostCeiling: params.hostCeiling,
    day: 0,
    nextIds,
    residents: new Map(),
    households: new Map(),
    buildings: new Map(),
    businesses: new Map(),
    development: emptyDevelopmentState(),
    accounts: new Map(),
    inventories: new Map(),
    reserved: new Map(),
    prices,
    relationships: new Map(),
    pregnancies: new Map(),
    contracts: new Map(),
    healthCases: new Map(),
    injuries: new Map(),
    disasters: new Map(),
    cases: new Map(),
    evidence: new Map(),
    sentences: new Map(),
    factions: new Map(),
    factionMembers: new Map(),
    offices: new Map(),
    unrest: new Map(),
    grievances: new Map(),
    proposals: new Map(),
    estates: new Map(),
    estateClaims: new Map(),
    wills: new Map(),
    policies: new Map(),
    counters: new Map(),
  };
}

export function nextId(state: WorldState, kind: EntityKind): number {
  const id = state.nextIds[kind] ?? 1;
  state.nextIds[kind] = id + 1;
  return id;
}

/* ------------------------------------------------------------------ money */

export function assertCents(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value)) throw new StateError(`${label} must be an integer number of cents`);
  if (Math.abs(value) > MAX_CENTS) throw new StateError(`${label} exceeds the safe money range`);
  return value;
}

export function getAccount(state: WorldState, ownerType: OwnerType, ownerId = 0): Account {
  const key = ownerKey(ownerType, ownerId);
  let account = state.accounts.get(key);
  if (!account) {
    account = { ownerType, ownerId, balanceCents: 0 };
    state.accounts.set(key, account);
  }
  return account;
}

export function balanceOf(state: WorldState, ownerType: OwnerType, ownerId = 0): number {
  return getAccount(state, ownerType, ownerId).balanceCents;
}

export function credit(state: WorldState, ownerType: OwnerType, ownerId: number, cents: number): void {
  assertCents(cents, 'credit');
  const account = getAccount(state, ownerType, ownerId);
  const next = account.balanceCents + cents;
  assertCents(next, 'balance');
  account.balanceCents = next;
}

export function debit(state: WorldState, ownerType: OwnerType, ownerId: number, cents: number): void {
  assertCents(cents, 'debit');
  if (cents < 0) throw new StateError('debit amount must be non-negative');
  const account = getAccount(state, ownerType, ownerId);
  // The external settlement account is the town's net trade position: it may run negative (foreign
  // credit). Every internal account must stay non-negative.
  if (ownerType !== 'external' && account.balanceCents < cents) {
    throw new StateError(`Insufficient funds for ${ownerType}:${ownerId}: ${account.balanceCents} < ${cents}`);
  }
  const next = account.balanceCents - cents;
  assertCents(next, 'balance');
  account.balanceCents = next;
}

/* ------------------------------------------------------------------ goods */

export function quantityOf(state: WorldState, ownerType: OwnerType, ownerId: number, good: Good): number {
  return state.inventories.get(inventoryKey(ownerType, ownerId, good)) ?? 0;
}

export function reservedOf(state: WorldState, ownerType: OwnerType, ownerId: number, good: Good): number {
  return state.reserved.get(inventoryKey(ownerType, ownerId, good)) ?? 0;
}

export function availableOf(state: WorldState, ownerType: OwnerType, ownerId: number, good: Good): number {
  return quantityOf(state, ownerType, ownerId, good) - reservedOf(state, ownerType, ownerId, good);
}

export function addGoods(
  state: WorldState,
  ownerType: OwnerType,
  ownerId: number,
  good: Good,
  delta: number,
): void {
  if (!Number.isSafeInteger(delta)) throw new StateError('goods delta must be an integer');
  const key = inventoryKey(ownerType, ownerId, good);
  const current = state.inventories.get(key) ?? 0;
  const next = current + delta;
  if (!Number.isSafeInteger(next)) throw new StateError('inventory overflow');
  if (next < 0) throw new StateError(`Negative inventory for ${key}: ${current} ${delta}`);
  if (next > MAX_QUANTITY) throw new StateError(`Inventory ceiling reached for ${key}`);
  // Zero rows are retained so persistence can upsert a stable key set; invariants treat 0 as empty.
  state.inventories.set(key, next);
}

export function reserveGoods(
  state: WorldState,
  ownerType: OwnerType,
  ownerId: number,
  good: Good,
  quantity: number,
): void {
  if (quantity < 0) throw new StateError('reserve quantity must be non-negative');
  if (availableOf(state, ownerType, ownerId, good) < quantity) {
    throw new StateError('Cannot reserve more goods than are available');
  }
  const key = inventoryKey(ownerType, ownerId, good);
  state.reserved.set(key, (state.reserved.get(key) ?? 0) + quantity);
}

export function releaseGoods(
  state: WorldState,
  ownerType: OwnerType,
  ownerId: number,
  good: Good,
  quantity: number,
): void {
  const key = inventoryKey(ownerType, ownerId, good);
  const current = state.reserved.get(key) ?? 0;
  const next = Math.max(0, current - quantity);
  state.reserved.set(key, next);
}

/* ------------------------------------------------------------- population */

export function livingResidents(state: WorldState): Resident[] {
  return [...state.residents.values()].filter((r) => r.status === 'living');
}

export function expectedBirths(state: WorldState): number {
  return [...state.pregnancies.values()].filter((p) => p.status === 'active').length;
}

export function population(state: WorldState): number {
  return livingResidents(state).length;
}

export function residentsOfHousehold(state: WorldState, householdId: number): Resident[] {
  return livingResidents(state).filter((r) => r.householdId === householdId);
}

export function getResident(state: WorldState, id: number): Resident | undefined {
  return state.residents.get(id);
}

export function requireResident(state: WorldState, id: number): Resident {
  const resident = state.residents.get(id);
  if (!resident) throw new StateError(`Unknown resident ${id}`);
  return resident;
}

export function isAlive(resident: Resident | undefined): boolean {
  return resident !== undefined && resident.status === 'living';
}

/**
 * A detached, structurally independent copy of a world.
 *
 * The runner resolves a day against a *staged* copy and only publishes it after the transaction that
 * records the day has committed. That is what keeps an invariant failure, an engine exception, or a
 * database write error from leaving half-advanced authoritative state behind. `undefined` is the only
 * value JSON cannot carry, so it is dropped; every authoritative field is JSON-safe by contract.
 */
export function cloneState(state: WorldState): WorldState {
  return structuredClone(state);
}

/**
 * Publish a committed staged copy into the long-lived state object.
 *
 * The runner resolves days against `cloneState`, then publishes with `adoptState` so every component
 * that already holds a reference (the decision source, the status server, the dashboard mirror) sees
 * the committed state without being re-wired. Collections are replaced wholesale, never merged.
 */
export function adoptState(target: WorldState, staged: WorldState): void {
  // Copy every own field, not a hand-maintained list: a new authoritative collection must be published
  // automatically, or the live state silently diverges from the committed one (and from its hash).
  Object.assign(target, staged);
}
