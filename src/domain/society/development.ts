import type { ActorPlan, PrimaryAction } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { officeHolderFor } from '../../domain/events/politics.js';
import { chargeBusinessLevy } from '../economy/ledger.js';
import { bumpBusinessRevenue, marketPrice } from '../economy/market.js';
import { personalLabour } from '../economy/employment.js';
import { logRejected } from './relationships.js';
import { liveBuildingCount, openBusinessCount } from '../growth-limits.js';
import {
  GOODS,
  availableOf,
  balanceOf,
  nextId,
  type Building,
  type Business,
  type Good,
} from '../state.js';
import type {
  DevelopmentExpansionCosts,
  DevelopmentMaterialLot,
  DevelopmentMaterials,
  DevelopmentProject,
  DevelopmentProjectKind,
  DevelopmentReport,
  DevelopmentResult,
  DevelopmentRules,
  DevelopmentState,
  DevelopmentTemplate,
} from '../development-types.js';

/** Escrow ids are disjoint from minor trusts (1m) and disasters (2m). */
export const DEVELOPMENT_ESCROW_BASE = 3_000_000;
export const DEVELOPMENT_BUILD_SHARE_BPS = 7_000;

export function developmentEscrowId(projectId: number): number {
  if (!Number.isSafeInteger(projectId) || projectId < 1 || projectId > Number.MAX_SAFE_INTEGER - DEVELOPMENT_ESCROW_BASE) {
    throw new Error(`Invalid development project id ${projectId}`);
  }
  return DEVELOPMENT_ESCROW_BASE + projectId;
}

export interface StartDevelopmentRequest {
  actorId: number;
  kind: DevelopmentProjectKind;
  businessKind?: string;
  targetId?: number;
  capacityDelta?: number;
}

/**
 * Resolve the three growth primary actions. Starts are deliberately separate from work: a model must
 * first secure a project and then choose work_construction on a later primary action.
 */
export function developmentPhase(
  ctx: TurnContext,
  plans: Map<number, ActorPlan>,
  development: DevelopmentState,
  rules?: DevelopmentRules,
): DevelopmentReport {
  ctx.setPhase('development');
  const report: DevelopmentReport = { started: 0, progressed: 0, completed: 0, cancelled: 0, rejected: 0, rejections: [] };
  const ordered = [...plans.values()].sort((a, b) => a.actorId - b.actorId);
  retireClosedProjects(ctx, development);

  if (!rules) {
    for (const actorPlan of ordered) {
      const action = actorPlan.plan.primary;
      if (!isDevelopmentAction(action)) continue;
      rejectPlan(ctx, actorPlan, 'development_not_available', report);
    }
    return report;
  }

  // Revalidate old work before accepting new proposals. A changed owner, destroyed target, or lost
  // civic mandate cannot leave resources trapped in an unworkable project.
  for (const project of activeProjects(development)) {
    const reason = validateProject(ctx, project, rules);
    if (reason !== null) {
      cancelDevelopment(ctx, development, project.id, reason);
      report.cancelled += 1;
    }
  }

  for (const actorPlan of ordered) {
    const action = actorPlan.plan.primary;
    if (!action || (action.kind !== 'build_workplace' && action.kind !== 'expand_building')) continue;
    const request: StartDevelopmentRequest = action.kind === 'build_workplace'
      ? { actorId: actorPlan.actorId, kind: 'workplace', businessKind: action.businessKind ?? undefined }
      : {
          actorId: actorPlan.actorId,
          kind: 'expansion',
          targetId: action.targetId ?? undefined,
          capacityDelta: action.capacityDelta ?? undefined,
        };
    const result = startDevelopment(ctx, development, rules, request);
    if (result.ok) report.started += 1;
    else rejectPlan(ctx, actorPlan, result.reason ?? 'development_rejected', report, result.projectId);
  }

  const allocatedWorkers = new Set<number>();
  for (const actorPlan of ordered) {
    const action = actorPlan.plan.primary;
    if (!action || action.kind !== 'work_construction') continue;
    if (allocatedWorkers.has(actorPlan.actorId)) {
      rejectPlan(ctx, actorPlan, 'worker_already_allocated', report);
      continue;
    }
    allocatedWorkers.add(actorPlan.actorId);
    const projectId = action.targetId;
    if (projectId === undefined || projectId === null) {
      rejectPlan(ctx, actorPlan, 'construction_project_required', report);
      continue;
    }
    const result = workOnDevelopment(ctx, development, rules, projectId, actorPlan.actorId);
    if (result.ok) report.progressed += 1;
    else rejectPlan(ctx, actorPlan, result.reason ?? 'construction_rejected', report, projectId);
  }

  for (const project of activeProjects(development)) {
    const reason = validateProject(ctx, project, rules);
    if (reason !== null) {
      cancelDevelopment(ctx, development, project.id, reason);
      report.cancelled += 1;
      continue;
    }
    if (project.appliedLabour < project.requiredLabour || !materialsComplete(project)) continue;
    const result = completeDevelopment(ctx, development, rules, project.id);
    if (result.ok) report.completed += 1;
    else {
      cancelDevelopment(ctx, development, project.id, result.reason ?? 'completion_invalidated');
      report.cancelled += 1;
    }
  }
  return report;
}

/** Start a fully funded workplace or capacity expansion. No state is changed on a rejected preflight. */
export function startDevelopment(
  ctx: TurnContext,
  development: DevelopmentState,
  rules: DevelopmentRules,
  request: StartDevelopmentRequest,
): DevelopmentResult {
  const actor = ctx.state.residents.get(request.actorId);
  if (!actor || actor.status !== 'living') return { ok: false, reason: 'actor_unavailable' };
  if (development.projects.size >= rules.maxTotalProjects) return { ok: false, reason: 'project_cap_reached' };
  if (activeProjects(development).length >= rules.maxActiveProjects) return { ok: false, reason: 'active_project_cap_reached' };

  if (request.kind === 'workplace') return startWorkplace(ctx, development, rules, request);
  return startExpansion(ctx, development, rules, request);
}

/** Apply one sponsor-authorized construction work day. */
export function workOnDevelopment(
  ctx: TurnContext,
  development: DevelopmentState,
  rules: DevelopmentRules,
  projectId: number,
  workerId: number,
): DevelopmentResult {
  const project = development.projects.get(projectId);
  if (!project || project.status !== 'active') return { ok: false, reason: 'construction_project_unavailable', projectId };
  const reason = validateProject(ctx, project, rules);
  if (reason !== null) {
    cancelDevelopment(ctx, development, project.id, reason);
    return { ok: false, reason, projectId };
  }
  if (workerId !== project.sponsorId) return { ok: false, reason: 'construction_permission_denied', projectId };
  const worker = ctx.state.residents.get(workerId);
  if (!worker || worker.status !== 'living') return { ok: false, reason: 'worker_unavailable', projectId };
  if (!materialsComplete(project)) return { ok: false, reason: 'materials_not_secured', projectId };
  const labour = Math.floor((personalLabour(ctx, worker) * DEVELOPMENT_BUILD_SHARE_BPS) / 10_000);
  if (labour <= 0) return { ok: false, reason: 'builder_unfit', projectId };
  const next = safeAdd(project.appliedLabour, labour);
  if (next === null) return { ok: false, reason: 'labour_overflow', projectId };
  project.appliedLabour = Math.min(project.requiredLabour, next);
  return { ok: true, projectId };
}

/** Cancel an active project and return startup capital plus escrowed materials. */
export function cancelDevelopment(
  ctx: TurnContext,
  development: DevelopmentState,
  projectId: number,
  reason: string,
): DevelopmentResult {
  const project = development.projects.get(projectId);
  if (!project || project.status !== 'active') return { ok: false, reason: 'construction_project_unavailable', projectId };

  // A sponsor who died or left has already had their estate settled: a refund to their account would
  // be stranded there forever. Their share goes to the public purse, like any other estate residue.
  const ownerGone = project.ownerType === 'resident' && !isLiving(ctx, project.ownerId);
  const refundTo = project.ownerType === 'town' || ownerGone
    ? { type: 'treasury' as const, id: 0 }
    : { type: 'resident' as const, id: project.ownerId };
  returnProjectMaterials(ctx, project, ownerGone);
  const heldCapital = balanceOf(ctx.state, 'escrow', project.startupEscrowId);
  if (heldCapital > 0) {
    ctx.transfer({
      from: { type: 'escrow', id: project.startupEscrowId },
      to: refundTo,
      cents: heldCapital,
      reason: ownerGone ? 'development_refund_residue' : 'development_startup_refund',
    });
  }

  if (project.kind === 'workplace') {
    const site = ctx.state.buildings.get(project.targetBuildingId);
    if (site && site.kind === 'development_site') {
      site.kind = 'development_abandoned';
      site.capacity = 0;
      site.privateFlag = true;
    }
  }
  project.status = project.ownerType === 'resident' && !isLiving(ctx, project.ownerId) ? 'abandoned' : 'cancelled';
  project.cancelledDay = ctx.day;
  project.cancellationReason = reason;
  ctx.emit({
    kind: 'development_cancelled',
    actorId: project.sponsorId,
    targetId: project.targetBuildingId,
    locationId: project.targetBuildingId,
    visibility: 'public',
    importance: 45,
    title: `Development project ${project.id} was cancelled`,
    detail: { projectId, reason, status: project.status },
  });
  return { ok: true, projectId };
}

/** Names retained as explicit test/integration entry points while the parent wires turn dispatch. */
export const startDevelopmentProject = startDevelopment;
export const continueDevelopmentProject = workOnDevelopment;
export const cancelDevelopmentProject = cancelDevelopment;

function startWorkplace(
  ctx: TurnContext,
  development: DevelopmentState,
  rules: DevelopmentRules,
  request: StartDevelopmentRequest,
): DevelopmentResult {
  const sponsor = ctx.state.residents.get(request.actorId);
  const kind = request.businessKind;
  if (!sponsor || sponsor.status !== 'living') return { ok: false, reason: 'sponsor_unavailable' };
  if (!kind) return { ok: false, reason: 'business_kind_required' };
  const template = rules.templates[kind];
  if (!template) return { ok: false, reason: 'unknown_business_kind' };
  const templateError = validateTemplate(template);
  if (templateError !== null) return { ok: false, reason: templateError };
  if (template.capacity > template.capacityCeiling) return { ok: false, reason: 'capacity_exceeds_template' };
  if (liveBuildingCount(ctx.state) >= rules.maxBuildings) return { ok: false, reason: 'building_cap_reached' };
  if (openBusinessCount(ctx.state) >= rules.maxBusinesses) return { ok: false, reason: 'business_cap_reached' };

  const projectId = allocateProjectId(development);
  if (projectId === null) return { ok: false, reason: 'project_id_collision' };
  const escrowId = developmentEscrowId(projectId);
  if (escrowOccupied(ctx, escrowId)) return { ok: false, reason: 'escrow_id_collision' };
  const materials = normaliseMaterials(template.materials);
  const funding = preflightFunding(ctx, 'resident', sponsor.id, materials, template.constructionCostCents, template.startupCapitalCents);
  if (!funding.ok) return { ok: false, reason: funding.reason };

  const buildingId = ctx.state.nextIds.building ?? 1;
  if (!Number.isSafeInteger(buildingId) || buildingId < 1 || ctx.state.buildings.has(buildingId)) {
    return { ok: false, reason: 'building_id_collision' };
  }
  applyFunding(
    ctx,
    funding.sources,
    'resident',
    sponsor.id,
    escrowId,
    template.constructionCostCents,
    template.startupCapitalCents,
  );
  const site: Building = {
    id: buildingId,
    name: `${sponsor.name}'s ${template.name ?? kind.replace(/_/g, ' ')} site`,
    kind: 'development_site',
    capacity: 0,
    conditionBps: 10_000,
    builtDay: ctx.day,
    destroyedDay: null,
    privateFlag: true,
  };
  ctx.state.buildings.set(buildingId, site);
  nextId(ctx.state, 'building');

  const project = makeProject({
    id: projectId,
    kind: 'workplace',
    sponsorId: sponsor.id,
    ownerType: 'resident',
    ownerId: sponsor.id,
    authorizedBy: null,
    businessKind: kind,
    targetBuildingId: buildingId,
    targetBusinessId: null,
    targetHouseholdId: null,
    targetOwnerType: 'resident',
    targetOwnerId: sponsor.id,
    targetCapacity: 0,
    capacityDelta: template.capacity,
    requiredLabour: daysToLabour(template.labourDays),
    requiredMaterials: materials,
    constructionCostCents: template.constructionCostCents,
    startupCapitalCents: template.startupCapitalCents,
    startupEscrowId: escrowId,
    day: ctx.day,
    materialLots: funding.lots,
  });
  development.projects.set(projectId, project);
  development.nextId = projectId + 1;
  ctx.emit({
    kind: 'development_started',
    actorId: sponsor.id,
    targetId: buildingId,
    locationId: buildingId,
    visibility: 'public',
    importance: 40,
    title: `${site.name} began construction`,
    detail: { projectId, businessKind: kind, labourDays: template.labourDays, materials, constructionCostCents: template.constructionCostCents },
  });
  return { ok: true, projectId };
}

function startExpansion(
  ctx: TurnContext,
  development: DevelopmentState,
  rules: DevelopmentRules,
  request: StartDevelopmentRequest,
): DevelopmentResult {
  const targetId = request.targetId;
  const capacityDelta = request.capacityDelta;
  if (targetId === undefined) return { ok: false, reason: 'target_building_required' };
  if (!Number.isSafeInteger(capacityDelta) || capacityDelta === undefined || capacityDelta <= 0) {
    return { ok: false, reason: 'capacity_delta_required' };
  }
  const building = ctx.state.buildings.get(targetId);
  if (!building || building.destroyedDay !== null || building.kind === 'development_site' || building.kind === 'development_abandoned') {
    return { ok: false, reason: 'target_building_unavailable' };
  }
  const target = targetForBuilding(ctx, building.id);
  if (!target) return { ok: false, reason: 'target_not_expandable' };
  const template = expansionTemplate(rules, building.kind, target.businessKind);
  if (!template) return { ok: false, reason: 'unknown_expansion_kind' };
  const expansion = template.expansion;
  const templateError = validateExpansion(expansion);
  if (templateError !== null) return { ok: false, reason: templateError };
  const newCapacity = safeAdd(building.capacity, capacityDelta);
  if (newCapacity === null || newCapacity > template.capacityCeiling) return { ok: false, reason: 'capacity_ceiling_reached' };
  if (!Number.isSafeInteger(building.capacity) || building.capacity < 0) return { ok: false, reason: 'invalid_target_capacity' };

  const authorization = authorizeTarget(ctx, target, request.actorId, rules);
  if (!authorization.ok) return { ok: false, reason: authorization.reason };
  const projectId = allocateProjectId(development);
  if (projectId === null) return { ok: false, reason: 'project_id_collision' };
  const escrowId = developmentEscrowId(projectId);
  if (escrowOccupied(ctx, escrowId)) return { ok: false, reason: 'escrow_id_collision' };
  if (activeProjects(development).some((p) => p.targetBuildingId === targetId)) return { ok: false, reason: 'duplicate_target_project' };

  const materials = multiplyMaterials(expansion.materialsPerCapacity, capacityDelta);
  if (!materials) return { ok: false, reason: 'material_overflow' };
  const constructionCost = safeProduct(expansion.constructionCostCentsPerCapacity, capacityDelta);
  const startupCapital = safeProduct(expansion.startupCapitalCentsPerCapacity, capacityDelta);
  const labourDays = safeProduct(expansion.labourDaysPerCapacity, capacityDelta);
  if (constructionCost === null || startupCapital === null || labourDays === null) return { ok: false, reason: 'cost_overflow' };

  const payerType = target.ownerType === 'town' ? 'treasury' : 'resident';
  const payerId = payerType === 'treasury' ? 0 : request.actorId;
  const funding = preflightFunding(ctx, payerType, payerId, materials, constructionCost, startupCapital);
  if (!funding.ok) return { ok: false, reason: funding.reason };
  applyFunding(
    ctx,
    funding.sources,
    payerType,
    payerId,
    escrowId,
    constructionCost,
    startupCapital,
  );

  const project = makeProject({
    id: projectId,
    kind: 'expansion',
    sponsorId: request.actorId,
    ownerType: target.ownerType,
    ownerId: target.ownerType === 'town' ? 0 : request.actorId,
    authorizedBy: authorization.authorizedBy,
    businessKind: target.businessKind,
    targetBuildingId: targetId,
    targetBusinessId: target.businessId,
    targetHouseholdId: target.householdId,
    targetOwnerType: target.ownerType,
    targetOwnerId: target.ownerId,
    targetCapacity: building.capacity,
    capacityDelta,
    requiredLabour: daysToLabour(labourDays),
    requiredMaterials: materials,
    constructionCostCents: constructionCost,
    startupCapitalCents: startupCapital,
    startupEscrowId: escrowId,
    day: ctx.day,
    materialLots: funding.lots,
  });
  development.projects.set(projectId, project);
  development.nextId = projectId + 1;
  ctx.emit({
    kind: 'development_started',
    actorId: request.actorId,
    targetId,
    locationId: targetId,
    visibility: 'public',
    importance: 40,
    title: `Expansion began at ${building.name}`,
    detail: {
      projectId,
      capacityDelta,
      targetCapacity: building.capacity,
      constructionCostCents: constructionCost,
      startupCapitalCents: startupCapital,
      civicMandate: authorization.authorizedBy !== null,
    },
  });
  return { ok: true, projectId };
}

function completeDevelopment(
  ctx: TurnContext,
  development: DevelopmentState,
  rules: DevelopmentRules,
  projectId: number,
): DevelopmentResult {
  const project = development.projects.get(projectId);
  if (!project || project.status !== 'active') return { ok: false, reason: 'construction_project_unavailable', projectId };
  if (!materialsComplete(project) || project.appliedLabour < project.requiredLabour) return { ok: false, reason: 'construction_incomplete', projectId };
  const building = ctx.state.buildings.get(project.targetBuildingId);
  if (!building) return { ok: false, reason: 'target_building_missing', projectId };

  if (project.kind === 'workplace') {
    if (openBusinessCount(ctx.state) >= rules.maxBusinesses) return { ok: false, reason: 'business_cap_reached', projectId };
    if (building.kind !== 'development_site' || building.capacity !== 0 || !building.privateFlag) {
      return { ok: false, reason: 'site_invalidated', projectId };
    }
    const kind = project.businessKind;
    const sponsor = ctx.state.residents.get(project.sponsorId);
    if (!kind || !sponsor || sponsor.status !== 'living') return { ok: false, reason: 'owner_invalidated', projectId };
    const businessId = ctx.state.nextIds.business ?? 1;
    if (!Number.isSafeInteger(businessId) || businessId < 1 || ctx.state.businesses.has(businessId)) {
      return { ok: false, reason: 'business_id_collision', projectId };
    }
    const business: Business = {
      id: businessId,
      name: `${sponsor.name}'s ${kind.replace(/_/g, ' ')}`,
      kind,
      ownerType: 'resident',
      ownerId: sponsor.id,
      managerId: sponsor.id,
      buildingId: building.id,
      cashCents: 0,
      openedDay: ctx.day,
      closedDay: null,
      status: 'open',
      settings: {},
    };
    ctx.state.businesses.set(businessId, business);
    nextId(ctx.state, 'business');
    building.kind = kind;
    building.capacity = project.capacityDelta;
    building.privateFlag = false;
    building.builtDay = ctx.day;
    finishMaterials(ctx, project);
    transferStartup(ctx, project, { type: 'business', id: businessId });
    project.targetBusinessId = businessId;
    project.status = 'completed';
    project.completedDay = ctx.day;
    ctx.emit({
      kind: 'development_completed',
      actorId: project.sponsorId,
      targetId: businessId,
      locationId: building.id,
      visibility: 'public',
      importance: 55,
      title: `${business.name} opened after construction`,
      detail: { projectId, buildingId: building.id, businessId, capacity: building.capacity, startupCapitalCents: project.startupCapitalCents },
    });
    return { ok: true, projectId };
  }

  if (building.capacity !== project.targetCapacity) return { ok: false, reason: 'target_capacity_changed', projectId };
  const current = targetForBuilding(ctx, building.id);
  if (!current || current.ownerType !== project.targetOwnerType || current.ownerId !== project.targetOwnerId) {
    return { ok: false, reason: 'target_owner_changed', projectId };
  }
  const nextCapacity = safeAdd(building.capacity, project.capacityDelta);
  if (nextCapacity === null) return { ok: false, reason: 'capacity_overflow', projectId };
  const household = project.targetHouseholdId === null ? null : ctx.state.households.get(project.targetHouseholdId);
  if (project.targetHouseholdId !== null && (!household || household.dissolvedDay !== null || household.buildingId !== building.id)) {
    return { ok: false, reason: 'household_invalidated', projectId };
  }
  building.capacity = nextCapacity;
  if (household) household.capacity = nextCapacity;
  finishMaterials(ctx, project);
  transferStartup(ctx, project, { type: 'treasury', id: 0 });
  project.status = 'completed';
  project.completedDay = ctx.day;
  ctx.emit({
    kind: 'development_completed',
    actorId: project.sponsorId,
    targetId: building.id,
    locationId: building.id,
    visibility: 'public',
    importance: 55,
    title: `${building.name} was expanded`,
    detail: { projectId, capacityDelta: project.capacityDelta, capacity: nextCapacity },
  });
  return { ok: true, projectId };
}

interface TargetInfo {
  businessId: number | null;
  householdId: number | null;
  ownerType: 'resident' | 'town';
  ownerId: number;
  businessKind: string | null;
}

function targetForBuilding(ctx: TurnContext, buildingId: number): TargetInfo | null {
  const business = [...ctx.state.businesses.values()]
    .filter((item) => item.buildingId === buildingId && item.status === 'open')
    .sort((a, b) => a.id - b.id)[0];
  if (business) {
    if (business.ownerType === 'resident' && business.ownerId === null) return null;
    const ownerId = business.ownerType === 'town' ? 0 : business.ownerId;
    if (ownerId === null) return null;
    return {
      businessId: business.id,
      householdId: null,
      ownerType: business.ownerType === 'town' ? 'town' : 'resident',
      ownerId,
      businessKind: business.kind,
    };
  }
  if (buildingId === 0) return null;
  const household = [...ctx.state.households.values()]
    .filter((item) => item.buildingId === buildingId && item.dissolvedDay === null)
    .sort((a, b) => a.id - b.id)[0];
  if (household) {
    return { businessId: null, householdId: household.id, ownerType: 'resident', ownerId: 0, businessKind: 'home' };
  }
  return null;
}

function authorizedOfficeHolder(ctx: TurnContext, actorId: number, rules: DevelopmentRules): boolean {
  const offices = rules.authorizedOffices ?? ['councillor', 'magistrate'];
  return offices.some((office) => officeHolderFor(ctx, office)?.id === actorId);
}

function authorizeTarget(
  ctx: TurnContext,
  target: TargetInfo,
  actorId: number,
  rules: DevelopmentRules,
): { ok: true; authorizedBy: number | null } | { ok: false; reason: string } {
  if (target.ownerType === 'town') {
    if (!authorizedOfficeHolder(ctx, actorId, rules)) {
      return { ok: false, reason: 'civic_authorization_required' };
    }
    return { ok: true, authorizedBy: actorId };
  }
  const actor = ctx.state.residents.get(actorId);
  if (!actor || actor.status !== 'living') return { ok: false, reason: 'actor_unavailable' };
  if (target.businessId !== null) {
    if (target.ownerId !== actorId) return { ok: false, reason: 'foreign_business_ownership' };
  } else {
    const household = target.householdId === null ? null : ctx.state.households.get(target.householdId);
    if (!household || household.buildingId === null || !householdMember(ctx, actorId, household.id)) {
      return { ok: false, reason: 'foreign_home_ownership' };
    }
  }
  return { ok: true, authorizedBy: null };
}

function validateProject(ctx: TurnContext, project: DevelopmentProject, rules: DevelopmentRules): string | null {
  if (project.status !== 'active') return null;
  if (!isLiving(ctx, project.sponsorId)) return 'owner_unavailable';
  if (project.ownerType === 'town') {
    if (project.authorizedBy === null || !authorizedOfficeHolder(ctx, project.authorizedBy, rules)) {
      return 'civic_authorization_expired';
    }
  } else if (project.ownerId !== project.sponsorId || !isLiving(ctx, project.ownerId)) {
    return 'owner_unavailable';
  }
  const building = ctx.state.buildings.get(project.targetBuildingId);
  if (!building || building.destroyedDay !== null) return 'target_invalidated';
  if (project.kind === 'workplace') {
    if (building.kind !== 'development_site' || building.capacity !== 0 || !building.privateFlag) return 'site_invalidated';
    if (openBusinessCount(ctx.state) >= rules.maxBusinesses) return 'business_cap_reached';
    return null;
  }
  if (building.capacity !== project.targetCapacity) return 'target_capacity_changed';
  const target = targetForBuilding(ctx, building.id);
  if (!target || target.ownerType !== project.targetOwnerType || target.ownerId !== project.targetOwnerId) return 'target_owner_changed';
  if (project.targetHouseholdId !== null) {
    const household = ctx.state.households.get(project.targetHouseholdId);
    if (!household || household.dissolvedDay !== null || household.buildingId !== building.id || !householdMember(ctx, project.sponsorId, household.id)) {
      return 'household_invalidated';
    }
  }
  return null;
}

function expansionTemplate(rules: DevelopmentRules, buildingKind: string, businessKind: string | null): DevelopmentTemplate | null {
  if (buildingKind === 'home') return rules.homeExpansion ?? null;
  return businessKind === null ? null : rules.templates[businessKind] ?? null;
}

function makeProject(params: {
  id: number;
  kind: DevelopmentProjectKind;
  sponsorId: number;
  ownerType: 'resident' | 'town';
  ownerId: number;
  authorizedBy: number | null;
  businessKind: string | null;
  targetBuildingId: number;
  targetBusinessId: number | null;
  targetHouseholdId: number | null;
  targetOwnerType: 'resident' | 'town';
  targetOwnerId: number;
  targetCapacity: number;
  capacityDelta: number;
  requiredLabour: number;
  requiredMaterials: Record<Good, number>;
  constructionCostCents: number;
  startupCapitalCents: number;
  startupEscrowId: number;
  day: number;
  materialLots: DevelopmentMaterialLot[];
}): DevelopmentProject {
  return {
    id: params.id,
    kind: params.kind,
    status: 'active',
    sponsorId: params.sponsorId,
    ownerType: params.ownerType,
    ownerId: params.ownerId,
    authorizedBy: params.authorizedBy,
    businessKind: params.businessKind,
    targetBuildingId: params.targetBuildingId,
    targetBusinessId: params.targetBusinessId,
    targetHouseholdId: params.targetHouseholdId,
    targetOwnerType: params.targetOwnerType,
    targetOwnerId: params.targetOwnerId,
    targetCapacity: params.targetCapacity,
    capacityDelta: params.capacityDelta,
    requiredLabour: params.requiredLabour,
    appliedLabour: 0,
    requiredMaterials: params.requiredMaterials,
    securedMaterials: { ...params.requiredMaterials },
    materialLots: params.materialLots,
    constructionCostCents: params.constructionCostCents,
    startupCapitalCents: params.startupCapitalCents,
    startupEscrowId: params.startupEscrowId,
    startedDay: params.day,
    completedDay: null,
    cancelledDay: null,
    cancellationReason: null,
  };
}

interface FundingSource {
  type: 'resident' | 'treasury' | 'business';
  id: number;
  good: Good;
  quantity: number;
  paidCents: number;
}

interface FundingPlan {
  ok: true;
  sources: FundingSource[];
  lots: DevelopmentMaterialLot[];
}

function preflightFunding(
  ctx: TurnContext,
  payerType: 'resident' | 'treasury',
  payerId: number,
  materials: Record<Good, number>,
  constructionCost: number,
  startupCapital: number,
): FundingPlan | { ok: false; reason: string } {
  let materialCost = 0;
  const sources: FundingSource[] = [];
  const lots: DevelopmentMaterialLot[] = [];
  for (const good of GOODS) {
    let remaining = materials[good] ?? 0;
    if (remaining <= 0) continue;
    const own = Math.min(remaining, availableOf(ctx.state, payerType, payerId, good));
    if (own > 0) {
      sources.push({ type: payerType, id: payerId, good, quantity: own, paidCents: 0 });
      lots.push({ good, quantity: own, sourceType: payerType, sourceId: payerId, paidCents: 0 });
      remaining -= own;
    }
    const sellers: { type: 'treasury' | 'business'; id: number }[] = [{ type: 'treasury', id: 0 }];
    for (const business of [...ctx.state.businesses.values()].sort((a, b) => a.id - b.id)) {
      if (business.status !== 'open') continue;
      const recipe = ctx.scenario.economy.recipes[business.kind];
      if (!recipe || (recipe.outputs[good] ?? 0) <= 0) continue;
      sellers.push({ type: 'business', id: business.id });
    }
    for (const seller of sellers) {
      if (remaining <= 0) break;
      if (seller.type === payerType && seller.id === payerId) continue;
      const stock = availableOf(ctx.state, seller.type, seller.id, good);
      if (stock <= 0) continue;
      const quantity = Math.min(remaining, stock);
      const price = marketPrice(ctx, good);
      const cost = safeProduct(quantity, price);
      if (cost === null) return { ok: false, reason: 'material_cost_overflow' };
      const nextCost = safeAdd(materialCost, cost);
      if (nextCost === null) return { ok: false, reason: 'material_cost_overflow' };
      materialCost = nextCost;
      sources.push({ type: seller.type, id: seller.id, good, quantity, paidCents: cost });
      // Bought goods belong to the payer: a cancellation refunds them to the sponsor, never back to
      // the seller, who keeps the sale proceeds.
      lots.push({ good, quantity, sourceType: payerType, sourceId: payerId, paidCents: cost });
      remaining -= quantity;
    }
    if (remaining > 0) {
      // A funded project that cannot find materials is real demand. The market folds this signal
      // into tomorrow's shortage counter, so producers can hire instead of the project stalling.
      const key = `constructionDemand:${good}`;
      ctx.state.counters.set(key, Math.max(ctx.state.counters.get(key) ?? 0, Math.min(remaining, 10_000)));
      return { ok: false, reason: `insufficient_${good}` };
    }
  }
  const committed = safeAdd(constructionCost, startupCapital);
  const total = committed === null ? null : safeAdd(committed, materialCost);
  if (total === null) return { ok: false, reason: 'funding_overflow' };
  if (balanceOf(ctx.state, payerType, payerId) < total) return { ok: false, reason: 'insufficient_capital' };
  return { ok: true, sources, lots };
}

function applyFunding(
  ctx: TurnContext,
  sources: FundingSource[],
  payerType: 'resident' | 'treasury',
  payerId: number,
  escrowId: number,
  constructionCostCents: number,
  startupCapitalCents: number,
): void {
  let materialCost = 0;
  for (const source of sources) {
    if (source.paidCents > 0) {
      ctx.transfer({
        from: { type: payerType, id: payerId },
        to: { type: source.type, id: source.id },
        cents: source.paidCents,
        reason: 'development_material_purchase',
      });
      materialCost = safeAdd(materialCost, source.paidCents) ?? materialCost;
      if (source.type === 'business') {
        chargeBusinessLevy({ ctx, businessId: source.id, proceedsCents: source.paidCents });
        bumpBusinessRevenue(ctx, source.id, source.paidCents);
      }
    }
    ctx.shiftGoods({ owner: { type: source.type, id: source.id }, good: source.good, delta: -source.quantity, reason: 'development_material_secured' });
    ctx.shiftGoods({ owner: { type: 'escrow', id: escrowId }, good: source.good, delta: source.quantity, reason: 'development_material_secured' });
  }
  const projectCost = safeAdd(safeAdd(materialCost, constructionCostCents) ?? -1, startupCapitalCents);
  if (projectCost === null || projectCost < 0) throw new Error('development funding overflow');
  if (constructionCostCents > 0) {
    ctx.transfer({
      from: { type: payerType, id: payerId },
      to: { type: 'treasury', id: 0 },
      cents: constructionCostCents,
      reason: 'development_construction_cost',
    });
  }
  if (startupCapitalCents > 0) {
    ctx.transfer({
      from: { type: payerType, id: payerId },
      to: { type: 'escrow', id: escrowId },
      cents: startupCapitalCents,
      reason: 'development_startup_escrow',
    });
  }
}

function transferStartup(ctx: TurnContext, project: DevelopmentProject, target: { type: 'business' | 'treasury'; id: number }): void {
  const held = balanceOf(ctx.state, 'escrow', project.startupEscrowId);
  if (held <= 0) return;
  ctx.transfer({ from: { type: 'escrow', id: project.startupEscrowId }, to: target, cents: held, reason: 'development_startup_capital' });
}

function finishMaterials(ctx: TurnContext, project: DevelopmentProject): void {
  for (const lot of project.materialLots) {
    if (lot.quantity <= 0) continue;
    ctx.shiftGoods({ owner: { type: 'escrow', id: project.startupEscrowId }, good: lot.good, delta: -lot.quantity, reason: 'development_material_consumed' });
  }
}

function returnProjectMaterials(ctx: TurnContext, project: DevelopmentProject, toTreasury: boolean): void {
  for (const lot of project.materialLots) {
    if (lot.quantity <= 0) continue;
    const owner = toTreasury ? { type: 'treasury' as const, id: 0 } : { type: lot.sourceType, id: lot.sourceId };
    ctx.shiftGoods({ owner: { type: 'escrow', id: project.startupEscrowId }, good: lot.good, delta: -lot.quantity, reason: 'development_material_refund' });
    ctx.shiftGoods({ owner, good: lot.good, delta: lot.quantity, reason: 'development_material_refund' });
  }
}

function rejectPlan(
  ctx: TurnContext,
  actorPlan: ActorPlan,
  reason: string,
  report: DevelopmentReport,
  projectId?: number,
): void {
  logRejected(ctx, actorPlan, reason);
  report.rejected += 1;
  report.rejections.push({ actorId: actorPlan.actorId, reason, ...(projectId === undefined ? {} : { projectId }) });
  ctx.emit({
    kind: 'development_rejected',
    actorId: actorPlan.actorId,
    targetId: projectId ?? null,
    visibility: 'private',
    importance: 10,
    title: 'A development proposal was rejected',
    detail: { reason, projectId: projectId ?? null },
  });
}

/** Closed projects stay in live state this long, then move to the archive table only. */
export const CLOSED_PROJECT_RETENTION_DAYS = 365;

/**
 * Finished, cancelled and abandoned projects hold no money, goods or capacity, so after the retention
 * window they leave the live state. Their row stays in the database (see development-repo) and their
 * events stay in history. This keeps `maxProjects` a bound on live work, not a lifetime dead end.
 */
function retireClosedProjects(ctx: TurnContext, development: DevelopmentState): void {
  for (const project of [...development.projects.values()].sort((a, b) => a.id - b.id)) {
    if (project.status === 'active') continue;
    const closedDay = project.completedDay ?? project.cancelledDay ?? project.startedDay;
    if (ctx.day - closedDay >= CLOSED_PROJECT_RETENTION_DAYS) development.projects.delete(project.id);
  }
}

function activeProjects(development: DevelopmentState): DevelopmentProject[] {
  return [...development.projects.values()].filter((project) => project.status === 'active').sort((a, b) => a.id - b.id);
}

function allocateProjectId(development: DevelopmentState): number | null {
  const id = development.nextId;
  if (!Number.isSafeInteger(id) || id < 1 || development.projects.has(id)) return null;
  return id;
}

function escrowOccupied(ctx: TurnContext, escrowId: number): boolean {
  if (ctx.state.accounts.has(`escrow:${escrowId}`)) return true;
  for (const good of GOODS) {
    if (ctx.state.inventories.has(`escrow:${escrowId}:${good}`)) return true;
    if (ctx.state.reserved.has(`escrow:${escrowId}:${good}`)) return true;
  }
  return false;
}

function isDevelopmentAction(action: PrimaryAction | null): boolean {
  return action !== null && (action.kind === 'build_workplace' || action.kind === 'expand_building' || action.kind === 'work_construction');
}

function isLiving(ctx: TurnContext, residentId: number): boolean {
  return ctx.state.residents.get(residentId)?.status === 'living';
}

function householdMember(ctx: TurnContext, residentId: number, householdId: number): boolean {
  return ctx.state.residents.get(residentId)?.householdId === householdId && isLiving(ctx, residentId);
}

function daysToLabour(days: number): number {
  const labour = safeProduct(days, 100);
  if (labour === null) throw new Error('development labour exceeds safe integer range');
  return labour;
}

function normaliseMaterials(materials: DevelopmentMaterials): Record<Good, number> {
  const result = {} as Record<Good, number>;
  for (const good of GOODS) result[good] = materials[good] ?? 0;
  return result;
}

function multiplyMaterials(materials: DevelopmentMaterials, multiplier: number): Record<Good, number> | null {
  const result = {} as Record<Good, number>;
  for (const good of GOODS) {
    const value = materials[good] ?? 0;
    const product = safeProduct(value, multiplier);
    if (product === null) return null;
    result[good] = product;
  }
  return result;
}

function validateTemplate(template: DevelopmentTemplate): string | null {
  if (!Number.isSafeInteger(template.capacity) || template.capacity <= 0) return 'invalid_template_capacity';
  if (!Number.isSafeInteger(template.capacityCeiling) || template.capacityCeiling < template.capacity) return 'invalid_template_capacity_ceiling';
  if (!Number.isSafeInteger(template.labourDays) || template.labourDays <= 0) return 'invalid_template_labour';
  if (!Number.isSafeInteger(template.constructionCostCents) || template.constructionCostCents < 0) return 'invalid_template_cost';
  if (!Number.isSafeInteger(template.startupCapitalCents) || template.startupCapitalCents < 0) return 'invalid_template_startup';
  return validateExpansion(template.expansion);
}

function validateExpansion(expansion: DevelopmentExpansionCosts): string | null {
  if (!Number.isSafeInteger(expansion.labourDaysPerCapacity) || expansion.labourDaysPerCapacity <= 0) return 'invalid_expansion_labour';
  if (!Number.isSafeInteger(expansion.constructionCostCentsPerCapacity) || expansion.constructionCostCentsPerCapacity < 0) return 'invalid_expansion_cost';
  if (!Number.isSafeInteger(expansion.startupCapitalCentsPerCapacity) || expansion.startupCapitalCentsPerCapacity < 0) return 'invalid_expansion_startup';
  for (const good of GOODS) {
    const value = expansion.materialsPerCapacity[good] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) return 'invalid_expansion_materials';
  }
  return null;
}

function materialsComplete(project: DevelopmentProject): boolean {
  for (const good of GOODS) {
    if ((project.securedMaterials[good] ?? 0) < (project.requiredMaterials[good] ?? 0)) return false;
  }
  return true;
}

function safeAdd(a: number, b: number): number | null {
  const value = a + b;
  return Number.isSafeInteger(value) ? value : null;
}

function safeProduct(a: number, b: number): number | null {
  const value = a * b;
  return Number.isSafeInteger(value) ? value : null;
}
