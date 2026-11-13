import type { GrowthRules } from '../contracts/growth.js';
import type { DevelopmentRules, DevelopmentTemplate } from './development-types.js';

/** Translate the public scenario contract to the development resolver's complete immutable costs. */
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
  };
}
