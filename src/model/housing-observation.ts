import type { Scenario } from '../contracts/scenario.js';
import { isAdult } from '../domain/clock.js';
import type { Proposal, WorldState } from '../domain/state.js';

export interface HousingObservationInput {
  state: WorldState;
  scenario: Scenario;
  actorId: number;
  day: number;
  maxHosts?: number;
  maxRequests?: number;
}

export interface HousingHostObservation {
  householdId: number;
  buildingId: number;
  hostIds: number[];
  occupied: number;
  capacity: number;
  availableBeds: number;
}

export interface HousingRequestObservation {
  proposalId: number;
  requesterId: number;
  hostResidentId: number;
  hostHouseholdId: number;
  expiresDay: number;
  status: Proposal['status'];
  role: 'requester' | 'host';
  needsYourDecision: boolean;
  approvedByYou: boolean;
}

export interface HousingObservation {
  hosts: HousingHostObservation[];
  requests: HousingRequestObservation[];
  usableHostIds: number[];
  usableRequestIds: number[];
}

/** Build a bounded, privacy-filtered housing view for one resident. */
export function buildHousingObservation(input: HousingObservationInput): HousingObservation {
  const { state, scenario, actorId, day } = input;
  const maxHosts = boundedLimit(input.maxHosts, 16);
  const maxRequests = boundedLimit(input.maxRequests, 16);
  const hosts: HousingHostObservation[] = [];
  const usableHostIds: number[] = [];

  for (const household of [...state.households.values()].sort((a, b) => a.id - b.id)) {
    if (hosts.length >= maxHosts || household.dissolvedDay !== null || household.buildingId === null) continue;
    const building = state.buildings.get(household.buildingId);
    if (!building || building.kind !== 'home' || building.destroyedDay !== null) continue;
    const members = [...state.residents.values()].filter((resident) => resident.status === 'living' && resident.householdId === household.id);
    const hostIds = members
      .filter((resident) => isAdult(resident.bornDay, day, scenario.calendar))
      .map((resident) => resident.id)
      .sort((a, b) => a - b);
    if (hostIds.length === 0) continue;
    const availableBeds = Math.max(0, household.capacity - members.length);
    hosts.push({
      householdId: household.id,
      buildingId: building.id,
      hostIds,
      occupied: members.length,
      capacity: household.capacity,
      availableBeds,
    });
    if (availableBeds > 0) usableHostIds.push(...hostIds);
  }

  const requests = [...state.proposals.values()]
    .filter((proposal) => proposal.kind === 'settle')
    .filter((proposal) => proposal.fromId === actorId || proposal.toId === actorId || proposalHosts(proposal).includes(actorId))
    .sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1) || a.id - b.id)
    .slice(0, maxRequests)
    .flatMap((proposal): HousingRequestObservation[] => {
      const hostHouseholdId = detailNumber(proposal.detail.hostHouseholdId);
      if (hostHouseholdId === null) return [];
      const roster = proposalHosts(proposal);
      const role: HousingRequestObservation['role'] = proposal.fromId === actorId ? 'requester' : 'host';
      const host = roster.includes(actorId) && proposal.status === 'pending';
      return [
        {
          proposalId: proposal.id,
          requesterId: proposal.fromId,
          hostResidentId: proposal.toId,
          hostHouseholdId,
          expiresDay: proposal.expiresDay,
          status: proposal.status,
          role,
          needsYourDecision: host,
          approvedByYou: parseIds(detailString(proposal.detail.approvals)).includes(actorId),
        },
      ];
    });

  const usableRequestIds = requests.filter((request) => request.status === 'pending').map((request) => request.proposalId);
  return {
    hosts,
    requests,
    usableHostIds: [...new Set(usableHostIds)].sort((a, b) => a - b),
    usableRequestIds: [...new Set(usableRequestIds)].sort((a, b) => a - b),
  };
}

/** Positional convenience for callers that already have state/scenario separated. */
export function housingObservation(
  state: WorldState,
  scenario: Scenario,
  actorId: number,
  day: number,
  limits: Pick<HousingObservationInput, 'maxHosts' | 'maxRequests'> = {},
): HousingObservation {
  return buildHousingObservation({ state, scenario, actorId, day, ...limits });
}

export const housingObservationForActor = buildHousingObservation;

function boundedLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(64, Math.trunc(value ?? fallback)));
}

function detailNumber(value: number | string | undefined): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function detailString(value: number | string | undefined): string {
  return typeof value === 'string' ? value : '';
}

function parseIds(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item > 0);
  } catch {
    return [];
  }
}

function proposalHosts(proposal: Proposal): number[] {
  return parseIds(detailString(proposal.detail.hostRoster));
}
