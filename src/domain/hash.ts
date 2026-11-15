import { createHash } from 'node:crypto';
import type { WorldState } from './state.js';

/**
 * Canonical serialisation and state hashing.
 *
 * The hash covers **all** authoritative state: every entity collection and every rule-relevant field,
 * in a stable order. Only explicitly derived or volatile fields are excluded:
 *
 *   - presentation metadata (`created_at`, event titles are facts, but the audit `created_at` is not)
 *   - denormalised projections that are rebuilt from authoritative rows (`business.cashCents`)
 *   - transient per-day bookkeeping (`resident.health.lastCheckDay`)
 *
 * Two runs with the same seed, rules, and stored decisions must produce the same hash even if provider
 * responses completed in a different order. Two *different* worlds must never share a hash.
 */

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Cannot hash a non-finite number');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) => [String(k), sortValue(v)] as const);
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { __map: entries };
  }
  if (value instanceof Set) {
    const items = [...value].map((item) => sortValue(item));
    return { __set: items.sort((a, b) => (canonicalStringify(a) < canonicalStringify(b) ? -1 : 1)) };
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function hashValue(value: unknown): string {
  return sha256(canonicalStringify(value));
}

/** Rows of a map that carries an `id`, ordered by that id (never by insertion order). */
function sortedRows<T extends { id: number }>(map: Map<number, T>): T[] {
  return [...map.values()].sort((a, b) => a.id - b.id);
}

/** Keyed rows (offices, relationships, inventories, ...), ordered by key. */
function sortedKeys<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function sortedNumbers(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Authoritative snapshot used for hashing, checkpoints, and daily metrics.
 *
 * Every entity row is included in full, with only the documented exceptions above. Arrays are used
 * (not objects) so that field order is explicit and reviewable.
 */
export function stateSnapshot(state: WorldState): Record<string, unknown> {
  const residents = sortedRows(state.residents).map((r) => ({
    id: r.id,
    name: r.name,
    sex: r.sex,
    bornDay: r.bornDay,
    origin: r.origin,
    status: r.status,
    deathDay: r.deathDay,
    deathCause: r.deathCause,
    householdId: r.householdId,
    partnerId: r.partnerId,
    motherId: r.motherId,
    fatherId: r.fatherId,
    guardianId: r.guardianId,
    traits: r.traits,
    skills: r.skills,
    healthState: r.healthState,
    // `lastCheckDay` is transient bookkeeping, not a rule-relevant fact.
    health: Object.fromEntries(
      Object.entries(r.health)
        .filter(([key]) => key !== 'lastCheckDay')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    hungerDays: r.hungerDays,
    educationDays: r.educationDays,
    legacyOf: r.legacyOf,
    emigratedDay: r.emigratedDay,
    destination: r.destination,
    rngSalt: r.rngSalt,
  }));

  const households = sortedRows(state.households).map((h) => ({
    id: h.id,
    name: h.name,
    buildingId: h.buildingId,
    capacity: h.capacity,
    formedDay: h.formedDay,
    dissolvedDay: h.dissolvedDay,
  }));

  const buildings = sortedRows(state.buildings).map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    capacity: b.capacity,
    conditionBps: b.conditionBps,
    builtDay: b.builtDay,
    destroyedDay: b.destroyedDay,
    privateFlag: b.privateFlag,
  }));

  // `cashCents` is a projection of the business account balance; the account row is authoritative.
  const businesses = sortedRows(state.businesses).map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    ownerType: b.ownerType,
    ownerId: b.ownerId,
    managerId: b.managerId,
    buildingId: b.buildingId,
    openedDay: b.openedDay,
    closedDay: b.closedDay,
    status: b.status,
    settings: b.settings,
  }));

  const accounts = sortedKeys(state.accounts).map(([key, a]) => [key, a.ownerType, a.ownerId, a.balanceCents]);
  const inventories = sortedNumbers(state.inventories);
  // A zero reservation is not a fact: the row exists only because a release left it at zero, and a
  // round-trip through SQLite materialises a zero row for every inventory key. Filtering keeps the
  // hash stable across save/load without hiding any reservation that actually exists.
  const reserved = sortedNumbers(state.reserved).filter(([, quantity]) => quantity !== 0);
  const prices = sortedNumbers(state.prices as Map<string, number>);
  const policies = sortedNumbers(state.policies as Map<string, number>);
  const counters = sortedNumbers(state.counters);

  const relationships = sortedKeys(state.relationships).map(([key, r]) => [
    key,
    r.aId,
    r.bId,
    r.kind,
    r.trust,
    r.intimacy,
    r.publicBelief,
    r.sinceDay,
    r.untilDay,
    r.cooldownUntil,
  ]);

  const pregnancies = sortedRows(state.pregnancies).map((p) => ({
    id: p.id,
    motherId: p.motherId,
    fatherId: p.fatherId,
    conceivedDay: p.conceivedDay,
    dueDay: p.dueDay,
    status: p.status,
    childId: p.childId,
    resolvedDay: p.resolvedDay,
  }));

  const contracts = sortedRows(state.contracts).map((c) => ({
    id: c.id,
    kind: c.kind,
    aId: c.aId,
    bId: c.bId,
    businessId: c.businessId,
    terms: c.terms,
    startDay: c.startDay,
    endDay: c.endDay,
    status: c.status,
  }));

  const healthCases = sortedRows(state.healthCases).map((h) => ({
    id: h.id,
    residentId: h.residentId,
    disease: h.disease,
    state: h.state,
    severity: h.severity,
    sinceDay: h.sinceDay,
    infectiousUntil: h.infectiousUntil,
    treatedDays: h.treatedDays,
    resolvedDay: h.resolvedDay,
    outcome: h.outcome,
  }));

  const injuries = sortedRows(state.injuries).map((i) => ({
    id: i.id,
    residentId: i.residentId,
    kind: i.kind,
    severity: i.severity,
    sinceDay: i.sinceDay,
    untilDay: i.untilDay,
    disability: i.disability,
    resolvedDay: i.resolvedDay,
  }));

  const disasters = sortedRows(state.disasters).map((d) => ({
    id: d.id,
    kind: d.kind,
    day: d.day,
    severity: d.severity,
    buildingId: d.buildingId,
    stage: d.stage,
    damage: d.damage,
    closedDay: d.closedDay,
  }));

  const cases = sortedRows(state.cases).map((c) => ({
    id: c.id,
    kind: c.kind,
    defendantId: c.defendantId,
    plaintiffId: c.plaintiffId,
    openedDay: c.openedDay,
    status: c.status,
    investigationDays: c.investigationDays,
    prosecutionBps: c.prosecutionBps,
    defenceBps: c.defenceBps,
    verdict: c.verdict,
    closedDay: c.closedDay,
    disputedEstateId: c.disputedEstateId,
    truth: c.truth,
  }));

  const evidence = sortedRows(state.evidence).map((e) => ({
    id: e.id,
    caseId: e.caseId,
    kind: e.kind,
    weightBps: e.weightBps,
    public: e.public,
    sourceEventId: e.sourceEventId,
    createdDay: e.createdDay,
  }));

  const sentences = sortedRows(state.sentences).map((s) => ({
    id: s.id,
    caseId: s.caseId,
    kind: s.kind,
    amountCents: s.amountCents,
    days: s.days,
    startDay: s.startDay,
    endDay: s.endDay,
    status: s.status,
    releasedDay: s.releasedDay,
  }));

  const factions = sortedRows(state.factions).map((f) => ({
    id: f.id,
    name: f.name,
    interest: f.interest,
    leaderId: f.leaderId,
    fundsCents: f.fundsCents,
    supportBps: f.supportBps,
    createdDay: f.createdDay,
    dissolvedDay: f.dissolvedDay,
  }));

  const factionMembers = sortedKeys(state.factionMembers).map(([key, m]) => [
    key,
    m.factionId,
    m.residentId,
    m.joinedDay,
    m.leftDay,
    m.loyalty,
  ]);

  const offices = sortedKeys(state.offices).map(([key, o]) => [key, o.office, o.seat, o.holderId, o.sinceDay, o.untilDay]);

  const unrest = sortedRows(state.unrest).map((u) => ({
    id: u.id,
    kind: u.kind,
    startedDay: u.startedDay,
    endedDay: u.endedDay,
    demands: u.demands,
    participants: [...u.participants].sort((a, b) => a - b),
    status: u.status,
    severity: u.severity,
  }));

  const grievances = sortedRows(state.grievances).map((g) => ({
    id: g.id,
    residentId: g.residentId,
    kind: g.kind,
    severity: g.severity,
    sinceDay: g.sinceDay,
    untilDay: g.untilDay,
    reason: g.reason,
  }));

  const proposals = sortedRows(state.proposals).map((p) => ({
    id: p.id,
    day: p.day,
    fromId: p.fromId,
    toId: p.toId,
    kind: p.kind,
    status: p.status,
    expiresDay: p.expiresDay,
    detail: p.detail,
  }));

  const estates = sortedRows(state.estates).map((e) => ({
    id: e.id,
    deceasedId: e.deceasedId,
    openedDay: e.openedDay,
    closedDay: e.closedDay,
    status: e.status,
    totalCents: e.totalCents,
    will: e.will,
    escrowCents: e.escrowCents,
    disputeDeadlineDay: e.disputeDeadlineDay,
  }));

  const wills = [...state.wills.values()]
    .sort((a, b) => a.residentId - b.residentId)
    .map((w) => ({ residentId: w.residentId, shares: w.shares, recordedDay: w.recordedDay }));

  const estateClaims = sortedRows(state.estateClaims).map((c) => ({
    id: c.id,
    estateId: c.estateId,
    claimantId: c.claimantId,
    kind: c.kind,
    amountCents: c.amountCents,
    status: c.status,
    resolvedDay: c.resolvedDay,
  }));

  const nextIds = Object.fromEntries(
    Object.entries(state.nextIds).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

  return {
    worldId: state.worldId,
    name: state.name,
    seed: state.seed,
    rulesVersion: state.rulesVersion,
    drama: state.drama,
    populationTarget: state.populationTarget,
    ...(state.populationPolicyEnabled === false ? { populationPolicyEnabled: false } : {}),
    hostCeiling: state.hostCeiling,
    day: state.day,
    nextIds,
    residents,
    households,
    buildings,
    businesses,
    ...(state.development.projects.size > 0 || state.development.nextId !== 1 ? {
      development: {
        nextId: state.development.nextId,
        projects: sortedRows(state.development.projects),
      },
    } : {}),
    ...(state.reclaimed.length > 0 ? { reclaimed: state.reclaimed } : {}),
    accounts,
    inventories,
    reserved,
    prices,
    relationships,
    pregnancies,
    contracts,
    healthCases,
    injuries,
    disasters,
    cases,
    evidence,
    sentences,
    factions,
    factionMembers,
    offices,
    unrest,
    grievances,
    proposals,
    estates,
    estateClaims,
    wills,
    policies,
    counters,
  };
}

export function stateHash(state: WorldState): string {
  return hashValue(stateSnapshot(state));
}

/** Hash of the inputs to a turn: used to detect a frozen, reused snapshot. */
export function turnInputHash(parts: {
  worldId: number;
  day: number;
  rulesVersion: string;
  stateHash: string;
  settingsHash: string;
}): string {
  return hashValue(parts);
}
