import { GOODS, type WorldState } from './state.js';
import type { InvariantViolation } from './invariants.js';

/** Corrupt progress must fail before it can grant capacity or release startup funds. */
export function developmentViolations(state: WorldState): InvariantViolation[] {
  const errors: InvariantViolation[] = [];
  const report = (detail: string) => errors.push({ code: 'development_invalid', detail });
  const sequence = state.development.nextId;
  if (!Number.isSafeInteger(sequence) || sequence < 1) report('invalid project sequence');
  const activeTargets = new Set<number>();
  for (const [id, project] of state.development.projects) {
    if (id !== project.id || !Number.isSafeInteger(id) || id < 1 || id >= sequence) report(`project key ${id}`);
    for (const value of [project.requiredLabour, project.appliedLabour, project.targetCapacity,
      project.capacityDelta, project.constructionCostCents, project.startupCapitalCents]) {
      if (!Number.isSafeInteger(value) || value < 0) report(`project ${id}: invalid amount`);
    }
    if (project.appliedLabour > project.requiredLabour) report(`project ${id}: excess labour`);
    for (const good of GOODS) {
      const required = project.requiredMaterials[good] ?? 0;
      const secured = project.securedMaterials[good] ?? 0;
      if (!Number.isSafeInteger(required) || required < 0 || !Number.isSafeInteger(secured) || secured < 0 || secured > required) {
        report(`project ${id}: invalid ${good}`);
      }
    }
    if (project.status !== 'active') continue;
    const escrow = state.accounts.get(`escrow:${project.startupEscrowId}`)?.balanceCents ?? 0;
    if (escrow < project.startupCapitalCents) report(`project ${id}: unfunded startup capital`);
    const target = state.buildings.get(project.targetBuildingId);
    if (!target) report(`project ${id}: missing building`);
    if (project.kind === 'workplace' && target && (target.capacity !== 0 || target.privateFlag !== true)) {
      report(`project ${id}: premature premises`);
    }
    if (activeTargets.has(project.targetBuildingId)) report(`project ${id}: duplicated target`);
    activeTargets.add(project.targetBuildingId);
  }
  return errors;
}
