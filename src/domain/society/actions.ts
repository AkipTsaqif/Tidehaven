import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { foundBusiness } from '../economy/businesses.js';
import { emigrateResident } from './population.js';
import { recordWill } from './estates.js';
import { logRejected } from './relationships.js';

/**
 * Primary-action dispatch.
 *
 * The action schema lets a resident ask for things the daily phases do not otherwise handle —
 * founding a business, leaving town. Those asks must actually execute (or be explicitly refused with a
 * recorded reason), not sit in the plan as decoration. Every other primary kind is already consumed by
 * its own phase (work/rest by labour, civic by politics, shop by the market), so this phase only
 * resolves the ones that need an owner.
 */

export interface PrimaryReport {
  founded: number;
  departed: number;
  wills: number;
  rejected: number;
}

export function primaryActionPhase(ctx: TurnContext, plans: Map<number, ActorPlan>): PrimaryReport {
  const report: PrimaryReport = { founded: 0, departed: 0, wills: 0, rejected: 0 };
  const ordered = [...plans.values()].sort((a, b) => a.actorId - b.actorId);
  for (const actorPlan of ordered) {
    const primary = actorPlan.plan.primary;
    if (!primary) continue;
    const actor = ctx.state.residents.get(actorPlan.actorId);
    if (!actor || actor.status !== 'living') continue;

    switch (primary.kind) {
      case 'found_business': {
        const buildingId = primary.businessId ?? primary.targetId ?? null;
        if (buildingId === null) {
          logRejected(ctx, actorPlan, 'founding_needs_premises');
          report.rejected += 1;
          break;
        }
        const building = ctx.state.buildings.get(buildingId);
        if (!building) {
          logRejected(ctx, actorPlan, 'unknown_premises');
          report.rejected += 1;
          break;
        }
        // The kind may be named explicitly; otherwise the premises decide.
        const kind = normaliseKind(primary.detail) ?? building.kind;
        const result = foundBusiness({ ctx, founderId: actor.id, kind, buildingId });
        if (result.ok) {
          report.founded += 1;
        } else {
          logRejected(ctx, actorPlan, result.reason ?? 'founding_rejected');
          report.rejected += 1;
        }
        break;
      }
      case 'migrate': {
        const moved = emigrateResident(ctx, actor.id, primary.detail ?? 'chose to leave');
        if (moved) {
          report.departed += 1;
        } else {
          logRejected(ctx, actorPlan, 'migration_refused');
          report.rejected += 1;
        }
        break;
      }
      case 'write_will': {
        const heirId = primary.targetId ?? null;
        if (heirId === null) {
          logRejected(ctx, actorPlan, 'will_needs_heir');
          report.rejected += 1;
          break;
        }
        const bps = Math.max(1, Math.min(10_000, Math.trunc(Number(primary.detail ?? '5000')) || 5_000));
        const result = recordWill(ctx, actor.id, { [String(heirId)]: bps });
        if (!result.ok) {
          logRejected(ctx, actorPlan, result.reason ?? 'will_rejected');
          report.rejected += 1;
        } else {
          report.wills += 1;
        }
        break;
      }
      default:
        // Consumed by another phase; nothing to do here.
        break;
    }
  }
  return report;
}

function normaliseKind(detail: string | undefined): string | null {
  if (!detail) return null;
  const cleaned = detail.trim().toLowerCase().replace(/[^a-z_]/g, '_');
  return cleaned === '' ? null : cleaned;
}
