import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { activeEmploymentContract, endEmployment, hireWorker } from './employment.js';
import { logRejected } from '../society/relationships.js';

/**
 * Residents choose their own work.
 *
 * - `seek_work` with `businessId` applies to that business. The same checks as any hire apply (open
 *   business, usable premises, a free place, eligible adult, funded payroll). An employed applicant
 *   who is accepted leaves their old job first, so switching is one decision; when the application is
 *   refused they keep the job they had.
 * - `quit_job` leaves the current job.
 * - `seek_work` without a business, or a refused application, leaves the resident to the automatic
 *   hiring that follows in the production phase, so a model that never applies cannot starve a town.
 *
 * Applications resolve in resident-id order, so two applicants for the last place get a deterministic
 * outcome regardless of the order the model replies arrived in.
 */

export interface JobMarketReport {
  applied: number;
  hired: number;
  switched: number;
  quit: number;
  rejected: number;
}

export function jobMarketPhase(ctx: TurnContext, plans: Map<number, ActorPlan>): JobMarketReport {
  const report: JobMarketReport = { applied: 0, hired: 0, switched: 0, quit: 0, rejected: 0 };
  // Yesterday's quit markers have done their job; keep the counter map bounded.
  for (const [key, day] of [...ctx.state.counters.entries()]) {
    if (key.startsWith('quitDay:') && day < ctx.day) ctx.state.counters.delete(key);
  }
  for (const actorPlan of [...plans.values()].sort((a, b) => a.actorId - b.actorId)) {
    const primary = actorPlan.plan.primary;
    if (!primary) continue;
    const actor = ctx.state.residents.get(actorPlan.actorId);
    if (!actor || actor.status !== 'living') continue;

    if (primary.kind === 'quit_job') {
      const contract = activeEmploymentContract(ctx.state, ctx.day, actor.id);
      if (!contract) {
        logRejected(ctx, actorPlan, 'not_employed');
        report.rejected += 1;
        continue;
      }
      endEmployment({ ctx, contractId: contract.id, reason: 'quit' });
      // Leaving is effective today; they cannot be rehired at the same place in today's automatic round.
      ctx.state.counters.set(`quitDay:${actor.id}`, ctx.day);
      emitLeft(ctx, actor.id, contract.businessId, 'quit');
      report.quit += 1;
      continue;
    }

    if (primary.kind !== 'seek_work') continue;
    const businessId = primary.businessId ?? primary.targetId ?? null;
    // No preference: automatic hiring will place them where work is needed.
    if (businessId === null) continue;
    report.applied += 1;

    const current = activeEmploymentContract(ctx.state, ctx.day, actor.id);
    if (current?.businessId === businessId) {
      logRejected(ctx, actorPlan, 'already_works_there');
      report.rejected += 1;
      continue;
    }
    // Switching: leave the old job only if the new one would accept. Ending it first lets hireWorker
    // run its full checks; restoring it on refusal keeps the resident employed.
    if (current) {
      current.status = 'ended';
      current.endDay = ctx.day;
    }
    const result = hireWorker({ ctx, businessId, residentId: actor.id });
    if (!result.ok) {
      if (current) {
        current.status = 'active';
        current.endDay = null;
      }
      logRejected(ctx, actorPlan, `application_${result.reason ?? 'refused'}`);
      report.rejected += 1;
      continue;
    }
    if (current) {
      emitLeft(ctx, actor.id, current.businessId, 'switched');
      report.switched += 1;
    }
    report.hired += 1;
  }
  return report;
}

/** True when the resident quit today and should not be placed back by automatic hiring today. */
export function quitToday(ctx: TurnContext, residentId: number): boolean {
  return ctx.state.counters.get(`quitDay:${residentId}`) === ctx.day;
}

function emitLeft(ctx: TurnContext, residentId: number, businessId: number | null, how: 'quit' | 'switched'): void {
  const resident = ctx.state.residents.get(residentId);
  const business = businessId === null ? undefined : ctx.state.businesses.get(businessId);
  ctx.emit({
    kind: how === 'quit' ? 'employment_quit' : 'employment_switched',
    actorId: residentId,
    targetId: businessId,
    visibility: 'public',
    importance: 20,
    title: `${resident?.name ?? 'A worker'} ${how === 'quit' ? 'quit' : 'left'} ${business?.name ?? 'their job'}`,
    detail: { businessId, reason: how },
  });
}
