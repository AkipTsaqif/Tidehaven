import type { BindValue, Db } from './database.js';
import { loadDevelopment, loadReclaimed, saveDevelopment, saveReclaimed } from './development-repo.js';
import { storedTerrain } from '../domain/geography/land-field.js';
import {
  GOODS,
  type Business,
  type CaseRecord,
  type Contract,
  type Disaster,
  type DramaLevel,
  type Estate,
  type EstateClaim,
  type Good,
  type HealthCase,
  type HealthState,
  type LifeStatus,
  type Office,
  type OwnerType,
  type Pregnancy,
  type Proposal,
  type Relationship,
  type Resident,
  type Sentence,
  type Sex,
  type Unrest,
  type WorldState,
  emptyState,
  inventoryKey,
  ownerKey,
} from '../domain/state.js';

/**
 * State persistence.
 *
 * Snapshot tables are upserted (stable ids/keys, soft deletes), append-only tables are inserted.
 * Everything for one commit happens in a single short transaction, so a crash leaves either the
 * previous day or the new day, never a half-written world.
 */

export interface WorldRow {
  id: number;
  name: string;
  seed: string;
  rulesVersion: string;
  drama: DramaLevel;
  populationTarget: number;
  populationPolicyEnabled: boolean;
  hostCeiling: number;
  currentDay: number;
  phase: string;
  stateHash: string | null;
  configJson: string;
  createdAt: string;
}

type Row = Record<string, BindValue>;

function upsert(db: Db, table: string, columns: string[], conflictColumns: string[], row: Row): void {
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns
    .filter((c) => !conflictColumns.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  const sql =
    `insert into ${table} (${columns.join(', ')}) values (${placeholders}) ` +
    `on conflict(${conflictColumns.join(', ')}) do update set ${updates}`;
  db.run(sql, columns.map((c) => row[c] ?? null));
}

/**
 * Stable identity for an append-only effect: `<kind>:<day>:<position-in-payload>`.
 *
 * A replayed payload produces byte-identical keys in the same order, so the unique index discards the
 * duplicates. Keys are deliberately *ordered* (not content hashes): appending them keeps the index
 * B-tree sequential, which matters at soak scale — random hash keys fragment the index and slow every
 * later commit.
 */
export function effectKey(parts: readonly (string | number | null)[]): string {
  return parts.map((part) => String(part ?? '')).join(':');
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function bit(value: boolean | null | undefined): number {
  return value === true ? 1 : 0;
}

/* ------------------------------------------------------------------ load */

export function readWorld(db: Db, worldId?: number): WorldRow | null {
  const row = db.get<WorldRow>(
    `select id, name, seed, rules_version as rulesVersion, drama,
            population_target as populationTarget,
            coalesce(population_policy_enabled, 1) as populationPolicyEnabled,
            host_ceiling as hostCeiling, current_day as currentDay, phase, state_hash as stateHash,
            config_json as configJson, created_at as createdAt
       from worlds ${worldId === undefined ? 'order by id limit 1' : 'where id = ?'}`,
    worldId === undefined ? [] : [worldId],
  );
  return row ? { ...row, populationPolicyEnabled: normalisePopulationPolicy(row.populationPolicyEnabled) } : null;
}

export function listWorlds(db: Db): WorldRow[] {
  return db
    .all<WorldRow>(
      `select id, name, seed, rules_version as rulesVersion, drama,
              population_target as populationTarget,
              coalesce(population_policy_enabled, 1) as populationPolicyEnabled,
              host_ceiling as hostCeiling, current_day as currentDay, phase, state_hash as stateHash,
              config_json as configJson, created_at as createdAt
         from worlds order by id`,
    )
    .map((row) => ({ ...row, populationPolicyEnabled: normalisePopulationPolicy(row.populationPolicyEnabled) }));
}

function normalisePopulationPolicy(value: unknown): boolean {
  return value !== false && value !== 0;
}

interface ResidentRow {
  id: number;
  name: string;
  sex: Sex;
  born_day: number;
  origin: Resident['origin'];
  status: LifeStatus;
  death_day: number | null;
  death_cause: string | null;
  household_id: number | null;
  partner_id: number | null;
  mother_id: number | null;
  father_id: number | null;
  guardian_id: number | null;
  traits_json: string;
  skills_json: string;
  health_state: HealthState;
  health_json: string;
  hunger_days: number;
  education_days: number;
  legacy_of: number | null;
  emigrated_day: number | null;
  destination: string | null;
  rng_salt: number;
}

export function loadState(db: Db, world: WorldRow): WorldState {
  const state = emptyState({
    worldId: world.id,
    name: world.name,
    seed: world.seed,
    rulesVersion: world.rulesVersion,
    drama: world.drama,
    populationTarget: world.populationTarget,
    populationPolicyEnabled: normalisePopulationPolicy(world.populationPolicyEnabled),
    hostCeiling: world.hostCeiling,
  });
  state.day = world.currentDay;

  const residents = db.all<ResidentRow>(`select * from residents where world_id = ? order by id`, [world.id]);
  for (const row of residents) {
    state.residents.set(row.id, {
      id: row.id,
      name: row.name,
      sex: row.sex,
      bornDay: row.born_day,
      origin: row.origin,
      status: row.status,
      deathDay: row.death_day,
      deathCause: row.death_cause,
      householdId: row.household_id,
      partnerId: row.partner_id,
      motherId: row.mother_id,
      fatherId: row.father_id,
      guardianId: row.guardian_id,
      traits: parseJson<Record<string, number>>(row.traits_json, {}),
      skills: parseJson<Record<string, number>>(row.skills_json, {}),
      healthState: row.health_state,
      health: parseJson<Record<string, number>>(row.health_json, {}),
      hungerDays: row.hunger_days,
      educationDays: row.education_days,
      legacyOf: row.legacy_of,
      emigratedDay: row.emigrated_day,
      destination: row.destination,
      rngSalt: row.rng_salt,
    });
  }

  for (const row of db.all<Row & { id: number; name: string; building_id: number | null; capacity: number; formed_day: number; dissolved_day: number | null }>(
    `select id, name, building_id, capacity, formed_day, dissolved_day from households where world_id = ?`,
    [world.id],
  )) {
    state.households.set(row.id, {
      id: row.id,
      name: row.name,
      buildingId: row.building_id,
      capacity: row.capacity,
      formedDay: row.formed_day,
      dissolvedDay: row.dissolved_day,
    });
  }

  for (const row of db.all<Row>(`select * from buildings where world_id = ?`, [world.id])) {
    state.buildings.set(row.id as number, {
      id: row.id as number,
      name: row.name as string,
      kind: row.kind as string,
      capacity: row.capacity as number,
      conditionBps: row.condition_bps as number,
      builtDay: row.built_day as number,
      destroyedDay: (row.destroyed_day as number | null) ?? null,
      privateFlag: (row.private as number) === 1,
    });
  }

  for (const row of db.all<Row>(`select * from businesses where world_id = ?`, [world.id])) {
    state.businesses.set(row.id as number, {
      id: row.id as number,
      name: row.name as string,
      kind: row.kind as string,
      ownerType: row.owner_type as 'resident' | 'town',
      ownerId: (row.owner_id as number | null) ?? null,
      managerId: (row.manager_id as number | null) ?? null,
      buildingId: (row.building_id as number | null) ?? null,
      cashCents: row.cash_cents as number,
      openedDay: row.opened_day as number,
      closedDay: (row.closed_day as number | null) ?? null,
      status: row.status as Business['status'],
      settings: parseJson<Record<string, number>>(row.settings_json as string, {}),
    });
  }

  for (const row of db.all<Row>(`select owner_type, owner_id, balance_cents from accounts where world_id = ?`, [
    world.id,
  ])) {
    const ownerType = row.owner_type as OwnerType;
    const ownerId = (row.owner_id as number | null) ?? 0;
    state.accounts.set(ownerKey(ownerType, ownerId), {
      ownerType,
      ownerId,
      balanceCents: row.balance_cents as number,
    });
  }

  for (const row of db.all<Row>(`select owner_type, owner_id, good, quantity, reserved from inventories where world_id = ?`, [
    world.id,
  ])) {
    const ownerType = row.owner_type as OwnerType;
    const ownerId = (row.owner_id as number | null) ?? 0;
    const good = row.good as Good;
    state.inventories.set(inventoryKey(ownerType, ownerId, good), row.quantity as number);
    state.reserved.set(inventoryKey(ownerType, ownerId, good), row.reserved as number);
  }

  for (const row of db.all<Row>(`select good, price_cents from market_prices where world_id = ?`, [world.id])) {
    state.prices.set(row.good as Good, row.price_cents as number);
  }

  for (const row of db.all<Row>(`select * from relationships where world_id = ?`, [world.id])) {
    const aId = row.a_id as number;
    const bId = row.b_id as number;
    const kind = row.kind as Relationship['kind'];
    const [lo, hi] = aId <= bId ? [aId, bId] : [bId, aId];
    const key = `${kind}:${lo}:${hi}`;
    state.relationships.set(key, {
      key,
      aId,
      bId,
      kind,
      trust: row.trust as number,
      intimacy: row.intimacy as number,
      publicBelief: row.public_belief as number,
      sinceDay: row.since_day as number,
      untilDay: (row.until_day as number | null) ?? null,
      cooldownUntil: (row.cooldown_until as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from pregnancies where world_id = ?`, [world.id])) {
    state.pregnancies.set(row.id as number, {
      id: row.id as number,
      motherId: row.mother_id as number,
      fatherId: row.father_id as number,
      conceivedDay: row.conceived_day as number,
      dueDay: row.due_day as number,
      status: row.status as Pregnancy['status'],
      childId: (row.child_id as number | null) ?? null,
      resolvedDay: (row.resolved_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from contracts where world_id = ?`, [world.id])) {
    state.contracts.set(row.id as number, {
      id: row.id as number,
      kind: row.kind as Contract['kind'],
      aId: row.a_id as number,
      bId: (row.b_id as number | null) ?? null,
      businessId: (row.business_id as number | null) ?? null,
      terms: parseJson<Record<string, number | string>>(row.terms_json as string, {}),
      startDay: row.start_day as number,
      endDay: (row.end_day as number | null) ?? null,
      status: row.status as Contract['status'],
    });
  }

  for (const row of db.all<Row>(`select * from health_cases where world_id = ?`, [world.id])) {
    state.healthCases.set(row.id as number, {
      id: row.id as number,
      residentId: row.resident_id as number,
      disease: row.disease as string,
      state: row.state as HealthCase['state'],
      severity: row.severity as number,
      sinceDay: row.since_day as number,
      infectiousUntil: (row.infectious_until as number | null) ?? null,
      treatedDays: row.treated_days as number,
      resolvedDay: (row.resolved_day as number | null) ?? null,
      outcome: (row.outcome as string | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from injuries where world_id = ?`, [world.id])) {
    state.injuries.set(row.id as number, {
      id: row.id as number,
      residentId: row.resident_id as number,
      kind: row.kind as string,
      severity: row.severity as number,
      sinceDay: row.since_day as number,
      untilDay: (row.until_day as number | null) ?? null,
      disability: row.disability as number,
      resolvedDay: (row.resolved_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from disasters where world_id = ?`, [world.id])) {
    state.disasters.set(row.id as number, {
      id: row.id as number,
      kind: row.kind as Disaster['kind'],
      day: row.day as number,
      severity: row.severity as number,
      buildingId: (row.building_id as number | null) ?? null,
      stage: row.stage as Disaster['stage'],
      damage: parseJson<Record<string, number>>(row.damage_json as string, {}),
      closedDay: (row.closed_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from cases where world_id = ?`, [world.id])) {
    state.cases.set(row.id as number, {
      id: row.id as number,
      kind: row.kind as CaseRecord['kind'],
      defendantId: row.defendant_id as number,
      plaintiffId: (row.plaintiff_id as number | null) ?? null,
      openedDay: row.opened_day as number,
      status: row.status as CaseRecord['status'],
      investigationDays: row.investigation_days as number,
      prosecutionBps: row.prosecution_bps as number,
      defenceBps: row.defence_bps as number,
      verdict: (row.verdict as string | null) ?? null,
      closedDay: (row.closed_day as number | null) ?? null,
      disputedEstateId: (row.disputed_estate_id as number | null) ?? null,
      truth: parseJson<Record<string, number | string>>(row.truth_json as string, {}),
    });
  }

  for (const row of db.all<Row>(`select * from evidence where world_id = ?`, [world.id])) {
    state.evidence.set(row.id as number, {
      id: row.id as number,
      caseId: row.case_id as number,
      kind: row.kind as string,
      weightBps: row.weight_bps as number,
      public: (row.public as number) === 1,
      sourceEventId: (row.source_event_id as number | null) ?? null,
      createdDay: row.created_day as number,
    });
  }

  for (const row of db.all<Row>(`select * from sentences where world_id = ?`, [world.id])) {
    state.sentences.set(row.id as number, {
      id: row.id as number,
      caseId: row.case_id as number,
      kind: row.kind as Sentence['kind'],
      amountCents: row.amount_cents as number,
      days: row.days as number,
      startDay: row.start_day as number,
      endDay: (row.end_day as number | null) ?? null,
      status: row.status as Sentence['status'],
      releasedDay: (row.released_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from factions where world_id = ?`, [world.id])) {
    state.factions.set(row.id as number, {
      id: row.id as number,
      name: row.name as string,
      interest: row.interest as string,
      leaderId: (row.leader_id as number | null) ?? null,
      fundsCents: row.funds_cents as number,
      supportBps: row.support_bps as number,
      createdDay: row.created_day as number,
      dissolvedDay: (row.dissolved_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from faction_members where world_id = ?`, [world.id])) {
    const factionId = row.faction_id as number;
    const residentId = row.resident_id as number;
    state.factionMembers.set(`${factionId}:${residentId}`, {
      key: `${factionId}:${residentId}`,
      factionId,
      residentId,
      joinedDay: row.joined_day as number,
      leftDay: (row.left_day as number | null) ?? null,
      loyalty: row.loyalty as number,
    });
  }

  for (const row of db.all<Row>(`select * from civic_offices where world_id = ?`, [world.id])) {
    const office = row.office as Office;
    const seat = row.seat as number;
    state.offices.set(`${office}:${seat}`, {
      key: `${office}:${seat}`,
      office,
      seat,
      holderId: (row.holder_id as number | null) ?? null,
      sinceDay: row.since_day as number,
      untilDay: (row.until_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select * from unrest where world_id = ?`, [world.id])) {
    state.unrest.set(row.id as number, {
      id: row.id as number,
      kind: row.kind as Unrest['kind'],
      startedDay: row.started_day as number,
      endedDay: (row.ended_day as number | null) ?? null,
      demands: parseJson<Record<string, number | string>>(row.demands_json as string, {}),
      participants: parseJson<number[]>(row.participants_json as string, []),
      status: row.status as Unrest['status'],
      severity: row.severity as number,
    });
  }

  for (const row of db.all<Row>(`select * from grievances where world_id = ?`, [world.id])) {
    state.grievances.set(row.id as number, {
      id: row.id as number,
      residentId: row.resident_id as number,
      kind: row.kind as string,
      severity: row.severity as number,
      sinceDay: row.since_day as number,
      untilDay: (row.until_day as number | null) ?? null,
      reason: (row.reason as string | null) ?? '',
    });
  }

  for (const row of db.all<Row>(`select * from proposal_log where world_id = ?`, [world.id])) {
    state.proposals.set(row.id as number, {
      id: row.id as number,
      day: row.day as number,
      fromId: row.from_id as number,
      toId: row.to_id as number,
      kind: row.kind as Proposal['kind'],
      status: row.status as Proposal['status'],
      expiresDay: row.expires_day as number,
      detail: parseJson<Record<string, number | string>>(row.detail_json as string, {}),
    });
  }

  for (const row of db.all<Row>(`select * from estates where world_id = ?`, [world.id])) {
    state.estates.set(row.id as number, {
      id: row.id as number,
      deceasedId: row.deceased_id as number,
      openedDay: row.opened_day as number,
      closedDay: (row.closed_day as number | null) ?? null,
      status: row.status as Estate['status'],
      totalCents: row.total_cents as number,
      will: parseJson<Record<string, number> | null>(row.will_json as string, null),
      escrowCents: row.escrow_cents as number,
      disputeDeadlineDay: (row.dispute_deadline_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>('select * from wills where world_id = ?', [world.id])) {
    state.wills.set(row.resident_id as number, {
      residentId: row.resident_id as number,
      shares: parseJson<Record<string, number>>(row.shares_json as string, {}),
      recordedDay: row.recorded_day as number,
    });
  }

  for (const row of db.all<Row>(`select * from estate_claims where world_id = ?`, [world.id])) {
    state.estateClaims.set(row.id as number, {
      id: row.id as number,
      estateId: row.estate_id as number,
      claimantId: (row.claimant_id as number | null) ?? null,
      kind: row.kind as EstateClaim['kind'],
      amountCents: row.amount_cents as number,
      status: row.status as EstateClaim['status'],
      resolvedDay: (row.resolved_day as number | null) ?? null,
    });
  }

  for (const row of db.all<Row>(`select policy, value_json from civic_policies where world_id = ?`, [world.id])) {
    const value = parseJson<number | string>(row.value_json as string, 0);
    state.policies.set(row.policy as string, value);
  }

  const counters = db.get<{ value_json: string }>(`select value_json from system_flags where key = ?`, [
    `counters:${world.id}`,
  ]);
  if (counters) {
    const parsed = parseJson<Record<string, number>>(counters.value_json, {});
    for (const [key, value] of Object.entries(parsed)) state.counters.set(key, value);
  }

  const ids = db.get<{ value_json: string }>(`select value_json from system_flags where key = ?`, [
    `nextIds:${world.id}`,
  ]);
  if (ids) {
    const parsed = parseJson<Record<string, number>>(ids.value_json, {});
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') state.nextIds[key as keyof typeof state.nextIds] = value;
    }
  }

  loadDevelopment(db, state);
  loadReclaimed(db, state);
  // The coastline shape was chosen at founding and stored in the world's config; saves that predate
  // the setting are islands, exactly as they always were.
  state.terrain = storedTerrain(parseJson<unknown>(world.configJson, {}));
  return state;
}

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ save */

export interface SavePayload {
  events: EventInsert[];
  ledger: LedgerInsert[];
  flows: FlowInsert[];
  observations: ObservationInsert[];
  memories: MemoryInsert[];
  taxRecords: TaxInsert[];
  shipping: ShippingInsert[];
  articles: ArticleInsert[];
  metrics: { day: number; metrics: Record<string, unknown>; stateHash: string } | null;
  phase: string;
  stateHash: string;
  /**
   * Optional turn lifecycle completion. Committing the world and its turn transition in the same
   * transaction is what keeps "world day N is committed" and "turn day N is committed" from ever
   * disagreeing after a crash.
   */
  turnId?: number;
  turnMetrics?: Record<string, unknown>;
  turnDurationMs?: number;
  /** Operator commands whose boundary effects this payload contains; marked applied atomically. */
  commandIds?: number[];
}

export interface EventInsert {
  id: number;
  day: number;
  phase: string;
  kind: string;
  actorId: number | null;
  targetId: number | null;
  locationId: number | null;
  visibility: 'public' | 'private' | 'rumor' | 'secret';
  importance: number;
  title: string;
  detail: Record<string, unknown>;
  causeIds: number[];
  effectIds: number[];
}

export interface LedgerInsert {
  day: number;
  phase: string;
  txnId: string;
  ownerType: OwnerType;
  ownerId: number;
  deltaCents: number;
  reason: string;
  eventId: number | null;
}

export interface FlowInsert {
  day: number;
  phase: string;
  ownerType: OwnerType;
  ownerId: number;
  good: Good;
  delta: number;
  reason: string;
  eventId: number | null;
}

export interface ObservationInsert {
  day: number;
  actorId: number;
  eventId: number | null;
  visibility: string;
  summary: string;
}

export interface MemoryInsert {
  residentId: number;
  day: number;
  kind: string;
  text: string;
  importance: number;
  sourceEventIds: number[];
}

export interface TaxInsert {
  day: number;
  residentId: number | null;
  kind: string;
  amountCents: number;
}

export interface ShippingInsert {
  day: number;
  cashCents: number;
  goods: Record<string, number>;
  direction: 'import' | 'export';
}

export interface ArticleInsert {
  day: number;
  headline: string;
  body: string;
  eventIds: number[];
  generatedBy: string;
}

export function saveState(db: Db, state: WorldState, payload: SavePayload): { eventIds: number[] } {
  return db.transaction(() => {
    db.run(
      `update worlds
          set current_day = ?, phase = ?, state_hash = ?, population_target = ?,
              population_policy_enabled = ?, drama = ?
        where id = ?`,
      [
        state.day,
        payload.phase,
        payload.stateHash,
        state.populationTarget,
        state.populationPolicyEnabled ? 1 : 0,
        state.drama,
        state.worldId,
      ],
    );

    for (const resident of state.residents.values()) {
      const row: Row = {
        id: resident.id,
        world_id: state.worldId,
        name: resident.name,
        sex: resident.sex,
        born_day: resident.bornDay,
        origin: resident.origin,
        status: resident.status,
        death_day: resident.deathDay,
        death_cause: resident.deathCause,
        household_id: resident.householdId,
        partner_id: resident.partnerId,
        mother_id: resident.motherId,
        father_id: resident.fatherId,
        guardian_id: resident.guardianId,
        traits_json: json(resident.traits),
        skills_json: json(resident.skills),
        health_state: resident.healthState,
        health_json: json(resident.health),
        hunger_days: resident.hungerDays,
        education_days: resident.educationDays,
        legacy_of: resident.legacyOf,
        emigrated_day: resident.emigratedDay,
        destination: resident.destination,
        rng_salt: resident.rngSalt,
        created_at: new Date().toISOString(),
      };
      upsert(
        db,
        'residents',
        [
          'id',
          'world_id',
          'name',
          'sex',
          'born_day',
          'origin',
          'status',
          'death_day',
          'death_cause',
          'household_id',
          'partner_id',
          'mother_id',
          'father_id',
          'guardian_id',
          'traits_json',
          'skills_json',
          'health_state',
          'health_json',
          'hunger_days',
          'education_days',
          'legacy_of',
          'emigrated_day',
          'destination',
          'rng_salt',
          'created_at',
        ],
        ['id'],
        row,
      );
    }

    for (const household of state.households.values()) {
      upsert(
        db,
        'households',
        ['id', 'world_id', 'name', 'building_id', 'capacity', 'formed_day', 'dissolved_day'],
        ['id'],
        {
          id: household.id,
          world_id: state.worldId,
          name: household.name,
          building_id: household.buildingId,
          capacity: household.capacity,
          formed_day: household.formedDay,
          dissolved_day: household.dissolvedDay,
        },
      );
    }

    for (const building of state.buildings.values()) {
      upsert(
        db,
        'buildings',
        ['id', 'world_id', 'name', 'kind', 'capacity', 'condition_bps', 'built_day', 'destroyed_day', 'private'],
        ['id'],
        {
          id: building.id,
          world_id: state.worldId,
          name: building.name,
          kind: building.kind,
          capacity: building.capacity,
          condition_bps: building.conditionBps,
          built_day: building.builtDay,
          destroyed_day: building.destroyedDay,
          private: bit(building.privateFlag),
        },
      );
    }

    for (const business of state.businesses.values()) {
      // The cash column is a projection of the authoritative business account balance. Persistence
      // reads it, never writes it: saving must not mutate authoritative state after its hash is taken.
      const account = state.accounts.get(`business:${business.id}`);
      const cashCents = account ? account.balanceCents : business.cashCents;
      upsert(
        db,
        'businesses',
        [
          'id',
          'world_id',
          'name',
          'kind',
          'owner_type',
          'owner_id',
          'manager_id',
          'building_id',
          'cash_cents',
          'opened_day',
          'closed_day',
          'status',
          'settings_json',
        ],
        ['id'],
        {
          id: business.id,
          world_id: state.worldId,
          name: business.name,
          kind: business.kind,
          owner_type: business.ownerType,
          owner_id: business.ownerId,
          manager_id: business.managerId,
          building_id: business.buildingId,
          cash_cents: cashCents,
          opened_day: business.openedDay,
          closed_day: business.closedDay,
          status: business.status,
          settings_json: json(business.settings),
        },
      );
    }

    for (const account of state.accounts.values()) {
      upsert(
        db,
        'accounts',
        ['world_id', 'owner_type', 'owner_id', 'balance_cents'],
        ['world_id', 'owner_type', 'owner_id'],
        {
          world_id: state.worldId,
          owner_type: account.ownerType,
          owner_id: account.ownerId,
          balance_cents: account.balanceCents,
        },
      );
    }

    for (const [key, quantity] of state.inventories.entries()) {
      const parts = key.split(':');
      const ownerType = parts[0] as OwnerType;
      const ownerId = Number(parts[1]);
      const good = parts[2] as Good;
      upsert(
        db,
        'inventories',
        ['world_id', 'owner_type', 'owner_id', 'good', 'quantity', 'reserved'],
        ['world_id', 'owner_type', 'owner_id', 'good'],
        {
          world_id: state.worldId,
          owner_type: ownerType,
          owner_id: ownerId,
          good,
          quantity,
          reserved: state.reserved.get(key) ?? 0,
        },
      );
    }

    for (const good of GOODS) {
      const price = state.prices.get(good);
      if (price === undefined) continue;
      upsert(
        db,
        'market_prices',
        ['world_id', 'good', 'price_cents', 'updated_day'],
        ['world_id', 'good'],
        { world_id: state.worldId, good, price_cents: price, updated_day: state.day },
      );
    }

    for (const relationship of state.relationships.values()) {
      upsert(
        db,
        'relationships',
        [
          'world_id',
          'a_id',
          'b_id',
          'kind',
          'trust',
          'intimacy',
          'public_belief',
          'since_day',
          'until_day',
          'cooldown_until',
        ],
        ['world_id', 'a_id', 'b_id', 'kind'],
        {
          world_id: state.worldId,
          a_id: relationship.aId,
          b_id: relationship.bId,
          kind: relationship.kind,
          trust: relationship.trust,
          intimacy: relationship.intimacy,
          public_belief: relationship.publicBelief,
          since_day: relationship.sinceDay,
          until_day: relationship.untilDay,
          cooldown_until: relationship.cooldownUntil,
        },
      );
    }

    for (const pregnancy of state.pregnancies.values()) {
      upsert(
        db,
        'pregnancies',
        [
          'id',
          'world_id',
          'mother_id',
          'father_id',
          'conceived_day',
          'due_day',
          'status',
          'child_id',
          'resolved_day',
        ],
        ['id'],
        {
          id: pregnancy.id,
          world_id: state.worldId,
          mother_id: pregnancy.motherId,
          father_id: pregnancy.fatherId,
          conceived_day: pregnancy.conceivedDay,
          due_day: pregnancy.dueDay,
          status: pregnancy.status,
          child_id: pregnancy.childId,
          resolved_day: pregnancy.resolvedDay,
        },
      );
    }

    for (const contract of state.contracts.values()) {
      upsert(
        db,
        'contracts',
        ['id', 'world_id', 'kind', 'a_id', 'b_id', 'business_id', 'terms_json', 'start_day', 'end_day', 'status'],
        ['id'],
        {
          id: contract.id,
          world_id: state.worldId,
          kind: contract.kind,
          a_id: contract.aId,
          b_id: contract.bId,
          business_id: contract.businessId,
          terms_json: json(contract.terms),
          start_day: contract.startDay,
          end_day: contract.endDay,
          status: contract.status,
        },
      );
    }

    for (const healthCase of state.healthCases.values()) {
      upsert(
        db,
        'health_cases',
        [
          'id',
          'world_id',
          'resident_id',
          'disease',
          'state',
          'severity',
          'since_day',
          'infectious_until',
          'treated_days',
          'resolved_day',
          'outcome',
        ],
        ['id'],
        {
          id: healthCase.id,
          world_id: state.worldId,
          resident_id: healthCase.residentId,
          disease: healthCase.disease,
          state: healthCase.state,
          severity: healthCase.severity,
          since_day: healthCase.sinceDay,
          infectious_until: healthCase.infectiousUntil,
          treated_days: healthCase.treatedDays,
          resolved_day: healthCase.resolvedDay,
          outcome: healthCase.outcome,
        },
      );
    }

    for (const injury of state.injuries.values()) {
      upsert(
        db,
        'injuries',
        ['id', 'world_id', 'resident_id', 'kind', 'severity', 'since_day', 'until_day', 'disability', 'resolved_day'],
        ['id'],
        {
          id: injury.id,
          world_id: state.worldId,
          resident_id: injury.residentId,
          kind: injury.kind,
          severity: injury.severity,
          since_day: injury.sinceDay,
          until_day: injury.untilDay,
          disability: injury.disability,
          resolved_day: injury.resolvedDay,
        },
      );
    }

    for (const disaster of state.disasters.values()) {
      upsert(
        db,
        'disasters',
        ['id', 'world_id', 'kind', 'day', 'severity', 'building_id', 'stage', 'damage_json', 'closed_day'],
        ['id'],
        {
          id: disaster.id,
          world_id: state.worldId,
          kind: disaster.kind,
          day: disaster.day,
          severity: disaster.severity,
          building_id: disaster.buildingId,
          stage: disaster.stage,
          damage_json: json(disaster.damage),
          closed_day: disaster.closedDay,
        },
      );
    }

    for (const caseRecord of state.cases.values()) {
      upsert(
        db,
        'cases',
        [
          'id',
          'world_id',
          'kind',
          'defendant_id',
          'plaintiff_id',
          'opened_day',
          'status',
          'investigation_days',
          'prosecution_bps',
          'defence_bps',
          'verdict',
          'closed_day',
          'disputed_estate_id',
          'truth_json',
        ],
        ['id'],
        {
          id: caseRecord.id,
          world_id: state.worldId,
          kind: caseRecord.kind,
          defendant_id: caseRecord.defendantId,
          plaintiff_id: caseRecord.plaintiffId,
          opened_day: caseRecord.openedDay,
          status: caseRecord.status,
          investigation_days: caseRecord.investigationDays,
          prosecution_bps: caseRecord.prosecutionBps,
          defence_bps: caseRecord.defenceBps,
          verdict: caseRecord.verdict,
          closed_day: caseRecord.closedDay,
          disputed_estate_id: caseRecord.disputedEstateId,
          truth_json: json(caseRecord.truth),
        },
      );
    }

    for (const item of state.evidence.values()) {
      upsert(
        db,
        'evidence',
        ['id', 'world_id', 'case_id', 'kind', 'weight_bps', 'public', 'source_event_id', 'created_day'],
        ['id'],
        {
          id: item.id,
          world_id: state.worldId,
          case_id: item.caseId,
          kind: item.kind,
          weight_bps: item.weightBps,
          public: bit(item.public),
          source_event_id: item.sourceEventId,
          created_day: item.createdDay,
        },
      );
    }

    for (const sentence of state.sentences.values()) {
      upsert(
        db,
        'sentences',
        ['id', 'world_id', 'case_id', 'kind', 'amount_cents', 'days', 'start_day', 'end_day', 'status', 'released_day'],
        ['id'],
        {
          id: sentence.id,
          world_id: state.worldId,
          case_id: sentence.caseId,
          kind: sentence.kind,
          amount_cents: sentence.amountCents,
          days: sentence.days,
          start_day: sentence.startDay,
          end_day: sentence.endDay,
          status: sentence.status,
          released_day: sentence.releasedDay,
        },
      );
    }

    for (const faction of state.factions.values()) {
      upsert(
        db,
        'factions',
        ['id', 'world_id', 'name', 'interest', 'leader_id', 'funds_cents', 'support_bps', 'created_day', 'dissolved_day'],
        ['id'],
        {
          id: faction.id,
          world_id: state.worldId,
          name: faction.name,
          interest: faction.interest,
          leader_id: faction.leaderId,
          funds_cents: faction.fundsCents,
          support_bps: faction.supportBps,
          created_day: faction.createdDay,
          dissolved_day: faction.dissolvedDay,
        },
      );
    }

    for (const member of state.factionMembers.values()) {
      upsert(
        db,
        'faction_members',
        ['world_id', 'faction_id', 'resident_id', 'joined_day', 'left_day', 'loyalty'],
        ['world_id', 'faction_id', 'resident_id'],
        {
          world_id: state.worldId,
          faction_id: member.factionId,
          resident_id: member.residentId,
          joined_day: member.joinedDay,
          left_day: member.leftDay,
          loyalty: member.loyalty,
        },
      );
    }

    for (const seat of state.offices.values()) {
      upsert(
        db,
        'civic_offices',
        ['world_id', 'office', 'seat', 'holder_id', 'since_day', 'until_day'],
        ['world_id', 'office', 'seat'],
        {
          world_id: state.worldId,
          office: seat.office,
          seat: seat.seat,
          holder_id: seat.holderId,
          since_day: seat.sinceDay,
          until_day: seat.untilDay,
        },
      );
    }

    for (const item of state.unrest.values()) {
      upsert(
        db,
        'unrest',
        ['id', 'world_id', 'kind', 'started_day', 'ended_day', 'demands_json', 'participants_json', 'status', 'severity'],
        ['id'],
        {
          id: item.id,
          world_id: state.worldId,
          kind: item.kind,
          started_day: item.startedDay,
          ended_day: item.endedDay,
          demands_json: json(item.demands),
          participants_json: json(item.participants),
          status: item.status,
          severity: item.severity,
        },
      );
    }

    for (const grievance of state.grievances.values()) {
      upsert(
        db,
        'grievances',
        ['id', 'world_id', 'resident_id', 'kind', 'severity', 'since_day', 'until_day', 'reason'],
        ['id'],
        {
          id: grievance.id,
          world_id: state.worldId,
          resident_id: grievance.residentId,
          kind: grievance.kind,
          severity: grievance.severity,
          since_day: grievance.sinceDay,
          until_day: grievance.untilDay,
          reason: grievance.reason,
        },
      );
    }

    for (const proposal of state.proposals.values()) {
      upsert(
        db,
        'proposal_log',
        ['id', 'world_id', 'day', 'from_id', 'to_id', 'kind', 'status', 'expires_day', 'detail_json'],
        ['id'],
        {
          id: proposal.id,
          world_id: state.worldId,
          day: proposal.day,
          from_id: proposal.fromId,
          to_id: proposal.toId,
          kind: proposal.kind,
          status: proposal.status,
          expires_day: proposal.expiresDay,
          detail_json: json(proposal.detail),
        },
      );
    }

    for (const estate of state.estates.values()) {
      upsert(
        db,
        'estates',
        [
          'id',
          'world_id',
          'deceased_id',
          'opened_day',
          'closed_day',
          'status',
          'total_cents',
          'will_json',
          'escrow_cents',
          'dispute_deadline_day',
        ],
        ['id'],
        {
          id: estate.id,
          world_id: state.worldId,
          deceased_id: estate.deceasedId,
          opened_day: estate.openedDay,
          closed_day: estate.closedDay,
          status: estate.status,
          total_cents: estate.totalCents,
          will_json: json(estate.will),
          escrow_cents: estate.escrowCents,
          dispute_deadline_day: estate.disputeDeadlineDay,
        },
      );
    }

    for (const will of state.wills.values()) {
      upsert(
        db,
        'wills',
        ['world_id', 'resident_id', 'shares_json', 'recorded_day'],
        ['world_id', 'resident_id'],
        {
          world_id: state.worldId,
          resident_id: will.residentId,
          shares_json: json(will.shares),
          recorded_day: will.recordedDay,
        },
      );
    }

    for (const claim of state.estateClaims.values()) {
      upsert(
        db,
        'estate_claims',
        ['id', 'world_id', 'estate_id', 'claimant_id', 'kind', 'amount_cents', 'status', 'resolved_day'],
        ['id'],
        {
          id: claim.id,
          world_id: state.worldId,
          estate_id: claim.estateId,
          claimant_id: claim.claimantId,
          kind: claim.kind,
          amount_cents: claim.amountCents,
          status: claim.status,
          resolved_day: claim.resolvedDay,
        },
      );
    }

    for (const [policy, value] of state.policies.entries()) {
      upsert(
        db,
        'civic_policies',
        ['world_id', 'policy', 'value_json', 'set_day', 'set_by'],
        ['world_id', 'policy'],
        { world_id: state.worldId, policy, value_json: json(value), set_day: state.day, set_by: null },
      );
    }

    saveFlags(db, state);
    saveDevelopment(db, state);
    saveReclaimed(db, state);

    for (const event of payload.events) {
      db.run(
        `insert into events (id, world_id, day, phase, kind, actor_id, target_id, location_id, visibility,
                             importance, title, detail_json, cause_ids_json, effect_ids_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do nothing`,
        [
          event.id,
          state.worldId,
          event.day,
          event.phase,
          event.kind,
          event.actorId,
          event.targetId,
          event.locationId,
          event.visibility,
          event.importance,
          event.title,
          json(event.detail),
          json(event.causeIds),
          json(event.effectIds),
          new Date().toISOString(),
        ],
      );
    }

    const accountIds = accountIdMap(db, state.worldId);
    for (const [index, entry] of payload.ledger.entries()) {
      const accountId = accountIds.get(ownerKey(entry.ownerType, entry.ownerId));
      if (accountId === undefined) {
        throw new Error(`Ledger entry references an unknown account ${entry.ownerType}:${entry.ownerId}`);
      }
      db.run(
        `insert into ledger_entries (world_id, day, phase, txn_id, account_id, delta_cents, reason, event_id,
                                     effect_key, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(world_id, effect_key) do nothing`,
        [
          state.worldId,
          entry.day,
          entry.phase,
          entry.txnId,
          accountId,
          entry.deltaCents,
          entry.reason,
          entry.eventId,
          effectKey(['ledger', entry.day, index]),
          new Date().toISOString(),
        ],
      );
    }

    for (const [index, flow] of payload.flows.entries()) {
      db.run(
        `insert into goods_flows (world_id, day, phase, owner_type, owner_id, good, delta, reason, event_id, effect_key)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(world_id, effect_key) do nothing`,
        [
          state.worldId,
          flow.day,
          flow.phase,
          flow.ownerType,
          flow.ownerId,
          flow.good,
          flow.delta,
          flow.reason,
          flow.eventId,
          effectKey(['flow', flow.day, index]),
        ],
      );
    }

    for (const [index, observation] of payload.observations.entries()) {
      db.run(
        `insert into observations (world_id, day, actor_id, event_id, visibility, summary, effect_key, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(world_id, effect_key) do nothing`,
        [
          state.worldId,
          observation.day,
          observation.actorId,
          observation.eventId,
          observation.visibility,
          observation.summary,
          effectKey(['observation', observation.day, index]),
          new Date().toISOString(),
        ],
      );
    }

    for (const [index, memory] of payload.memories.entries()) {
      db.run(
        `insert into memories (world_id, resident_id, day, kind, text, importance, source_event_ids, effect_key,
                               created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(world_id, effect_key) do nothing`,
        [
          state.worldId,
          memory.residentId,
          memory.day,
          memory.kind,
          memory.text,
          memory.importance,
          json(memory.sourceEventIds),
          effectKey(['memory', memory.residentId, memory.day, index]),
          new Date().toISOString(),
        ],
      );
    }

    for (const [index, tax] of payload.taxRecords.entries()) {
      db.run(
        `insert into tax_records (world_id, day, resident_id, kind, amount_cents, effect_key)
         values (?, ?, ?, ?, ?, ?)
         on conflict(world_id, effect_key) do nothing`,
        [
          state.worldId,
          tax.day,
          tax.residentId,
          tax.kind,
          tax.amountCents,
          effectKey(['tax', tax.day, index]),
        ],
      );
    }

    for (const [index, shipping] of payload.shipping.entries()) {
      db.run(
        `insert into shipping_runs (world_id, day, cash_cents, goods_json, direction, effect_key, created_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(world_id, effect_key) do nothing`,
        [
          state.worldId,
          shipping.day,
          shipping.cashCents,
          json(shipping.goods),
          shipping.direction,
          effectKey(['shipping', shipping.day, index]),
          new Date().toISOString(),
        ],
      );
    }

    for (const article of payload.articles) {
      db.run(
        `insert into articles (world_id, day, headline, body, event_ids_json, generated_by, created_at)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict(world_id, day) do update set headline = excluded.headline, body = excluded.body,
           event_ids_json = excluded.event_ids_json, generated_by = excluded.generated_by`,
        [
          state.worldId,
          article.day,
          article.headline,
          article.body,
          json(article.eventIds),
          article.generatedBy,
          new Date().toISOString(),
        ],
      );
    }

    if (payload.metrics) {
      db.run(
        `insert into daily_metrics (world_id, day, metrics_json, state_hash) values (?, ?, ?, ?)
         on conflict(world_id, day) do update set metrics_json = excluded.metrics_json, state_hash = excluded.state_hash`,
        [state.worldId, payload.metrics.day, json(payload.metrics.metrics), payload.metrics.stateHash],
      );
    }

    // Turn lifecycle + command dispositions live in the same transaction as the world outcome.
    if (payload.turnId !== undefined) {
      const updated = db.run(
        `update turns set phase = 'committed', committed_at = ?, state_hash_after = ?, duration_ms = ?, metrics_json = ?
          where id = ? and phase != 'committed'`,
        [
          new Date().toISOString(),
          payload.stateHash,
          payload.turnDurationMs ?? null,
          json(payload.turnMetrics ?? null),
          payload.turnId,
        ],
      );
      if (updated.changes === 0) {
        // The world must never commit without its turn: that is exactly the crash divergence F20.
        throw new Error(`Turn ${payload.turnId} could not be marked committed`);
      }
      // Any *other* turn at or before the committed day is stale by definition (an interrupted commit
      // from an earlier run). Close it in the same transaction so the invariant "no open turn for a
      // committed day" holds atomically, not only after the next restart reconciles.
      db.run(
        `update turns set phase = 'committed', committed_at = coalesce(committed_at, ?)
          where world_id = ? and day <= ? and phase != 'committed'`,
        [new Date().toISOString(), state.worldId, state.day],
      );
    }
    for (const commandId of payload.commandIds ?? []) {
      const updated = db.run(
        `update operator_commands set status = 'applied', applied_at = ?, applied_day = ?
          where id = ? and status = 'pending'`,
        [new Date().toISOString(), state.day, commandId],
      );
      if (updated.changes === 0) {
        throw new Error(`Operator command ${commandId} is no longer pending`);
      }
    }

    return { eventIds: payload.events.map((e) => e.id) };
  });
}

function saveFlags(db: Db, state: WorldState): void {
  const counters = Object.fromEntries([...state.counters.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  const nextIds = Object.fromEntries([...Object.entries(state.nextIds)].sort((a, b) => a[0].localeCompare(b[0])));
  const now = new Date().toISOString();
  for (const [key, value] of [
    [`counters:${state.worldId}`, counters],
    [`nextIds:${state.worldId}`, nextIds],
  ] as const) {
    upsert(db, 'system_flags', ['key', 'value_json', 'updated_at'], ['key'], {
      key,
      value_json: JSON.stringify(value),
      updated_at: now,
    });
  }
}

/** Resolve the numeric account row id for ledger entries; cached per save. */
export function accountIdMap(db: Db, worldId: number): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of db.all<{ id: number; owner_type: string; owner_id: number | null }>(
    'select id, owner_type, owner_id from accounts where world_id = ?',
    [worldId],
  )) {
    map.set(ownerKey(row.owner_type as OwnerType, row.owner_id ?? 0), row.id);
  }
  return map;
}

/**
 * Operational flags that must survive a restart but are **not** authoritative world state.
 *
 * Artifact bookkeeping (last checkpoint day, last backup day) lives here rather than in
 * `state.counters`: mutating hashed state after the commit would make the live canonical hash differ
 * from the stored one, and the update could never be persisted without a second commit.
 */
export function readRunFlag(db: Db, worldId: number, name: string): number | null {
  const row = db.get<{ value_json: string }>('select value_json from system_flags where key = ?', [
    `run:${name}:${worldId}`,
  ]);
  if (!row) return null;
  const value = Number(row.value_json);
  return Number.isFinite(value) ? value : null;
}

export function writeRunFlag(db: Db, worldId: number, name: string, value: number): void {
  upsert(db, 'system_flags', ['key', 'value_json', 'updated_at'], ['key'], {
    key: `run:${name}:${worldId}`,
    value_json: JSON.stringify(value),
    updated_at: new Date().toISOString(),
  });
}

export function escapeSqlLike(value: string): string {
  return value.replace(/[%_\\]/g, (m) => `\\${m}`);
}
