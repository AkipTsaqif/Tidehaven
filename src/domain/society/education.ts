import type { TurnContext } from '../turn-context.js';
import { lifeStage } from '../clock.js';

/**
 * Children's education. No paid child-agent calls and no child labour: children accrue school days
 * from the capacity of available teachers, and that education converts into skills at adulthood.
 */
export function educationPhase(ctx: TurnContext): void {
  const children = [...ctx.state.residents.values()].filter(
    (r) => r.status === 'living' && lifeStage(r.bornDay, ctx.day, ctx.scenario.calendar) === 'child',
  );
  if (children.length === 0) return;

  const teachers = [...ctx.state.residents.values()].filter(
    (r) =>
      r.status === 'living' &&
      r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays &&
      (r.traits.diligence ?? 0) >= 45 &&
      r.healthState !== 'injured',
  );
  const capacity = Math.min(ctx.scenario.economy.schoolCapacity, teachers.length * 4);
  if (capacity <= 0) {
    ctx.state.counters.set('schoolDaysMissed', (ctx.state.counters.get('schoolDaysMissed') ?? 0) + children.length);
    return;
  }

  // Deterministic allocation of limited school places, rotating so no child is starved.
  const rotation = ctx.state.counters.get('schoolRotation') ?? 0;
  const ordered = children.slice().sort((a, b) => a.id - b.id);
  const rotated = ordered.slice(rotation % Math.max(1, ordered.length)).concat(ordered.slice(0, rotation % Math.max(1, ordered.length)));
  const attending = rotated.slice(0, capacity);
  for (const child of attending) {
    child.educationDays += ctx.scenario.economy.educationPerSchoolDay;
    if (child.educationDays % 60 === 0) {
      const skill = child.educationDays >= 1_800 ? 'literacy' : 'letters';
      child.skills[skill] = (child.skills[skill] ?? 0) + 1;
    }
    if (child.educationDays === 365) {
      ctx.emit({
        kind: 'school_year',
        actorId: child.id,
        targetId: null,
        visibility: 'private',
        importance: 15,
        title: `${child.name} finished a year of lessons`,
        detail: { educationDays: child.educationDays },
      });
    }
  }
  ctx.state.counters.set('schoolRotation', rotation + capacity);
}

/** Years of schooling, used for job eligibility and civic standing. */
export function educationYears(ctx: TurnContext, residentId: number): number {
  const resident = ctx.state.residents.get(residentId);
  if (!resident) return 0;
  return Math.floor(resident.educationDays / ctx.scenario.calendar.daysPerYear);
}
