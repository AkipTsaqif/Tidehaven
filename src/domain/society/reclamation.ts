import type { TurnContext } from '../turn-context.js';
import { balanceOf, type Good } from '../state.js';
import type {
  DevelopmentMaterialLot,
  DevelopmentMaterials,
  DevelopmentProject,
  DevelopmentResult,
  DevelopmentRules,
  DevelopmentState,
} from '../development-types.js';
import { resolveReclamationRules } from '../reclamation-rules.js';
import { chooseReclamationSite } from '../geography/reclamation-site.js';
import type { LayoutBuilding } from '../geography/layout.js';

/**
 * Land reclamation: a civic project that turns a square of open sea beside the coast into land.
 *
 * It is a normal development project (same funding, escrow, labour, cancellation and refund code),
 * so the money and goods are real and conserved. What differs is the product: when the project
 * completes, a patch is appended to `state.reclaimed` instead of a building appearing.
 *
 * The engine chooses the site. A model can only propose "reclaim_land"; it never supplies coordinates.
 */

/** Helpers from development.ts, passed in so this module does not import it (no import cycle). */
export interface ReclamationHooks {
  authorized(ctx: TurnContext, actorId: number, rules: DevelopmentRules): boolean;
  allocateProjectId(development: DevelopmentState): number | null;
  escrowId(projectId: number): number;
  escrowOccupied(ctx: TurnContext, escrowId: number): boolean;
  normaliseMaterials(materials: DevelopmentMaterials): Record<Good, number>;
  /**
   * Reserve treasury money and goods in the project's escrow. All-or-nothing: no change on failure.
   * The money sits in escrow (so a cancellation refunds all of it) until the works complete.
   */
  fund(
    ctx: TurnContext,
    materials: Record<Good, number>,
    escrowedCents: number,
    escrowId: number,
  ): { ok: true; lots: DevelopmentMaterialLot[] } | { ok: false; reason: string };
  makeProject(params: MakeProjectParams): DevelopmentProject;
  daysToLabour(days: number): number;
  finishMaterials(ctx: TurnContext, project: DevelopmentProject): void;
}

export interface MakeProjectParams {
  id: number;
  kind: 'reclamation';
  sponsorId: number;
  ownerType: 'town';
  ownerId: number;
  authorizedBy: number | null;
  businessKind: null;
  targetBuildingId: number;
  targetBusinessId: null;
  targetHouseholdId: null;
  targetOwnerType: 'town';
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
}

/** Live buildings in id order; a fishery (or a site that will become one) is a shore building. */
export function placementInput(ctx: TurnContext): { buildings: LayoutBuilding[]; camps: number[] } {
  const planned = new Map<number, string>();
  for (const project of [...ctx.state.development.projects.values()].sort((a, b) => a.id - b.id)) {
    if (project.kind === 'workplace' && project.businessKind && !planned.has(project.targetBuildingId)) {
      planned.set(project.targetBuildingId, project.businessKind);
    }
  }
  // Ruins and abandoned sites keep their lot, exactly as the map places them.
  const buildings: LayoutBuilding[] = [...ctx.state.buildings.values()]
    .sort((a, b) => a.id - b.id)
    .map((b) => ({ id: b.id, placement: (planned.get(b.id) ?? b.kind) === 'fishery' ? 'shore' as const : 'land' as const }));
  const camps = [...ctx.state.households.values()]
    .filter((h) => h.dissolvedDay === null && h.buildingId === null)
    .sort((a, b) => a.id - b.id)
    .map((h) => h.id);
  return { buildings, camps };
}

export function reservedSquares(development: DevelopmentState): { tx: number; ty: number; size: number }[] {
  return [...development.projects.values()]
    .filter((p) => p.kind === 'reclamation' && p.status === 'active'
      && p.reclaimTx !== undefined && p.reclaimTy !== undefined && p.reclaimSize !== undefined)
    .map((p) => ({ tx: p.reclaimTx!, ty: p.reclaimTy!, size: p.reclaimSize! }));
}

export function startReclamation(
  ctx: TurnContext,
  development: DevelopmentState,
  rules: DevelopmentRules,
  actorId: number,
  hooks: ReclamationHooks,
): DevelopmentResult {
  const reclaim = resolveReclamationRules(rules.reclamation);
  if (!reclaim.enabled) return { ok: false, reason: 'reclamation_disabled' };
  // Civic works only: a councillor or magistrate, paid from the treasury.
  if (!hooks.authorized(ctx, actorId, rules)) return { ok: false, reason: 'civic_authorization_required' };

  const own = [...development.projects.values()].filter((p) => p.kind === 'reclamation');
  const active = own.filter((p) => p.status === 'active');
  if (active.length >= reclaim.maxActive) return { ok: false, reason: 'reclamation_in_progress' };
  if (ctx.state.reclaimed.length + active.length >= reclaim.maxTotal) return { ok: false, reason: 'reclamation_limit_reached' };
  const lastClosed = own.reduce((day, p) => Math.max(day, p.completedDay ?? p.cancelledDay ?? -1), -1);
  if (lastClosed >= 0 && ctx.day - lastClosed < reclaim.cooldownDays) return { ok: false, reason: 'reclamation_cooldown' };

  const placement = placementInput(ctx);
  const site = chooseReclamationSite({
    seed: ctx.state.seed,
    terrain: ctx.state.terrain,
    patches: ctx.state.reclaimed,
    buildings: placement.buildings,
    campHouseholdIds: placement.camps,
    nextBuildingId: ctx.state.nextIds.building ?? 1,
    patchTiles: reclaim.patchTiles,
    scarcityDistanceTiles: reclaim.scarcityDistanceTiles,
    dockClearanceTiles: reclaim.dockClearanceTiles,
    reserved: reservedSquares(development),
  });
  if (!site.ok) return { ok: false, reason: `reclamation_${site.reason}` };

  const projectId = hooks.allocateProjectId(development);
  if (projectId === null) return { ok: false, reason: 'project_id_collision' };
  const escrowId = hooks.escrowId(projectId);
  if (hooks.escrowOccupied(ctx, escrowId)) return { ok: false, reason: 'escrow_id_collision' };

  const materials = hooks.normaliseMaterials(reclaim.materials);
  const funded = hooks.fund(ctx, materials, reclaim.constructionCostCents, escrowId);
  if (!funded.ok) return { ok: false, reason: funded.reason };

  const project = hooks.makeProject({
    id: projectId,
    kind: 'reclamation',
    sponsorId: actorId,
    ownerType: 'town',
    ownerId: 0,
    authorizedBy: actorId,
    businessKind: null,
    targetBuildingId: 0,
    targetBusinessId: null,
    targetHouseholdId: null,
    targetOwnerType: 'town',
    targetOwnerId: 0,
    targetCapacity: 0,
    capacityDelta: 0,
    requiredLabour: hooks.daysToLabour(reclaim.labourDays),
    requiredMaterials: materials,
    // The works fee is held in escrow as 'startup capital': refunded if cancelled, spent on completion.
    constructionCostCents: 0,
    startupCapitalCents: reclaim.constructionCostCents,
    startupEscrowId: escrowId,
    day: ctx.day,
    materialLots: funded.lots,
  });
  project.reclaimTx = site.tx;
  project.reclaimTy = site.ty;
  project.reclaimSize = reclaim.patchTiles;
  development.projects.set(projectId, project);
  development.nextId = projectId + 1;
  ctx.emit({
    kind: 'development_started',
    actorId,
    targetId: null,
    visibility: 'public',
    importance: 60,
    title: 'The council began reclaiming land from the sea',
    detail: {
      projectId, tx: site.tx, ty: site.ty, size: reclaim.patchTiles,
      worksFeeCents: reclaim.constructionCostCents, civicMandate: true,
    },
  });
  return { ok: true, projectId };
}

/** An active project stays valid only while its square has not been claimed by another patch. */
export function validateReclamation(ctx: TurnContext, project: DevelopmentProject): string | null {
  if (project.reclaimTx === undefined || project.reclaimTy === undefined || project.reclaimSize === undefined) {
    return 'reclamation_site_missing';
  }
  const x0 = project.reclaimTx;
  const y0 = project.reclaimTy;
  const size = project.reclaimSize;
  const claimed = ctx.state.reclaimed.some((p) => x0 < p.tx + p.size && x0 + size > p.tx && y0 < p.ty + p.size && y0 + size > p.ty);
  return claimed ? 'reclamation_site_taken' : null;
}

export function completeReclamation(ctx: TurnContext, project: DevelopmentProject, hooks: ReclamationHooks): DevelopmentResult {
  const invalid = validateReclamation(ctx, project);
  if (invalid !== null) return { ok: false, reason: invalid, projectId: project.id };
  const id = (ctx.state.reclaimed.at(-1)?.id ?? 0) + 1;
  ctx.state.reclaimed.push({
    id,
    projectId: project.id,
    tx: project.reclaimTx!,
    ty: project.reclaimTy!,
    size: project.reclaimSize!,
    // Only buildings created from now on may use the new land, so nothing already placed can move.
    fromBuildingId: ctx.state.nextIds.building ?? 1,
    completedDay: ctx.day,
  });
  hooks.finishMaterials(ctx, project);
  // The works fee buys stone, tools and skilled hands from the mainland: it leaves the town's economy
  // for the outside account, exactly like an import, so total money is conserved.
  const fee = balanceOf(ctx.state, 'escrow', project.startupEscrowId);
  if (fee > 0) {
    ctx.transfer({ from: { type: 'escrow', id: project.startupEscrowId }, to: { type: 'external', id: 0 }, cents: fee, reason: 'reclamation_works' });
  }
  project.status = 'completed';
  project.completedDay = ctx.day;
  ctx.emit({
    kind: 'development_completed',
    actorId: project.sponsorId,
    targetId: null,
    visibility: 'public',
    importance: 70,
    title: 'New land rose from the sea',
    detail: { projectId: project.id, patchId: id, tx: project.reclaimTx, ty: project.reclaimTy, size: project.reclaimSize },
  });
  return { ok: true, projectId: project.id };
}
