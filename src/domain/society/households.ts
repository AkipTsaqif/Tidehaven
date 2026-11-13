import type { TurnContext } from '../turn-context.js';
import type { Scenario } from '../../contracts/scenario.js';
import { nextId, quantityOf, type Good, type Household, type Resident, type WorldState } from '../state.js';
import { livingMembersByHousehold } from '../lookups.js';

/**
 * Household membership and care. Dependants are never left unassigned: when a caregiver dies or
 * leaves, the nearest willing adult relative becomes guardian; failing that, the council appoints one.
 */

export function createHousehold(ctx: TurnContext, name: string, buildingId: number | null, capacity: number): Household {
  const id = nextId(ctx.state, 'household');
  const household: Household = { id, name, buildingId, capacity, formedDay: ctx.day, dissolvedDay: null };
  ctx.state.households.set(id, household);
  ctx.state.accounts.set(`household:${id}`, { ownerType: 'household', ownerId: id, balanceCents: 0 });
  return household;
}

/** A home building with no active household attached (lowest id first), or null. */
export function findVacantHome(ctx: TurnContext): number | null {
  for (const building of [...ctx.state.buildings.values()].sort((a, b) => a.id - b.id)) {
    if (building.kind !== 'home' || building.destroyedDay !== null) continue;
    const occupied = [...ctx.state.households.values()].some(
      (household) => household.buildingId === building.id && household.dissolvedDay === null,
    );
    if (!occupied) return building.id;
  }
  return null;
}

export function householdMembers(ctx: TurnContext, householdId: number): Resident[] {
  return [...ctx.state.residents.values()].filter((r) => r.householdId === householdId && r.status === 'living');
}

export function householdFoodDays(ctx: TurnContext, householdId: number): number {
  return householdFoodDaysFor(ctx.state, ctx.scenario, householdId);
}

/** Pure form used by prompt building and diagnostics (no turn context needed). */
export function householdFoodDaysFor(state: WorldState, scenario: Scenario, householdId: number): number {
  let memberCount = 0;
  for (const r of state.residents.values()) if (r.householdId === householdId && r.status === 'living') memberCount += 1;
  return householdFoodDaysForCount(state, scenario, householdId, memberCount);
}

/** `householdFoodDaysFor` when the caller already knows the household's living member count. */
export function householdFoodDaysForCount(
  state: WorldState,
  scenario: Scenario,
  householdId: number,
  memberCount: number,
): number {
  if (memberCount === 0) return 0;
  let food = 0;
  for (const good of scenario.economy.mealGoods as readonly Good[]) {
    food += quantityOf(state, 'household', householdId, good);
  }
  return Math.floor(food / Math.max(1, memberCount * scenario.economy.foodNeedPerDay));
}

export function moveResident(ctx: TurnContext, residentId: number, householdId: number): boolean {
  const resident = ctx.state.residents.get(residentId);
  const household = ctx.state.households.get(householdId);
  if (!resident || resident.status !== 'living' || !household || household.dissolvedDay !== null) return false;
  if (householdMembers(ctx, householdId).length >= household.capacity) return false;
  resident.householdId = householdId;
  return true;
}

/**
 * Reassign care for minors when their caregiver dies. Prefers adult kin (highest trust, then id),
 * then the household's remaining adult, then a council-appointed guardian with spare capacity.
 */
export function reassignCare(ctx: TurnContext, deceased: Resident): void {
  const minors = [...ctx.state.residents.values()].filter(
    (r) =>
      r.status === 'living' &&
      r.bornDay > ctx.day - ctx.scenario.calendar.adultDays &&
      (r.motherId === deceased.id || r.fatherId === deceased.id || r.guardianId === deceased.id),
  );
  for (const child of minors) {
    const hasLivingParent = [child.motherId, child.fatherId]
      .filter((id): id is number => id !== null && id !== deceased.id)
      .some((id) => ctx.state.residents.get(id)?.status === 'living');
    if (hasLivingParent) continue;

    const kin = [...ctx.state.residents.values()]
      .filter(
        (r) =>
          r.status === 'living' &&
          r.id !== child.id &&
          r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays &&
          isKin(ctx, r.id, child.id),
      )
      .sort((a, b) => trustOf(ctx, a.id, child.id) * -1 || a.id - b.id);

    const existingHousehold = child.householdId === null ? null : ctx.state.households.get(child.householdId);
    const householdAdults = (existingHousehold ? householdMembers(ctx, existingHousehold.id) : []).filter(
      (r) => r.id !== child.id && r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays,
    );
    const candidate = kin[0] ?? householdAdults[0] ?? appointGuardian(ctx, child);
    if (!candidate) {
      ctx.emit({
        kind: 'orphan_unassigned',
        actorId: child.id,
        targetId: null,
        visibility: 'private',
        importance: 70,
        title: `${child.name} has no caregiver available`,
        detail: {},
      });
      continue;
    }
    child.guardianId = candidate.id;
    if (candidate.householdId !== null) {
      const target = ctx.state.households.get(candidate.householdId);
      if (target && target.dissolvedDay === null && householdMembers(ctx, target.id).length < target.capacity) {
        child.householdId = target.id;
      }
    }
    ctx.emit({
      kind: 'guardianship_assigned',
      actorId: candidate.id,
      targetId: child.id,
      visibility: 'public',
      importance: 55,
      title: `${candidate.name} took in ${child.name}`,
      detail: { deceasedId: deceased.id },
    });
  }
}

function isKin(ctx: TurnContext, aId: number, bId: number): boolean {
  const a = ctx.state.residents.get(aId);
  const b = ctx.state.residents.get(bId);
  if (!a || !b) return false;
  if (a.motherId === b.motherId && a.motherId !== null) return true;
  if (b.motherId === aId || b.fatherId === aId || a.motherId === bId || a.fatherId === bId) return true;
  if (a.partnerId === bId || b.partnerId === aId) return true;
  return false;
}

function trustOf(ctx: TurnContext, aId: number, bId: number): number {
  const key = `friend:${Math.min(aId, bId)}:${Math.max(aId, bId)}`;
  return ctx.state.relationships.get(key)?.trust ?? 50;
}

function appointGuardian(ctx: TurnContext, child: Resident): Resident | null {
  const adults = [...ctx.state.residents.values()]
    .filter((r) => r.status === 'living' && r.id !== child.id && r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays)
    .sort((a, b) => (b.traits.diligence ?? 0) - (a.traits.diligence ?? 0) || a.id - b.id);
  return adults[0] ?? null;
}

/**
 * Housing guarantee: every living resident belongs to a household with a building. A dissolved or
 * missing household must not silently drop someone out of the food system.
 */
export function rehouseOrphans(ctx: TurnContext): void {
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    const household = resident.householdId === null ? null : ctx.state.households.get(resident.householdId);
    if (household && household.dissolvedDay === null) continue;
    const withRoom = [...ctx.state.households.values()]
      .filter((h) => h.dissolvedDay === null)
      .filter((h) => householdMembers(ctx, h.id).length < h.capacity)
      .sort((a, b) => a.id - b.id)[0];
    if (withRoom) {
      resident.householdId = withRoom.id;
      continue;
    }
    const vacantHome = [...ctx.state.buildings.values()]
      .filter((b) => b.kind === 'home' && b.destroyedDay === null)
      .find(
        (building) =>
          ![...ctx.state.households.values()].some((h) => h.buildingId === building.id && h.dissolvedDay === null),
      );
    if (vacantHome) {
      const created = createHousehold(ctx, `${resident.name}'s house`, vacantHome.id, vacantHome.capacity);
      resident.householdId = created.id;
      ctx.emit({
        kind: 'household_formed',
        actorId: resident.id,
        targetId: created.id,
        visibility: 'public',
        importance: 25,
        title: `${resident.name} set up a new household`,
        detail: { buildingId: vacantHome.id },
      });
      continue;
    }
    ctx.emit({
      kind: 'homeless_resident',
      actorId: resident.id,
      targetId: null,
      visibility: 'public',
      importance: 60,
      title: `${resident.name} has nowhere to live`,
      detail: {},
    });
  }
}

/** Household dissolution when the last member leaves. */
export function pruneHouseholds(ctx: TurnContext): void {
  // Dissolving a household does not move anyone, so one membership snapshot serves the whole loop.
  const membersByHousehold = livingMembersByHousehold(ctx.state);
  for (const household of ctx.state.households.values()) {
    if (household.dissolvedDay !== null) continue;
    if (!membersByHousehold.has(household.id)) household.dissolvedDay = ctx.day;
  }
}
