import type { Scenario } from '../contracts/scenario.js';
import type { Resident, WorldState } from '../domain/state.js';
import { resolveReclamationRules } from '../domain/reclamation-rules.js';
import { landIsScarce, terrainSupportsReclamation } from '../domain/geography/reclamation-site.js';
import type { LayoutBuilding } from '../domain/geography/layout.js';

/**
 * What a councillor or magistrate is told about land reclamation. Nobody else sees it: residents
 * cannot start the project, so the prompt does not offer it. Only public facts: no wallets of others.
 */
export function reclamationObservation(state: WorldState, scenario: Scenario, actor: Resident): Record<string, unknown> | null {
  const rules = resolveReclamationRules(scenario.growth?.reclamation);
  if (!rules.enabled || !terrainSupportsReclamation(state.terrain)) return null;
  const mayAct = [...state.offices.values()].some((o) =>
    o.holderId === actor.id && (o.office === 'councillor' || o.office === 'magistrate') &&
    (o.untilDay === null || o.untilDay >= state.day));
  if (!mayAct) return null;

  const active = [...state.development.projects.values()]
    .filter((p) => p.kind === 'reclamation' && p.status === 'active')
    .sort((a, b) => a.id - b.id)
    .map((p) => ({
      projectId: p.id,
      labourPct: p.requiredLabour > 0 ? Math.floor((p.appliedLabour * 100) / p.requiredLabour) : 100,
    }));

  const buildings: LayoutBuilding[] = [...state.buildings.values()]
    .sort((a, b) => a.id - b.id)
    .map((b) => ({ id: b.id, placement: b.kind === 'fishery' ? 'shore' as const : 'land' as const }));
  const camps = [...state.households.values()].filter((h) => h.dissolvedDay === null && h.buildingId === null).map((h) => h.id);
  const scarce = landIsScarce({
    seed: state.seed, terrain: state.terrain, patches: state.reclaimed, buildings, campHouseholdIds: camps,
    nextBuildingId: state.nextIds.building ?? 1, patchTiles: rules.patchTiles,
    scarcityDistanceTiles: rules.scarcityDistanceTiles, dockClearanceTiles: rules.dockClearanceTiles, reserved: [],
  });
  return {
    landIsScarce: scarce,
    patchTiles: rules.patchTiles,
    costCents: rules.constructionCostCents,
    materials: rules.materials,
    labourDays: rules.labourDays,
    yourReclamationProjects: active,
    treasuryCents: state.accounts.get('treasury:0')?.balanceCents ?? 0,
    patchesSoFar: state.reclaimed.length,
  };
}

export const RECLAMATION_GUIDE = [
  'As a councillor or magistrate you may propose land reclamation: reclaim_land (no other fields).',
  'It is paid from the public treasury and public timber, needs many labour days, and can start only when',
  'free building land is scarce. The engine picks the site and keeps docks and fishing water clear.',
  'Use work_construction with targetId=the project ID to continue an active reclamation you sponsor.',
  'Do not propose it while land is plentiful or the treasury and timber cannot cover the cost.',
].join('\n');
