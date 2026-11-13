import type { Scenario } from '../contracts/scenario.js';
import type { Resident, WorldState } from '../domain/state.js';
import { liveBuildingCount, openBusinessCount } from '../domain/growth-limits.js';

/** Public production/physical capacity and the actor's own building permissions, not other wallets. */
export function developmentObservation(state: WorldState, scenario: Scenario, actor: Resident): Record<string, unknown> | null {
  const rules = scenario.growth;
  if (!rules) return null;
  const councillor = [...state.offices.values()].some((o) =>
    o.holderId === actor.id && (o.office === 'councillor' || o.office === 'magistrate') &&
    (o.untilDay === null || o.untilDay >= state.day),
  );
  const workplaces = [...state.businesses.values()]
    .filter((b) => b.status === 'open')
    .sort((a, b) => a.id - b.id)
    .slice(0, 16)
    .map((business) => {
      const building = business.buildingId === null ? undefined : state.buildings.get(business.buildingId);
      const staff = [...state.contracts.values()].filter((c) =>
        c.kind === 'employment' && c.status === 'active' && c.businessId === business.id &&
        state.residents.get(c.aId)?.status === 'living',
      ).length;
      return {
        businessId: business.id, buildingId: business.buildingId,
        kind: business.kind, name: business.name, capacity: building?.capacity ?? 0, staff,
        youMaySponsorExpansion: business.ownerType === 'town' ? councillor : business.ownerId === actor.id,
      };
    });
  const ownHome = actor.householdId === null ? undefined : state.households.get(actor.householdId);
  // Only the actor's own projects: the IDs they need for work_construction, never other sponsors' funds.
  const yourProjects = [...state.development.projects.values()]
    .filter((project) => project.status === 'active' && project.sponsorId === actor.id)
    .sort((a, b) => a.id - b.id)
    .slice(0, 4)
    .map((project) => ({
      projectId: project.id, kind: project.kind, businessKind: project.businessKind,
      buildingId: project.targetBuildingId, capacityDelta: project.capacityDelta,
      labourPct: project.requiredLabour > 0 ? Math.floor((project.appliedLabour * 100) / project.requiredLabour) : 100,
    }));
  return {
    yourProjects,
    workplaces,
    yourHomeBuildingId: ownHome?.buildingId ?? null,
    publicShortages: Object.fromEntries(Object.keys(scenario.economy.referencePrices).map((good) =>
      [good, state.counters.get(`shortage:${good}`) ?? 0],
    )),
    newWorkplaceTemplates: rules.workplaceTemplates,
    expansionTemplates: rules.expansionTemplates,
    safetyLimits: {
      buildings: `${liveBuildingCount(state)}/${rules.maxBuildings}`,
      businesses: `${openBusinessCount(state)}/${rules.maxBusinesses}`,
      activeProjects: rules.maxActiveProjects,
    },
  };
}

export const DEVELOPMENT_GUIDE = [
  'Resource-funded growth: build_workplace with businessKind starts a known workplace template.',
  'expand_building with targetId=building ID and capacityDelta expands an authorized building.',
  'work_construction with targetId=project ID continues your development project.',
  'These actions use labour and real materials/capital; a site produces nothing until finished.',
  'Use public shortages and staffing before expanding: more space alone does not produce food.',
  'You cannot spend another resident or household\'s funds; permission and funding are checked.',
].join('\n');
