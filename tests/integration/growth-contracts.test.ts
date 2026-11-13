import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../src/application/scenario.js';
import { rulesVersionFor } from '../../src/application/bootstrap.js';
import { planSchema } from '../../src/contracts/actions.js';
import { growthSchema } from '../../src/contracts/growth.js';

const growth = {
  populationPolicyEnabled: false,
  housingSharing: 'consent',
  maxBuildings: 1000, maxBusinesses: 500, maxActiveProjects: 8, maxProjects: 2000,
  maxPendingHousingRequests: 32, housingRequestDays: 7,
  workplaceTemplates: {
    farm: { capacity: 4, labourDays: 12, materials: { timber: 6, tools: 1 }, constructionCostCents: 1000, startupCapitalCents: 10_000 },
  },
  expansionTemplates: {
    farm: { capacityCeiling: 100, labourDaysPerCapacity: 2, materialsPerCapacity: { timber: 1 }, constructionCostCentsPerCapacity: 200 },
    home: { capacityCeiling: 20, labourDaysPerCapacity: 2, materialsPerCapacity: { timber: 1 }, constructionCostCentsPerCapacity: 100 },
  },
};

describe('bounded growth contracts', () => {
  it('accepts structured growth proposals and rejects arbitrary capacity and template data', () => {
    expect(planSchema.parse({ primary: { kind: 'build_workplace', businessKind: 'farm' } }).primary?.businessKind).toBe('farm');
    expect(planSchema.parse({ primary: { kind: 'expand_building', targetId: 8, capacityDelta: 2 } }).primary?.capacityDelta).toBe(2);
    for (const capacityDelta of [0, -1, 1.5, 101, Infinity]) {
      expect(planSchema.safeParse({ primary: { kind: 'expand_building', capacityDelta } }).success).toBe(false);
    }
    expect(growthSchema.safeParse(growth).success).toBe(true);
    expect(growthSchema.safeParse({ ...growth, maxActiveProjects: Infinity }).success).toBe(false);
  });

  it('does not inject new default rules into the legacy scenario', () => {
    const legacy = loadScenario(process.cwd());
    expect(legacy.growth).toBeUndefined();
    expect(rulesVersionFor(legacy)).toBe('tidehaven-1:6aec47e672b1');
  });
});
