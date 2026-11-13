import type { Db } from '../storage/database.js';
import { developmentQuery } from './development-query.js';

/**
 * Read-model queries for the dashboard. All bounded and paginated; no secrets, no prompt payloads,
 * and no cross-origin exposure. Numbers are returned as strings where they can exceed 2^53 in JSON
 * consumers (none do today, but money is documented as integer cents).
 */

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

function clampLimit(limit: number | undefined, fallback = 50, max = 200): number {
  if (!limit || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(limit)));
}

function clampOffset(offset: number | undefined): number {
  if (!offset || !Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

export function overview(db: Db, worldId: number): Record<string, unknown> | null {
  const world = db.get<{
    id: number;
    name: string;
    current_day: number;
    phase: string;
    state_hash: string | null;
    population_target: number;
    population_policy_enabled: number | null;
    host_ceiling: number;
    drama: string;
    rules_version: string;
  }>(
    `select id, name, current_day, phase, state_hash, population_target,
            population_policy_enabled, host_ceiling, drama, rules_version
       from worlds where id = ?`,
    [worldId],
  );
  if (!world) return null;

  const populations = db.get<{ living: number; dead: number; emigrated: number; births: number }>(
    `select
       sum(case when status = 'living' then 1 else 0 end) as living,
       sum(case when status = 'dead' then 1 else 0 end) as dead,
       sum(case when status = 'emigrated' then 1 else 0 end) as emigrated,
       sum(case when origin = 'born' then 1 else 0 end) as births
     from residents where world_id = ?`,
    [worldId],
  );
  const households = db.get<{ count: number }>(
    `select count(*) as count from households where world_id = ? and dissolved_day is null`,
    [worldId],
  );
  const businesses = db.get<{ open: number; closed: number }>(
    `select sum(case when status = 'open' then 1 else 0 end) as open,
            sum(case when status !== 'open' then 1 else 0 end) as closed
       from businesses where world_id = ?`,
    [worldId],
  );
  const accounts = db.get<{ treasury: number; total: number; households: number; residents: number; businesses: number }>(
    `select
       coalesce(sum(case when owner_type = 'treasury' then balance_cents else 0 end), 0) as treasury,
       coalesce(sum(balance_cents), 0) as total,
       coalesce(sum(case when owner_type = 'household' then balance_cents else 0 end), 0) as households,
       coalesce(sum(case when owner_type = 'resident' then balance_cents else 0 end), 0) as residents,
       coalesce(sum(case when owner_type = 'business' then balance_cents else 0 end), 0) as businesses
     from accounts where world_id = ?`,
    [worldId],
  );
  const metrics = db.get<{ metrics_json: string; state_hash: string }>(
    `select metrics_json, state_hash from daily_metrics where world_id = ? order by day desc limit 1`,
    [worldId],
  );
  const pregnancies = db.get<{ count: number }>(
    `select count(*) as count from pregnancies where world_id = ? and status = 'active'`,
    [worldId],
  );
  const events = db.get<{ count: number }>(`select count(*) as count from events where world_id = ?`, [worldId]);
  const openCases = db.get<{ count: number }>(
    `select count(*) as count from cases where world_id = ? and status !== 'closed'`,
    [worldId],
  );
  const unrest = db.get<{ count: number }>(
    `select count(*) as count from unrest where world_id = ? and status = 'active'`,
    [worldId],
  );

  return {
    world: {
      id: world.id,
      name: world.name,
      day: world.current_day,
      phase: world.phase,
      stateHash: world.state_hash,
      populationTarget: world.population_target,
      populationPolicyEnabled: world.population_policy_enabled !== 0,
      hostCeiling: world.host_ceiling ?? 500,
      drama: world.drama,
      rulesVersion: world.rules_version,
    },
    population: {
      living: populations?.living ?? 0,
      dead: populations?.dead ?? 0,
      emigrated: populations?.emigrated ?? 0,
      bornHere: populations?.births ?? 0,
      expectedBirths: pregnancies?.count ?? 0,
    },
    households: households?.count ?? 0,
    businesses: { open: businesses?.open ?? 0, closed: businesses?.closed ?? 0 },
    money: {
      treasuryCents: accounts?.treasury ?? 0,
      totalCents: accounts?.total ?? 0,
      householdCents: accounts?.households ?? 0,
      residentCents: accounts?.residents ?? 0,
      businessCents: accounts?.businesses ?? 0,
    },
    events: events?.count ?? 0,
    openCases: openCases?.count ?? 0,
    unrest: unrest?.count ?? 0,
    latestMetrics: metrics ? safeJson(metrics.metrics_json) : null,
  };
}

export function townView(db: Db, worldId: number): Record<string, unknown> {
  const prices = db.all<{ good: string; price_cents: number }>(
    'select good, price_cents from market_prices where world_id = ? order by good',
    [worldId],
  );
  const businesses = db.all<{
    id: number;
    name: string;
    kind: string;
    status: string;
    cash_cents: number;
    owner_id: number | null;
    building_id: number | null;
    staff: number;
  }>(
    `select b.id, b.name, b.kind, b.status, b.cash_cents, b.owner_id, b.building_id,
            (select count(*) from contracts c where c.world_id = b.world_id and c.business_id = b.id
              and c.kind = 'employment' and c.status = 'active') as staff
       from businesses b where b.world_id = ? order by b.id`,
    [worldId],
  );
  const households = db.all<{
    id: number;
    name: string;
    building_id: number | null;
    capacity: number;
    members: number;
    cash_cents: number;
  }>(
    `select h.id, h.name, h.building_id, h.capacity,
            (select count(*) from residents r where r.world_id = h.world_id and r.household_id = h.id and r.status = 'living') as members,
            (select coalesce(balance_cents, 0) from accounts a where a.world_id = h.world_id and a.owner_type = 'household' and a.owner_id = h.id) as cash_cents
       from households h where h.world_id = ? and h.dissolved_day is null order by h.id`,
    [worldId],
  );
  const stock = db.all<{ good: string; total: number }>(
    `select good, sum(quantity) as total from inventories where world_id = ? group by good order by good`,
    [worldId],
  );
  const buildings = db.all<{ id: number; name: string; kind: string; condition_bps: number }>(
    'select id, name, kind, condition_bps from buildings where world_id = ? order by id',
    [worldId],
  );
  const lendings = db.all<{ name: string; amount: number }>(
    `select reason as name, sum(delta_cents) as amount from ledger_entries
      where world_id = ? and day = (select max(current_day) from worlds where id = ?)
      group by reason order by abs(sum(delta_cents)) desc limit 12`,
    [worldId, worldId],
  );
  return { prices, businesses, households, stock, buildings, development: developmentQuery(db, worldId), recentFlows: lendings };
}

export function residentsPage(
  db: Db,
  worldId: number,
  params: { limit?: number; offset?: number; search?: string; status?: string },
): Page<Record<string, unknown>> {
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);
  const search = params.search?.trim() ?? '';
  const status = params.status ?? 'living';
  const like = `%${search.replace(/[%_]/g, '')}%`;
  const where = `world_id = ? and (? = '' or name like ?) and (? = 'all' or status = ?)`;
  const args = [worldId, search, like, status, status];
  const total =
    db.get<{ count: number }>(`select count(*) as count from residents where ${where}`, args)?.count ?? 0;
  const items = db.all<Record<string, unknown>>(
    `select id, name, sex, born_day as bornDay, status, household_id as householdId, partner_id as partnerId,
            health_state as healthState, hunger_days as hungerDays, education_days as educationDays,
            origin, death_day as deathDay, death_cause as deathCause, destination
       from residents where ${where} order by id limit ? offset ?`,
    [...args, limit, offset],
  );
  return { items, total, limit, offset };
}

export function residentDetail(db: Db, worldId: number, residentId: number): Record<string, unknown> | null {
  const resident = db.get<Record<string, unknown>>(
    `select id, name, sex, born_day as bornDay, status, origin, household_id as householdId,
            partner_id as partnerId, mother_id as motherId, father_id as fatherId, guardian_id as guardianId,
            traits_json as traitsJson, skills_json as skillsJson, health_state as healthState,
            health_json as healthJson, hunger_days as hungerDays, education_days as educationDays,
            death_day as deathDay, death_cause as deathCause, emigrated_day as emigratedDay, destination
       from residents where world_id = ? and id = ?`,
    [worldId, residentId],
  );
  if (!resident) return null;

  const account = db.get<{ balance_cents: number }>(
    `select balance_cents from accounts where world_id = ? and owner_type = 'resident' and owner_id = ?`,
    [worldId, residentId],
  );
  const inventory = db.all<{ good: string; quantity: number }>(
    `select good, quantity from inventories where world_id = ? and owner_type = 'resident' and owner_id = ? and quantity > 0`,
    [worldId, residentId],
  );
  const employment = db.get<Record<string, unknown>>(
    `select c.id as contractId, c.business_id as businessId, b.name as businessName, c.terms_json as termsJson,
            c.start_day as startDay
       from contracts c left join businesses b on b.id = c.business_id
      where c.world_id = ? and c.a_id = ? and c.kind = 'employment' and c.status = 'active' limit 1`,
    [worldId, residentId],
  );
  const relationships = db.all<Record<string, unknown>>(
    `select kind, case when a_id = ? then b_id else a_id end as otherId, trust, intimacy, since_day as sinceDay, until_day as untilDay
       from relationships where world_id = ? and (a_id = ? or b_id = ?) order by kind, otherId limit 50`,
    [residentId, worldId, residentId, residentId],
  );
  const events = db.all<Record<string, unknown>>(
    `select id, day, kind, title, visibility, importance from events
      where world_id = ? and (actor_id = ? or target_id = ?) order by id desc limit 30`,
    [worldId, residentId, residentId],
  );
  const memories = db.all<{ day: number; kind: string; text: string; importance: number }>(
    `select day, kind, text, importance from memories where world_id = ? and resident_id = ?
      order by importance desc, day desc limit 25`,
    [worldId, residentId],
  );
  const health = db.all<Record<string, unknown>>(
    `select id, disease, state, severity, since_day as sinceDay, resolved_day as resolvedDay
       from health_cases where world_id = ? and resident_id = ? order by id desc limit 10`,
    [worldId, residentId],
  );
  const injuries = db.all<Record<string, unknown>>(
    `select id, kind, severity, since_day as sinceDay, until_day as untilDay, disability
       from injuries where world_id = ? and resident_id = ? order by id desc limit 10`,
    [worldId, residentId],
  );
  const cases = db.all<Record<string, unknown>>(
    `select id, kind, status, verdict, opened_day as openedDay, closed_day as closedDay
       from cases where world_id = ? and (defendant_id = ? or plaintiff_id = ?) order by id desc limit 10`,
    [worldId, residentId, residentId],
  );
  const sentences = db.all<Record<string, unknown>>(
    `select s.id, s.kind, s.days, s.status, s.start_day as startDay, s.end_day as endDay
       from sentences s join cases c on c.id = s.case_id
      where s.world_id = ? and c.defendant_id = ? order by s.id desc limit 10`,
    [worldId, residentId],
  );
  const children = db.all<{ id: number; name: string }>(
    `select id, name from residents where world_id = ? and (mother_id = ? or father_id = ?) order by id`,
    [worldId, residentId, residentId],
  );
  const parents = db.all<{ id: number; name: string }>(
    `select id, name from residents where world_id = ? and id in (
       select mother_id from residents where id = ? and mother_id is not null
       union select father_id from residents where id = ? and father_id is not null)`,
    [worldId, residentId, residentId],
  );
  const grievances = db.all<{ kind: string; severity: number; reason: string }>(
    `select kind, severity, reason from grievances where world_id = ? and resident_id = ? and (until_day is null or until_day > ?)
      order by severity desc limit 10`,
    [worldId, residentId, 0],
  );

  return {
    ...resident,
    traits: safeJson(String(resident.traitsJson ?? '{}')),
    skills: safeJson(String(resident.skillsJson ?? '{}')),
    healthDetail: safeJson(String(resident.healthJson ?? '{}')),
    cashCents: account?.balance_cents ?? 0,
    inventory,
    employment,
    relationships,
    events,
    memories,
    health,
    injuries,
    cases,
    sentences,
    children,
    parents,
    grievances,
  };
}

export function eventsPage(
  db: Db,
  worldId: number,
  params: { limit?: number; offset?: number; day?: number; kind?: string; actorId?: number; visibility?: string },
): Page<Record<string, unknown>> {
  const limit = clampLimit(params.limit, 60, 300);
  const offset = clampOffset(params.offset);
  const clauses = ['world_id = ?'];
  const args: (string | number)[] = [worldId];
  if (params.day !== undefined) {
    clauses.push('day = ?');
    args.push(params.day);
  }
  if (params.kind) {
    clauses.push('kind = ?');
    args.push(params.kind);
  }
  if (params.actorId !== undefined) {
    clauses.push('(actor_id = ? or target_id = ?)');
    args.push(params.actorId, params.actorId);
  }
  if (params.visibility) {
    clauses.push('visibility = ?');
    args.push(params.visibility);
  }
  const where = clauses.join(' and ');
  const total = db.get<{ count: number }>(`select count(*) as count from events where ${where}`, args)?.count ?? 0;
  const items = db.all<Record<string, unknown>>(
    `select id, day, phase, kind, actor_id as actorId, target_id as targetId, location_id as locationId,
            visibility, importance, title, detail_json as detailJson, cause_ids_json as causeIdsJson,
            effect_ids_json as effectIdsJson
       from events where ${where} order by id desc limit ? offset ?`,
    [...args, limit, offset],
  );
  return {
    items: items.map((item) => ({
      ...item,
      detail: safeJson(String(item.detailJson ?? '{}')),
      causeIds: safeJson(String(item.causeIdsJson ?? '[]')),
      effectIds: safeJson(String(item.effectIdsJson ?? '[]')),
    })),
    total,
    limit,
    offset,
  };
}

export function dramaView(db: Db, worldId: number): Record<string, unknown> {
  const disasters = db.all<Record<string, unknown>>(
    `select id, kind, day, severity, stage, building_id as buildingId, closed_day as closedDay
       from disasters where world_id = ? order by id desc limit 20`,
    [worldId],
  );
  const illnesses = db.all<Record<string, unknown>>(
    `select h.id, h.resident_id as residentId, r.name, h.disease, h.state, h.severity, h.since_day as sinceDay
       from health_cases h join residents r on r.id = h.resident_id
      where h.world_id = ? and h.resolved_day is null order by h.id desc limit 40`,
    [worldId],
  );
  const cases = db.all<Record<string, unknown>>(
    `select c.id, c.kind, c.status, c.verdict, c.defendant_id as defendantId, d.name as defendantName,
            c.plaintiff_id as plaintiffId, p.name as plaintiffName, c.opened_day as openedDay, c.closed_day as closedDay
       from cases c
       left join residents d on d.id = c.defendant_id
       left join residents p on p.id = c.plaintiff_id
      where c.world_id = ? order by c.id desc limit 40`,
    [worldId],
  );
  const evidence = db.all<Record<string, unknown>>(
    `select id, case_id as caseId, kind, weight_bps as weightBps, public, created_day as createdDay
       from evidence where world_id = ? order by id desc limit 100`,
    [worldId],
  );
  const sentences = db.all<Record<string, unknown>>(
    `select id, case_id as caseId, kind, amount_cents as amountCents, days, status, start_day as startDay, end_day as endDay
       from sentences where world_id = ? order by id desc limit 40`,
    [worldId],
  );
  const factions = db.all<Record<string, unknown>>(
    `select id, name, interest, leader_id as leaderId, funds_cents as fundsCents, support_bps as supportBps,
            created_day as createdDay, dissolved_day as dissolvedDay
       from factions where world_id = ? order by id desc limit 20`,
    [worldId],
  );
  const offices = db.all<Record<string, unknown>>(
    `select o.office, o.seat, o.holder_id as holderId, r.name as holderName, o.since_day as sinceDay
       from civic_offices o left join residents r on r.id = o.holder_id
      where o.world_id = ? order by o.office, o.seat`,
    [worldId],
  );
  const unrest = db.all<Record<string, unknown>>(
    `select id, kind, started_day as startedDay, ended_day as endedDay, status, severity, participants_json as participantsJson
       from unrest where world_id = ? order by id desc limit 30`,
    [worldId],
  );
  const estates = db.all<Record<string, unknown>>(
    `select id, deceased_id as deceasedId, status, total_cents as totalCents, opened_day as openedDay, closed_day as closedDay
       from estates where world_id = ? order by id desc limit 30`,
    [worldId],
  );
  return {
    disasters,
    illnesses,
    cases,
    evidence,
    sentences,
    factions,
    offices,
    unrest: unrest.map((u) => ({ ...u, participants: safeJson(String(u.participantsJson ?? '[]')) })),
    estates,
  };
}

export function historyPage(
  db: Db,
  worldId: number,
  params: { limit?: number; offset?: number; search?: string },
): Page<Record<string, unknown>> {
  const limit = clampLimit(params.limit, 20, 100);
  const offset = clampOffset(params.offset);
  const search = params.search?.trim() ?? '';
  const like = `%${search.replace(/[%_]/g, '')}%`;
  const total =
    db.get<{ count: number }>(
      `select count(*) as count from articles where world_id = ? and (? = '' or headline like ? or body like ?)`,
      [worldId, search, like, like],
    )?.count ?? 0;
  const items = db.all<Record<string, unknown>>(
    `select day, headline, body, event_ids_json as eventIdsJson, generated_by as generatedBy
       from articles where world_id = ? and (? = '' or headline like ? or body like ?)
      order by day desc limit ? offset ?`,
    [worldId, search, like, like, limit, offset],
  );
  return {
    items: items.map((item) => ({ ...item, eventIds: safeJson(String(item.eventIdsJson ?? '[]')) })),
    total,
    limit,
    offset,
  };
}

export function metricsSeries(db: Db, worldId: number, limit = 120): Record<string, unknown>[] {
  const rows = db.all<{ day: number; metrics_json: string; state_hash: string }>(
    `select day, metrics_json, state_hash from daily_metrics where world_id = ? order by day desc limit ?`,
    [worldId, Math.max(1, Math.min(400, limit))],
  );
  return rows.reverse().map((row) => ({ day: row.day, stateHash: row.state_hash, metrics: safeJson(row.metrics_json) }));
}

export function latestArticle(db: Db, worldId: number): Record<string, unknown> | null {
  const row = db.get<{ day: number; headline: string; body: string; event_ids_json: string; generated_by: string }>(
    `select day, headline, body, event_ids_json, generated_by from articles where world_id = ? order by day desc limit 1`,
    [worldId],
  );
  if (!row) return null;
  return { ...row, eventIds: safeJson(row.event_ids_json) };
}

export function genealogy(db: Db, worldId: number, residentId: number): Record<string, unknown> {
  const ancestors: Record<string, unknown>[] = [];
  const descendants: Record<string, unknown>[] = [];
  let frontier = [residentId];
  const seen = new Set<number>([residentId]);
  for (let depth = 0; depth < 5 && frontier.length > 0; depth += 1) {
    const rows = db.all<{ id: number; name: string; mother_id: number | null; father_id: number | null }>(
      `select id, name, mother_id, father_id from residents where world_id = ? and id in (${frontier.map(() => '?').join(',')})`,
      [worldId, ...frontier],
    );
    const next: number[] = [];
    for (const row of rows) {
      for (const parentId of [row.mother_id, row.father_id]) {
        if (parentId === null || seen.has(parentId)) continue;
        seen.add(parentId);
        const parent = db.get<{ id: number; name: string }>(`select id, name from residents where world_id = ? and id = ?`, [
          worldId,
          parentId,
        ]);
        if (parent) {
          ancestors.push({ ...parent, depth: depth + 1 });
          next.push(parentId);
        }
      }
    }
    frontier = next;
  }
  frontier = [residentId];
  const seenDown = new Set<number>([residentId]);
  for (let depth = 0; depth < 5 && frontier.length > 0; depth += 1) {
    const rows = db.all<{ id: number; name: string; born_day: number; status: string }>(
      `select id, name, born_day, status from residents where world_id = ? and (mother_id in (${frontier
        .map(() => '?')
        .join(',')}) or father_id in (${frontier.map(() => '?').join(',')}))`,
      [worldId, ...frontier, ...frontier],
    );
    const next: number[] = [];
    for (const row of rows) {
      if (seenDown.has(row.id)) continue;
      seenDown.add(row.id);
      descendants.push({ ...row, depth: depth + 1 });
      next.push(row.id);
    }
    frontier = next;
  }
  return { residentId, ancestors, descendants };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
