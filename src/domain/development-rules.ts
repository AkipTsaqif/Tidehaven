import type { GrowthRules } from '../contracts/growth.js';
import type { DevelopmentRules, DevelopmentTemplate } from './development-types.js';

/** Translate the public scenario contract to the development resolver's complete immutable costs. */
/** Safety caps for towns that define no `growth` block: no workplaces or expansions, but civic works. */
const BASELINE_RULES: DevelopmentRules = {
  templates: {},
  maxActiveProjects: 4,
  maxTotalProjects: 1000,
  maxBusinesses: 1,
  maxBuildings: 1,
};

/**
 * Development rules for a scenario. Reclamation is on by default, so a scenario with no `growth` block
 * still gets a rule set (templates empty: only civic land reclamation can start). The defaults live in
 * engine code, never in stored scenario JSON, so existing saves keep their checksummed rules.
 */
export function developmentRulesFor(growth: GrowthRules | undefined): DevelopmentRules {
  return growth ? developmentRules(growth) : BASELINE_RULES;
}

export function developmentRules(growth: GrowthRules): DevelopmentRules {
  const templates: Record<string, DevelopmentTemplate> = {};
  for (const [kind, template] of Object.entries(growth.workplaceTemplates)) {
    const expansion = growth.expansionTemplates[kind];
    templates[kind] = {
      ...template,
      businessKind: kind,
      capacityCeiling: expansion?.capacityCeiling ?? template.capacity,
      expansion: {
        labourDaysPerCapacity: expansion?.labourDaysPerCapacity ?? 1,
        materialsPerCapacity: expansion?.materialsPerCapacity ?? {},
        constructionCostCentsPerCapacity: expansion?.constructionCostCentsPerCapacity ?? 0,
        startupCapitalCentsPerCapacity: 0,
      },
    };
  }
  const home = growth.expansionTemplates.home;
  return {
    templates,
    ...(home ? { homeExpansion: {
      businessKind: 'home', capacity: 1, capacityCeiling: home.capacityCeiling, labourDays: home.labourDaysPerCapacity,
      materials: home.materialsPerCapacity, constructionCostCents: home.constructionCostCentsPerCapacity,
      startupCapitalCents: 0,
      expansion: { ...home, startupCapitalCentsPerCapacity: 0 },
    } } : {}),
    maxActiveProjects: growth.maxActiveProjects,
    maxTotalProjects: growth.maxProjects,
    maxBusinesses: growth.maxBusinesses,
    maxBuildings: growth.maxBuildings,
    ...(growth.reclamation ? { reclamation: growth.reclamation } : {}),
  };
}
