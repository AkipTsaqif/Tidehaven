import type { Contract, Resident, WorldState } from './state.js';

/**
 * One-pass lookup tables for hot loops.
 *
 * Several phases answer a per-household or per-resident question ("who lives here?", "where does this
 * person work?") inside a loop over every household or resident. Answering it with a full scan each
 * time makes a day cost O(population²). These helpers build the answer for everyone in one pass.
 *
 * Contract: a table is a snapshot. Build it immediately before the loop that reads it, and only use it
 * where that loop does not change what the table indexes (household membership, life status, or
 * employment contracts). Every table preserves the iteration order of the scan it replaces, so outcomes
 * — and therefore state hashes — are unchanged.
 */

/** Living residents per household, each list in `state.residents` iteration order. */
export function livingMembersByHousehold(state: WorldState): Map<number, Resident[]> {
  const byHousehold = new Map<number, Resident[]>();
  for (const resident of state.residents.values()) {
    if (resident.status !== 'living' || resident.householdId === null) continue;
    const list = byHousehold.get(resident.householdId);
    if (list) list.push(resident);
    else byHousehold.set(resident.householdId, [resident]);
  }
  return byHousehold;
}

/**
 * The contract `activeEmploymentContract(state, day, residentId)` would return for each resident: the
 * first active, unexpired employment contract in `state.contracts` iteration order.
 */
export function activeEmploymentByResident(state: WorldState, day: number): Map<number, Contract> {
  const byResident = new Map<number, Contract>();
  for (const contract of state.contracts.values()) {
    if (contract.kind !== 'employment' || contract.status !== 'active') continue;
    if (contract.endDay !== null && contract.endDay < day) continue;
    if (!byResident.has(contract.aId)) byResident.set(contract.aId, contract);
  }
  return byResident;
}

/** Residents holding any active employment contract, regardless of its end day. */
export function residentsWithActiveEmployment(state: WorldState): Set<number> {
  const employed = new Set<number>();
  for (const contract of state.contracts.values()) {
    if (contract.kind === 'employment' && contract.status === 'active') employed.add(contract.aId);
  }
  return employed;
}

/**
 * Read-only lookups shared by every prompt built against one unchanging state (one collection round).
 * The runner builds this once per day instead of once per resident.
 */
export interface ObservationLookups {
  state: WorldState;
  day: number;
  membersByHousehold: Map<number, Resident[]>;
  employmentByResident: Map<number, Contract>;
  /** Live households that occupy a building (for free-home counts). */
  occupiedBuildingIds: Set<number | null>;
  /** Active employment contracts per business (any end day; callers apply their own filters). */
  staffByBusiness: Map<number, Contract[]>;
}

export function buildObservationLookups(state: WorldState, day: number): ObservationLookups {
  return {
    state,
    day,
    membersByHousehold: livingMembersByHousehold(state),
    employmentByResident: activeEmploymentByResident(state, day),
    occupiedBuildingIds: new Set(
      [...state.households.values()].filter((h) => h.dissolvedDay === null && h.buildingId !== null).map((h) => h.buildingId),
    ),
    staffByBusiness: activeEmploymentByBusiness(state),
  };
}

/** Active employment contracts per business, each list in `state.contracts` iteration order. */
export function activeEmploymentByBusiness(state: WorldState): Map<number, Contract[]> {
  const byBusiness = new Map<number, Contract[]>();
  for (const contract of state.contracts.values()) {
    if (contract.kind !== 'employment' || contract.status !== 'active' || contract.businessId === null) continue;
    const list = byBusiness.get(contract.businessId);
    if (list) list.push(contract);
    else byBusiness.set(contract.businessId, [contract]);
  }
  return byBusiness;
}
