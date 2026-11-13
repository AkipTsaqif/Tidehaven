import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scenarioSchema, type Scenario } from '../contracts/scenario.js';
import { hashValue } from '../domain/hash.js';
import { ConfigError } from '../config.js';

/** Scenario loading and rules-version derivation. */

export const RULES_VERSION = 'tidehaven-1';

export function loadScenario(root: string, file = 'scenarios/tidehaven.json'): Scenario {
  const path = join(root, file);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`Cannot read scenario at ${path}`, [String(err)]);
  }
  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid scenario at ${path}`,
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const scenario = parsed.data;
  validateScenarioConsistency(scenario);
  return scenario;
}

/** Cross-field checks that Zod cannot express. */
export function validateScenarioConsistency(scenario: Scenario): void {
  const issues: string[] = [];
  const buildings = new Set(scenario.town.buildings.map((b) => b.id));
  for (const household of scenario.town.households) {
    if (!buildings.has(household.building)) issues.push(`household ${household.name} uses unknown building`);
  }
  for (const business of scenario.town.businesses) {
    if (!buildings.has(business.building)) issues.push(`business ${business.name} uses unknown building`);
    if (!scenario.economy.recipes[business.kind]) issues.push(`business ${business.name} has no recipe for ${business.kind}`);
  }
  const householdIds = new Set(scenario.town.households.map((h) => h.id));
  const names = new Set<string>();
  for (const resident of scenario.town.residents) {
    if (!householdIds.has(resident.household)) issues.push(`resident ${resident.name} uses unknown household`);
    if (names.has(resident.name)) issues.push(`duplicate resident name ${resident.name}`);
    names.add(resident.name);
  }
  for (const business of scenario.town.businesses) {
    if (business.owner !== null && !names.has(business.owner)) {
      issues.push(`business ${business.name} has unknown owner ${business.owner}`);
    }
  }
  for (const resident of scenario.town.residents) {
    if (resident.job !== null && !scenario.town.businesses.some((b) => b.name === resident.job)) {
      issues.push(`resident ${resident.name} has unknown job ${resident.job}`);
    }
  }
  if (scenario.town.residents.length < 1) issues.push('scenario has no residents');
  if (scenario.growth) {
    const growth = scenario.growth;
    if (!scenario.construction) issues.push('growth requires home construction rules');
    if (scenario.town.buildings.length > growth.maxBuildings) issues.push('founding buildings exceed growth safety limit');
    if (scenario.town.businesses.length > growth.maxBusinesses) issues.push('founding businesses exceed growth safety limit');
    if (growth.maxActiveProjects > growth.maxProjects) issues.push('active projects exceed total project safety limit');
    for (const [kind, template] of Object.entries(growth.workplaceTemplates)) {
      if (!scenario.economy.recipes[kind]) issues.push(`workplace template ${kind} has no recipe`);
      const expansion = growth.expansionTemplates[kind];
      if (expansion && template.capacity > expansion.capacityCeiling) issues.push(`template ${kind} exceeds its capacity ceiling`);
    }
    for (const kind of Object.keys(growth.expansionTemplates)) {
      if (kind !== 'home' && !scenario.economy.recipes[kind]) issues.push(`expansion template ${kind} has no recipe`);
    }
  }
  for (const good of Object.keys(scenario.economy.referencePrices)) {
    if (!Object.prototype.hasOwnProperty.call(scenario.economy.referencePrices, good)) {
      issues.push(`reference price missing for ${good}`);
    }
  }
  if (issues.length > 0) throw new ConfigError('Scenario consistency errors', issues);
}

/** Hash of the rules contract; stored with the world so replay uses the same numbers. */
export function scenarioHash(scenario: Scenario): string {
  return hashValue(scenario);
}
