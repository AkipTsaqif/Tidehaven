import type { Scenario } from '../contracts/scenario.js';
import type { FoundingMapOptions } from '../contracts/map.js';
import { resolveMapOptions } from './map-layout.js';
import type { Db } from '../storage/database.js';
import { hashValue } from '../domain/hash.js';
import { entitySalt } from '../domain/rng.js';
import {
  GOODS,
  type Building,
  type Business,
  type Good,
  type Household,
  type Office,
  type Resident,
  type WorldState,
  addGoods,
  emptyState,
  getAccount,
  nextId,
} from '../domain/state.js';
import {
  saveState,
  type EventInsert,
  type FlowInsert,
  type SavePayload,
  type WorldRow,
} from '../storage/repositories.js';
import { RULES_VERSION } from './scenario.js';

/**
 * Town creation. Everything here is deterministic given the scenario: no RNG, no wall-clock
 * decisions. Bootstrap issuance of money and goods is recorded explicitly (flows + base counter) so
 * conservation invariants hold from day one.
 */

export interface BootstrapResult {
  world: WorldRow;
  state: WorldState;
  created: boolean;
}

const CAPITAL_GOODS: Record<string, Record<string, number>> = {
  bakery: { grain: 8 },
  workshop: { timber: 6 },
  clinic: { medicine: 6 },
  farm: {},
  fishery: {},
  timber_camp: {},
  shop: {},
  guard_house: {},
  court: {},
  council: {},
};

const TOOLS_PER_BUSINESS = 4;

function bornDayFor(age: number, index: number, calendar: Scenario['calendar']): number {
  // Deterministic birth offset inside the year so ages are not all on the same date.
  const offset = (index * 37) % calendar.daysPerYear;
  return -(age * calendar.daysPerYear) + offset;
}

export function rulesVersionFor(scenario: Scenario): string {
  return `${RULES_VERSION}:${hashValue(scenario).slice(0, 12)}`;
}

export function createTown(params: {
  db: Db;
  scenario: Scenario;
  worldName: string;
  seed: string;
  populationTarget: number;
  populationPolicyEnabled?: boolean;
  hostCeiling: number;
  drama: WorldState['drama'];
  createdAt?: string;
  mapOptions?: FoundingMapOptions;
}): BootstrapResult {
  const { db, scenario, worldName, seed, populationTarget, hostCeiling, drama } = params;
  const populationPolicyEnabled = params.populationPolicyEnabled ?? true;
  const createdAt = params.createdAt ?? new Date().toISOString();
  const rulesVersion = rulesVersionFor(scenario);
  const configJson = JSON.stringify({
    scenarioVersion: scenario.version,
    calendar: scenario.calendar,
    map: resolveMapOptions(scenario.version, seed, params.mapOptions),
  });

  const existing = db.get<{ id: number }>('select id from worlds order by id limit 1');
  if (existing) {
    throw new Error(`A town already exists in this data directory (world ${existing.id}); refusing to overwrite`);
  }

  db.run(
    'insert into rules_versions (version, hash, scenario_json, created_at) values (?, ?, ?, ?) ' +
      'on conflict(version) do nothing',
    [rulesVersion, hashValue(scenario), JSON.stringify(scenario), createdAt],
  );
  const insert = db.run(
    `insert into worlds (name, seed, created_at, rules_version, drama, population_target, population_policy_enabled, host_ceiling, current_day, phase, config_json)
     values (?, ?, ?, ?, ?, ?, ?, ?, 0, 'idle', ?)`,
    [
      worldName,
      seed,
      createdAt,
      rulesVersion,
      drama,
      populationTarget,
      populationPolicyEnabled ? 1 : 0,
      hostCeiling,
      configJson,
    ],
  );
  const worldId = insert.lastInsertRowid;

  const state = buildState({ worldId, scenario, worldName, seed, drama, populationTarget, populationPolicyEnabled, hostCeiling });
  const payload = bootstrapPayload(state, scenario);
  const stateHash = hashValue({ bootstrap: true, day: state.day, seed });
  saveState(db, state, { ...payload, phase: 'idle', stateHash });

  const world: WorldRow = {
    id: worldId,
    name: worldName,
    seed,
    rulesVersion,
    drama,
    populationTarget,
    populationPolicyEnabled,
    hostCeiling,
    currentDay: 0,
    phase: 'idle',
    stateHash,
    configJson,
    createdAt,
  };
  return { world, state, created: true };
}

export function buildState(params: {
  worldId: number;
  scenario: Scenario;
  worldName: string;
  seed: string;
  drama: WorldState['drama'];
  populationTarget: number;
  populationPolicyEnabled?: boolean;
  hostCeiling: number;
}): WorldState {
  const { scenario, seed } = params;
  const state = emptyState({
    worldId: params.worldId,
    name: params.worldName,
    seed,
    rulesVersion: rulesVersionFor(scenario),
    drama: params.drama,
    populationTarget: params.populationTarget,
    populationPolicyEnabled: params.populationPolicyEnabled,
    hostCeiling: params.hostCeiling,
  });
  state.day = 0;

  // Prices
  for (const good of GOODS) {
    const ref = scenario.economy.referencePrices[good];
    state.prices.set(good, ref.price);
  }

  // Buildings
  for (const def of scenario.town.buildings) {
    const building: Building = {
      id: def.id,
      name: def.name,
      kind: def.kind,
      capacity: def.capacity,
      conditionBps: 10_000,
      builtDay: 0,
      destroyedDay: null,
      privateFlag: def.kind === 'home',
    };
    state.buildings.set(building.id, building);
  }
  state.nextIds.building = Math.max(...scenario.town.buildings.map((b) => b.id)) + 1;

  // Households
  for (const def of scenario.town.households) {
    const household: Household = {
      id: def.id,
      name: def.name,
      buildingId: def.building,
      capacity: state.buildings.get(def.building)?.capacity ?? 4,
      formedDay: 0,
      dissolvedDay: null,
    };
    state.households.set(household.id, household);
    getAccount(state, 'household', household.id).balanceCents = scenario.economy.householdCashCents;
  }
  state.nextIds.household = Math.max(...scenario.town.households.map((h) => h.id)) + 1;

  // Residents
  scenario.town.residents.forEach((def, index) => {
    const id = index + 1;
    const resident: Resident = {
      id,
      name: def.name,
      sex: def.sex,
      bornDay: bornDayFor(def.age, index, scenario.calendar),
      origin: 'founder',
      status: 'living',
      deathDay: null,
      deathCause: null,
      householdId: def.household,
      partnerId: null,
      motherId: null,
      fatherId: null,
      guardianId: null,
      traits: { ...def.traits },
      skills: {},
      healthState: 'healthy',
      health: { wellbeing: 60, lastCheckDay: 0 },
      hungerDays: 0,
      educationDays: 0,
      legacyOf: null,
      emigratedDay: null,
      destination: null,
      rngSalt: entitySalt(seed, id),
    };
    state.residents.set(id, resident);
    getAccount(state, 'resident', id).balanceCents = 0;
  });
  state.nextIds.resident = scenario.town.residents.length + 1;
  linkFoundingPartners(state, scenario);

  // Businesses
  for (const def of scenario.town.businesses) {
    const id = nextId(state, 'business');
    const owner = def.owner === null ? null : findResidentByName(state, def.owner);
    const business: Business = {
      id,
      name: def.name,
      kind: def.kind,
      ownerType: owner === null ? 'town' : 'resident',
      ownerId: owner?.id ?? null,
      managerId: owner?.id ?? null,
      buildingId: def.building,
      cashCents:
        owner === null ? scenario.economy.townBusinessStartCashCents : scenario.economy.businessStartCashCents,
      openedDay: 0,
      closedDay: null,
      status: 'open',
      settings: {},
    };
    state.businesses.set(id, business);
    getAccount(state, 'business', id).balanceCents = business.cashCents;
  }

  // Treasury + external settlement account: bootstrap issuance is the money base.
  const treasury = getAccount(state, 'treasury', 0);
  treasury.balanceCents = scenario.economy.treasuryCents;
  const external = getAccount(state, 'external', 0);
  external.balanceCents = scenario.economy.externalCashCents;

  // Initial goods: household reserves, business input stock, tools.
  const reserveDays = scenario.economy.householdReserveDays;
  for (const household of state.households.values()) {
    const members = [...state.residents.values()].filter((r) => r.householdId === household.id).length;
    const food = members * reserveDays * scenario.economy.foodNeedPerDay;
    const weights = scenario.economy.householdBasketWeights;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
    for (const good of scenario.economy.mealGoods) {
      const share = weights[good] ?? 0;
      addGoods(state, 'household', household.id, good, Math.floor((food * share) / totalWeight));
    }
  }
  for (const business of state.businesses.values()) {
    const capital = CAPITAL_GOODS[business.kind] ?? {};
    for (const [good, quantity] of Object.entries(capital)) {
      addGoods(state, 'business', business.id, good as Good, quantity);
    }
    addGoods(state, 'business', business.id, 'tools', TOOLS_PER_BUSINESS);
  }
  addGoods(state, 'treasury', 0, 'medicine', scenario.economy.clinicMedicinePerDay * 30);
  addGoods(state, 'treasury', 0, 'tools', 6);

  // Employment contracts for seeded jobs.
  scenario.town.residents.forEach((def, index) => {
    if (def.job === null) return;
    const residentId = index + 1;
    const business = findBusinessByName(state, def.job);
    if (!business) return;
    const recipe = scenario.economy.recipes[business.kind];
    const wageClass = recipe?.wageClass ?? 'unskilled';
    const contractId = nextId(state, 'contract');
    state.contracts.set(contractId, {
      id: contractId,
      kind: 'employment',
      aId: residentId,
      bId: business.id,
      businessId: business.id,
      terms: { wageClass, wageCents: scenario.economy.wages[wageClass] },
      startDay: 1,
      endDay: null,
      status: 'active',
    });
  });

  // Civic offices: deterministic founding holders (highest diligence adults, by id).
  const adults = [...state.residents.values()]
    .filter((r) => isFoundingAdult(r, scenario))
    .sort((a, b) => (b.traits.diligence ?? 0) - (a.traits.diligence ?? 0) || a.id - b.id);
  let cursor = 0;
  const officePlan: Office[] = [
    ...(Array.from({ length: scenario.town.councilSeats }, () => 'councillor' as Office) as Office[]),
    'magistrate',
    'guard_captain',
    'clerk',
  ];
  const seatCounters = new Map<Office, number>();
  for (const office of officePlan) {
    const seat = seatCounters.get(office) ?? 0;
    seatCounters.set(office, seat + 1);
    const key = `${office}:${seat}`;
    const holder = adults[cursor % Math.max(1, adults.length)];
    cursor += 1;
    state.offices.set(key, {
      key,
      office,
      seat,
      holderId: holder?.id ?? null,
      sinceDay: 0,
      untilDay: null,
    });
  }

  // Goods flow counters start from the bootstrap stock so that stock == recorded flows from day one.
  for (const good of GOODS) {
    let total = 0;
    for (const [key, quantity] of state.inventories.entries()) {
      if (key.endsWith(`:${good}`)) total += quantity;
    }
    state.counters.set(`goodsFlow:${good}`, total);
  }

  // Counters and policies.
  const moneyBase = [...state.accounts.values()].reduce((sum, a) => sum + a.balanceCents, 0);
  state.counters.set('moneyBaseCents', moneyBase);
  state.counters.set('pressureDays', 0);
  state.counters.set('legitimacyBps', 7000);
  state.counters.set('lastElectionDay', 0);
  state.counters.set('unrestDays', 0);
  state.counters.set('strikeDays', 0);
  state.counters.set('dayCounter', 0);
  state.policies.set('incomeTaxBps', scenario.economy.incomeTaxBps);
  state.policies.set('salesTaxBps', scenario.economy.salesTaxBps);
  state.policies.set('businessLevyBps', scenario.economy.businessLevyBps);

  return state;
}

function isFoundingAdult(resident: Resident, scenario: Scenario): boolean {
  const age = -resident.bornDay + 0;
  return age >= scenario.calendar.adultDays;
}

function findResidentByName(state: WorldState, name: string): Resident | null {
  for (const resident of state.residents.values()) {
    if (resident.name === name) return resident;
  }
  return null;
}

function findBusinessByName(state: WorldState, name: string): Business | null {
  for (const business of state.businesses.values()) {
    if (business.name === name) return business;
  }
  return null;
}

/** Founding couples share a household and are already partnered; everything else is single. */
function linkFoundingPartners(state: WorldState, scenario: Scenario): void {
  const byHousehold = new Map<number, Resident[]>();
  for (const resident of state.residents.values()) {
    if (resident.householdId === null) continue;
    const list = byHousehold.get(resident.householdId) ?? [];
    list.push(resident);
    byHousehold.set(resident.householdId, list);
  }
  for (const members of byHousehold.values()) {
    const adults = members
      .filter((r) => -r.bornDay >= scenario.calendar.adultDays && -r.bornDay < scenario.calendar.elderDays)
      .sort((a, b) => a.id - b.id);
    for (let i = 0; i < adults.length - 1; i += 1) {
      const a = adults[i];
      if (!a || a.partnerId !== null) continue;
      const b = adults.slice(i + 1).find((candidate) => candidate.partnerId === null && candidate.sex !== a.sex);
      if (!b) continue;
      a.partnerId = b.id;
      b.partnerId = a.id;
      const key = `partner:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
      state.relationships.set(key, {
        key,
        aId: Math.min(a.id, b.id),
        bId: Math.max(a.id, b.id),
        kind: 'partner',
        trust: 70,
        intimacy: 55,
        publicBelief: 80,
        sinceDay: -730,
        untilDay: null,
        cooldownUntil: null,
      });
    }
  }
}

/** Initial event documenting the founding, so history is never empty. */
function bootstrapPayload(state: WorldState, scenario: Scenario): Omit<SavePayload, 'phase' | 'stateHash'> {
  const events: EventInsert[] = [];
  const eventId = nextId(state, 'event');
  events.push({
    id: eventId,
    day: 0,
    phase: 'bootstrap',
    kind: 'world_founded',
    actorId: null,
    targetId: null,
    locationId: null,
    visibility: 'public',
    importance: 100,
    title: `${state.name} is founded`,
    detail: {
      residents: state.residents.size,
      households: state.households.size,
      businesses: state.businesses.size,
      scenario: scenario.version,
    },
    causeIds: [],
    effectIds: [],
  });

  const flows: FlowInsert[] = [];
  for (const [key, quantity] of state.inventories.entries()) {
    if (quantity === 0) continue;
    const parts = key.split(':');
    flows.push({
      day: 0,
      phase: 'bootstrap',
      ownerType: parts[0] as FlowInsert['ownerType'],
      ownerId: Number(parts[1]),
      good: parts[2] as FlowInsert['good'],
      delta: quantity,
      reason: 'bootstrap_goods',
      eventId,
    });
  }

  const observations = [];
  for (const resident of state.residents.values()) {
    observations.push({
      day: 0,
      actorId: resident.id,
      eventId,
      visibility: 'public',
      summary: `The town of ${state.name} was founded.`,
    });
  }

  return {
    events,
    ledger: [],
    flows,
    observations,
    memories: [],
    taxRecords: [],
    shipping: [],
    articles: [],
    metrics: {
      day: 0,
      metrics: {
        population: state.residents.size,
        households: state.households.size,
        businesses: state.businesses.size,
        moneySupplyCents: [...state.accounts.values()].reduce((sum, a) => sum + a.balanceCents, 0),
        founding: true,
      },
      stateHash: hashValue({ bootstrap: true }),
    },
  };
}
