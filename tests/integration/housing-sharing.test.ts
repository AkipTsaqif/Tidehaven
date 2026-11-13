import { describe, expect, it } from 'vitest';
import { buildHousingObservation } from '../../src/model/housing-observation.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { createHousehold, householdMembers } from '../../src/domain/society/households.js';
import { housingSharingPhase, replyHousing, requestHousing } from '../../src/domain/society/housing-sharing.js';
import { stateHash } from '../../src/domain/hash.js';
import { loadState, saveState, type SavePayload } from '../../src/storage/repositories.js';
import { seedTown, planFor } from '../fixtures/seed-town.js';
import { isAdult } from '../../src/domain/clock.js';
import type { ActorPlan } from '../../src/contracts/actions.js';

function makeCamp(town: Awaited<ReturnType<typeof seedTown>>, name = 'Independent camp', excludedIds: number[] = []) {
  const ctx = createTurnContext({ state: town.state, scenario: town.scenario, day: Math.max(1, town.state.day + 1) });
  const resident = [...town.state.residents.values()].find(
    (candidate) =>
      !excludedIds.includes(candidate.id) &&
      candidate.status === 'living' &&
      (candidate.householdId === null || town.state.households.get(candidate.householdId)?.buildingId !== null) &&
      isAdult(candidate.bornDay, ctx.day, town.scenario.calendar) &&
      ![...town.state.residents.values()].some(
        (other) =>
          other.status === 'living' &&
          other.bornDay > ctx.day - town.scenario.calendar.adultDays &&
          (other.motherId === candidate.id || other.fatherId === candidate.id || other.guardianId === candidate.id),
      ),
  );
  if (!resident) throw new Error('fixture has no independent adult');
  if (resident.partnerId !== null) {
    const partner = town.state.residents.get(resident.partnerId);
    if (partner) partner.partnerId = null;
    resident.partnerId = null;
  }
  const camp = createHousehold(ctx, name, null, 1);
  resident.householdId = camp.id;
  town.state.accounts.get(`household:${camp.id}`)!.balanceCents = 1_234;
  town.state.inventories.set(`household:${camp.id}:timber`, 4);
  return { ctx, resident, camp };
}

function findHost(town: Awaited<ReturnType<typeof seedTown>>, day: number, excludedHouseholds: number[] = []) {
  const ctx = createTurnContext({ state: town.state, scenario: town.scenario, day });
  const hostHousehold = [...town.state.households.values()]
    .sort((a, b) => a.id - b.id)
    .find((household) => {
      if (excludedHouseholds.includes(household.id) || household.dissolvedDay !== null || household.buildingId === null) return false;
      const building = town.state.buildings.get(household.buildingId);
      const members = householdMembers(ctx, household.id);
      return Boolean(
        building &&
          building.kind === 'home' &&
          building.destroyedDay === null &&
          members.length < household.capacity &&
          members.some((member) => isAdult(member.bornDay, day, town.scenario.calendar)),
      );
    });
  if (!hostHousehold) throw new Error('fixture has no host household with a spare bed');
  const host = householdMembers(ctx, hostHousehold.id).find((member) => isAdult(member.bornDay, day, town.scenario.calendar));
  if (!host) throw new Error('fixture host has no adult');
  return { ctx, household: hostHousehold, host };
}

function emptyPayload(stateHashValue: string): SavePayload {
  return {
    events: [],
    ledger: [],
    flows: [],
    observations: [],
    memories: [],
    taxRecords: [],
    shipping: [],
    articles: [],
    metrics: null,
    phase: 'committed',
    stateHash: stateHashValue,
  };
}

describe('consent-based housing sharing', () => {
  it('requires every current adult host and preserves partner ids while transferring camp assets', async () => {
    const town = await seedTown({ seed: 'housing-consent' });
    try {
      const { ctx, resident, camp } = makeCamp(town);
      const host = findHost(town, ctx.day);
      const beforePartner = resident.partnerId;
      const request = requestHousing(ctx, resident.id, host.host.id, { enabled: true });
      expect(request.ok).toBe(true);
      expect(request.proposalId).toBeDefined();
      const proposalId = request.proposalId!;
      const roster = [...householdMembers(ctx, host.household.id)]
        .filter((member) => isAdult(member.bornDay, ctx.day, town.scenario.calendar))
        .map((member) => member.id)
        .sort((a, b) => a - b);
      expect(replyHousing(ctx, roster[0]!, proposalId, 'accept', { enabled: true }).moved).toBe(roster.length === 1);
      if (roster.length > 1) expect(town.state.residents.get(resident.id)!.householdId).toBe(camp.id);
      for (const hostId of roster.slice(1)) expect(replyHousing(ctx, hostId, proposalId, 'accept', { enabled: true }).ok).toBe(true);
      expect(town.state.residents.get(resident.id)!.householdId).toBe(host.household.id);
      expect(town.state.households.get(camp.id)!.dissolvedDay).toBe(ctx.day);
      expect(town.state.accounts.get(`household:${host.household.id}`)!.balanceCents).toBeGreaterThanOrEqual(1_234);
      expect(town.state.inventories.get(`household:${host.household.id}:timber`)).toBeGreaterThanOrEqual(4);
      expect(town.state.residents.get(resident.id)!.partnerId).toBe(beforePartner);
      expect(town.state.proposals.get(proposalId)!.status).toBe('accepted');
    } finally {
      town.db.close();
    }
  });

  it('does not move on silence, refusal, death, roster change, full bed, or expiry', async () => {
    const town = await seedTown({ seed: 'housing-rejections' });
    try {
      const first = makeCamp(town, 'camp-one');
      const host = findHost(town, first.ctx.day);
      const silent = requestHousing(first.ctx, first.resident.id, host.host.id, { enabled: true, requestDays: 1 });
      expect(silent.ok).toBe(true);
      expect(town.state.residents.get(first.resident.id)!.householdId).toBe(first.camp.id);
      const refused = replyHousing(first.ctx, host.host.id, silent.proposalId!, 'refuse', { enabled: true });
      expect(refused.ok).toBe(true);
      expect(town.state.residents.get(first.resident.id)!.householdId).toBe(first.camp.id);

      const second = makeCamp(town, 'camp-two');
      const hostTwo = findHost(town, second.ctx.day);
      const death = requestHousing(second.ctx, second.resident.id, hostTwo.host.id, { enabled: true });
      expect(death.ok).toBe(true);
      hostTwo.host.status = 'dead';
      expect(replyHousing(second.ctx, hostTwo.host.id, death.proposalId!, 'accept', { enabled: true }).ok).toBe(false);
      expect(town.state.residents.get(second.resident.id)!.householdId).toBe(second.camp.id);

      const third = makeCamp(town, 'camp-three');
      const hostThree = findHost(town, third.ctx.day);
      const changed = requestHousing(third.ctx, third.resident.id, hostThree.host.id, { enabled: true });
      expect(changed.ok).toBe(true);
      const newcomer = [...town.state.residents.values()].find((candidate) => candidate.id !== third.resident.id && candidate.householdId === hostThree.household.id && candidate.status === 'living');
      if (newcomer) newcomer.status = 'dead';
      expect(replyHousing(third.ctx, hostThree.host.id, changed.proposalId!, 'accept', { enabled: true }).ok).toBe(false);
      expect(town.state.residents.get(third.resident.id)!.householdId).toBe(third.camp.id);

      const fourth = makeCamp(town, 'camp-four');
      const hostFour = findHost(town, fourth.ctx.day);
      const full = requestHousing(fourth.ctx, fourth.resident.id, hostFour.host.id, { enabled: true });
      expect(full.ok).toBe(true);
      const filler = [...town.state.residents.values()].find((candidate) => candidate.householdId === hostFour.household.id && candidate.status === 'living');
      if (filler) {
        const household = town.state.households.get(hostFour.household.id)!;
        while (householdMembers(hostFour.ctx, household.id).length < household.capacity) {
          const extra = [...town.state.residents.values()].find((candidate) => candidate.householdId === fourth.camp.id && candidate.id !== fourth.resident.id);
          if (extra) break;
          break;
        }
      }
      hostFour.household.capacity = householdMembers(hostFour.ctx, hostFour.household.id).length;
      expect(replyHousing(hostFour.ctx, hostFour.host.id, full.proposalId!, 'accept', { enabled: true }).ok).toBe(false);
      expect(town.state.residents.get(fourth.resident.id)!.householdId).toBe(fourth.camp.id);

      const fifth = makeCamp(town, 'camp-five');
      const hostFive = findHost(town, fifth.ctx.day);
      const expired = requestHousing(fifth.ctx, fifth.resident.id, hostFive.host.id, { enabled: true, requestDays: 1 });
      expect(expired.ok).toBe(true);
      const expiredCtx = createTurnContext({ state: town.state, scenario: town.scenario, day: fifth.ctx.day + 2 });
      expect(replyHousing(expiredCtx, hostFive.host.id, expired.proposalId!, 'accept', { enabled: true }).ok).toBe(false);
      expect(town.state.proposals.get(expired.proposalId!)!.status).toBe('expired');
    } finally {
      town.db.close();
    }
  });

  it('uses one request for duplicates, rejects children and dependent movers, and resolves competition deterministically', async () => {
    const town = await seedTown({ seed: 'housing-bounds' });
    try {
      const first = makeCamp(town, 'camp-a');
      const host = findHost(town, first.ctx.day);
      const hostBuilding = town.state.buildings.get(host.household.buildingId!);
      host.household.capacity = Math.min(hostBuilding?.capacity ?? host.household.capacity, householdMembers(host.ctx, host.household.id).length + 1);
      const one = requestHousing(first.ctx, first.resident.id, host.host.id, { enabled: true });
      const duplicate = requestHousing(first.ctx, first.resident.id, host.host.id, { enabled: true });
      expect(duplicate.proposalId).toBe(one.proposalId);
      expect([...town.state.proposals.values()].filter((proposal) => proposal.kind === 'settle')).toHaveLength(1);

      const second = makeCamp(town, 'camp-b', [first.resident.id, host.host.id]);
      const secondRequest = requestHousing(second.ctx, second.resident.id, host.host.id, { enabled: true });
      expect(secondRequest.ok).toBe(true);
      const hostRoster = [...householdMembers(host.ctx, host.household.id)]
        .filter((member) => isAdult(member.bornDay, host.ctx.day, town.scenario.calendar))
        .map((member) => member.id)
        .sort((a, b) => a - b);
      const plans = new Map<number, ActorPlan>();
      for (const hostId of hostRoster) plans.set(hostId, planFor(hostId, { social: { kind: 'accept_housing', targetId: one.proposalId } }));
      housingSharingPhase(host.ctx, plans, { enabled: true });
      for (const hostId of hostRoster) replyHousing(host.ctx, hostId, secondRequest.proposalId!, 'accept', { enabled: true });
      expect(town.state.residents.get(first.resident.id)!.householdId).toBe(host.household.id);
      expect(town.state.residents.get(second.resident.id)!.householdId).toBe(second.camp.id);
    } finally {
      town.db.close();
    }
  });

  it('reloads a pending settle proposal and exposes only bounded actor-relevant observations', async () => {
    const town = await seedTown({ seed: 'housing-persistence' });
    try {
      const { ctx, resident } = makeCamp(town, 'reload-camp');
      const host = findHost(town, ctx.day);
      const request = requestHousing(ctx, resident.id, host.host.id, { enabled: true });
      expect(request.ok).toBe(true);
      const before = stateHash(town.state);
      saveState(town.db, town.state, emptyPayload(before));
      const world = (await import('../../src/storage/repositories.js')).readWorld(town.db, town.worldId)!;
      const reloaded = loadState(town.db, world);
      expect(stateHash(reloaded)).toBe(before);
      expect(reloaded.proposals.get(request.proposalId!)?.kind).toBe('settle');
      const observation = buildHousingObservation({ state: reloaded, scenario: town.scenario, actorId: resident.id, day: ctx.day, maxRequests: 1 });
      expect(observation.requests).toHaveLength(1);
      expect(observation.usableRequestIds).toContain(request.proposalId);
      expect(JSON.stringify(observation)).not.toContain('cashCents');
      expect(JSON.stringify(observation)).not.toContain('traits');
    } finally {
      town.db.close();
    }
  });

  it('keeps request/reply order deterministic when host approvals arrive in reverse order', async () => {
    const left = await seedTown({ seed: 'housing-order' });
    const right = await seedTown({ seed: 'housing-order' });
    try {
      const a = makeCamp(left, 'same-camp');
      const b = makeCamp(right, 'same-camp');
      const leftHost = findHost(left, a.ctx.day);
      const rightHost = findHost(right, b.ctx.day);
      const leftRequest = requestHousing(a.ctx, a.resident.id, leftHost.host.id, { enabled: true });
      const rightRequest = requestHousing(b.ctx, b.resident.id, rightHost.host.id, { enabled: true });
      const leftRoster = [...householdMembers(a.ctx, leftHost.household.id)].filter((member) => isAdult(member.bornDay, a.ctx.day, left.scenario.calendar)).map((member) => member.id).sort((x, y) => x - y);
      const rightRoster = [...householdMembers(b.ctx, rightHost.household.id)].filter((member) => isAdult(member.bornDay, b.ctx.day, right.scenario.calendar)).map((member) => member.id).sort((x, y) => x - y);
      for (const id of [...leftRoster].reverse()) replyHousing(a.ctx, id, leftRequest.proposalId!, 'accept', { enabled: true });
      for (const id of [...rightRoster].reverse()) replyHousing(b.ctx, id, rightRequest.proposalId!, 'accept', { enabled: true });
      expect(stateHash(left.state)).toBe(stateHash(right.state));
    } finally {
      left.db.close();
      right.db.close();
    }
  });
});
