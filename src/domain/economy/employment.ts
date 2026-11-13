import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { labourCapacity, lifeStage } from '../clock.js';
import type { Business, Contract, Resident, WorldState } from '../state.js';
import { balanceOf, nextId } from '../state.js';
import { activeEmploymentByResident } from '../lookups.js';

/**
 * Employment: who works where, for how long, and what happens when a business cannot pay.
 * Hiring is a contract between a resident and a business; work is opt-out (resting reduces labour).
 */

export interface WorkerAssignment {
  resident: Resident;
  business: Business;
  contract: Contract;
  labourPoints: number;
  wageCents: number;
  wageClass: 'unskilled' | 'skilled' | 'official';
}

export function isImprisoned(ctx: TurnContext, residentId: number): boolean {
  for (const sentence of ctx.state.sentences.values()) {
    if (sentence.kind !== 'imprisonment' || sentence.status !== 'active') continue;
    const caseRecord = ctx.state.cases.get(sentence.caseId);
    if (!caseRecord) continue;
    if (caseRecord.defendantId !== residentId) continue;
    if (sentence.endDay !== null && ctx.day <= sentence.endDay) return true;
  }
  return false;
}

/** A resident's labour for the day before any choice of primary action (age, health, prison). */
export function personalLabour(ctx: TurnContext, resident: Resident): number {
  if (resident.status !== 'living') return 0;
  if (isImprisoned(ctx, resident.id)) return 0;
  const stage = lifeStage(resident.bornDay, ctx.day, ctx.scenario.calendar);
  let capacity = labourCapacity(stage);
  if (capacity === 0) return 0;
  const health = resident.healthState;
  if (health === 'injured') capacity = Math.floor((capacity * 40) / 100);
  if (health === 'disabled' || health === 'recovering') capacity = Math.floor((capacity * 60) / 100);
  if (health === 'infectious') capacity = Math.floor((capacity * 50) / 100);
  return capacity;
}

export function effectiveLabour(
  ctx: TurnContext,
  resident: Resident,
  plan: ActorPlan | undefined,
): number {
  let capacity = personalLabour(ctx, resident);
  if (capacity === 0) return 0;
  const primary = plan?.plan.primary;
  if (primary && primary.kind !== 'work') {
    // Non-work primaries still leave a partial working day unless the resident explicitly rests.
    capacity = primary.kind === 'rest' ? 0 : Math.floor((capacity * 30) / 100);
  }
  return capacity;
}

export function activeEmploymentContract(
  state: WorldState,
  day: number,
  residentId: number,
  businessId?: number,
): Contract | null {
  for (const contract of state.contracts.values()) {
    if (contract.kind !== 'employment') continue;
    if (contract.status !== 'active') continue;
    if (contract.aId !== residentId) continue;
    if (businessId !== undefined && contract.businessId !== businessId) continue;
    if (contract.endDay !== null && contract.endDay < day) continue;
    return contract;
  }
  return null;
}

/** Unionised strike: businesses lose half their labour while a strike is active. */
export function strikeActive(ctx: TurnContext, businessId: number): boolean {
  for (const item of ctx.state.unrest.values()) {
    if (item.kind !== 'strike' || item.status !== 'active') continue;
    const targetBusiness = item.demands.businessId;
    if (typeof targetBusiness === 'number' && targetBusiness === businessId) return true;
  }
  return false;
}

export function collectWorkers(ctx: TurnContext, plans: Map<number, ActorPlan>): Map<number, WorkerAssignment[]> {
  const byBusiness = new Map<number, WorkerAssignment[]>();
  // This loop reads contracts but never changes them, so one snapshot answers every resident.
  const employment = activeEmploymentByResident(ctx.state, ctx.day);
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    const contract = employment.get(resident.id) ?? null;
    if (!contract || contract.businessId === null) continue;
    const business = ctx.state.businesses.get(contract.businessId);
    if (!business || business.status !== 'open') continue;
    const labourPoints = effectiveLabour(ctx, resident, plans.get(resident.id));
    if (labourPoints <= 0) continue;
    const wageClass = (contract.terms.wageClass as WorkerAssignment['wageClass']) ?? 'unskilled';
    const wageCents =
      typeof contract.terms.wageCents === 'number'
        ? contract.terms.wageCents
        : ctx.scenario.economy.wages[wageClass];
    const list = byBusiness.get(business.id) ?? [];
    list.push({ resident, business, contract, labourPoints, wageCents, wageClass });
    byBusiness.set(business.id, list);
  }
  return byBusiness;
}

export interface HireResult {
  ok: boolean;
  reason?: string;
  contractId?: number;
}

/** Deterministic hire used for model/operator requests: capacity, wage, and cash are checked. */
export function hireWorker(params: {
  ctx: TurnContext;
  businessId: number;
  residentId: number;
  wageCents?: number;
  eventId?: number | null;
}): HireResult {
  const { ctx, businessId, residentId } = params;
  const business = ctx.state.businesses.get(businessId);
  if (!business || business.status !== 'open') return { ok: false, reason: 'business_not_open' };
  const resident = ctx.state.residents.get(residentId);
  if (!resident || resident.status !== 'living') return { ok: false, reason: 'resident_unavailable' };
  if (activeEmploymentContract(ctx.state, ctx.day, residentId)) return { ok: false, reason: 'already_employed' };
  const stage = lifeStage(resident.bornDay, ctx.day, ctx.scenario.calendar);
  if (stage === 'child') return { ok: false, reason: 'child_labour_forbidden' };
  if (isImprisoned(ctx, residentId)) return { ok: false, reason: 'resident_unavailable' };
  const building = business.buildingId === null ? undefined : ctx.state.buildings.get(business.buildingId);
  if (!building || building.privateFlag || building.destroyedDay !== null || building.conditionBps < 3_000) {
    return { ok: false, reason: 'premises_unavailable' };
  }
  const staff = [...ctx.state.contracts.values()].filter((contract) =>
    contract.kind === 'employment' && contract.status === 'active' && contract.businessId === businessId &&
    (contract.endDay === null || contract.endDay >= ctx.day) &&
    ctx.state.residents.get(contract.aId)?.status === 'living',
  ).length;
  if (staff >= building.capacity) return { ok: false, reason: 'premises_full' };
  const recipe = ctx.scenario.economy.recipes[business.kind];
  if (!recipe) return { ok: false, reason: 'unknown_business_kind' };
  const wageClass = recipe.wageClass;
  const wageCents = params.wageCents ?? ctx.scenario.economy.wages[wageClass];
  if (!Number.isSafeInteger(wageCents) || wageCents < 0 || !Number.isSafeInteger(wageCents * 5)) {
    return { ok: false, reason: 'invalid_wage' };
  }
  const payer = business.ownerType === 'town' ? 'treasury' : 'business';
  if (balanceOf(ctx.state, payer, payer === 'treasury' ? 0 : business.id) < wageCents * 5) {
    return { ok: false, reason: 'insufficient_payroll_reserve' };
  }
  const id = nextId(ctx.state, 'contract');
  ctx.state.contracts.set(id, {
    id,
    kind: 'employment',
    aId: residentId,
    bId: businessId,
    businessId,
    terms: { wageClass, wageCents },
    startDay: ctx.day,
    endDay: null,
    status: 'active',
  });
  ctx.emit({
    kind: 'employment_started',
    actorId: residentId,
    targetId: businessId,
    visibility: 'public',
    importance: 20,
    title: `${resident.name} hired at ${business.name}`,
    detail: { wageCents, wageClass },
  });
  return { ok: true, contractId: id };
}

export function endEmployment(params: {
  ctx: TurnContext;
  contractId: number;
  reason: string;
  eventId?: number | null;
}): void {
  const contract = params.ctx.state.contracts.get(params.contractId);
  if (!contract || contract.status !== 'active') return;
  contract.status = 'ended';
  contract.endDay = params.ctx.day;
}
