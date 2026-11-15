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
    if (project.kind === 'reclamation') {
      // A reclamation targets open sea, not a building: its square must be well formed and unclaimed.
      const { reclaimTx: x, reclaimTy: y, reclaimSize: n } = project;
      if (x === undefined || y === undefined || n === undefined || !Number.isSafeInteger(x) ||
        !Number.isSafeInteger(y) || !Number.isSafeInteger(n) || n < 1) {
        report(`project ${id}: invalid reclamation square`);
      } else if (state.reclaimed.some((p) => x < p.tx + p.size && x + n > p.tx && y < p.ty + p.size && y + n > p.ty)) {
        report(`project ${id}: reclamation square already claimed`);
      }
      continue;
    }
    const target = state.buildings.get(project.targetBuildingId);
    if (!target) report(`project ${id}: missing building`);
    if (project.kind === 'workplace' && target && (target.capacity !== 0 || target.privateFlag !== true)) {
      report(`project ${id}: premature premises`);
    }
    if (activeTargets.has(project.targetBuildingId)) report(`project ${id}: duplicated target`);
    activeTargets.add(project.targetBuildingId);
  }
  // Reclaimed land is append-only, numbered in order, never overlapping, and always joined to the coast.
  const patches = state.reclaimed;
  for (let i = 0; i < patches.length; i += 1) {
    const patch = patches[i]!;
    for (const value of [patch.id, patch.projectId, patch.tx, patch.ty, patch.size, patch.fromBuildingId, patch.completedDay]) {
      if (!Number.isSafeInteger(value)) report(`patch ${patch.id}: non-integer value`);
    }
    if (patch.id !== i + 1) report(`patch ${patch.id}: out of sequence`);
    if (patch.size < 1) report(`patch ${patch.id}: invalid size`);
    if (i > 0 && patch.fromBuildingId < patches[i - 1]!.fromBuildingId) report(`patch ${patch.id}: fromBuildingId went backwards`);
    for (let j = 0; j < i; j += 1) {
      const other = patches[j]!;
      if (patch.tx < other.tx + other.size && patch.tx + patch.size > other.tx &&
        patch.ty < other.ty + other.size && patch.ty + patch.size > other.ty) report(`patch ${patch.id}: overlaps patch ${other.id}`);
    }
  }
  return errors;
}
