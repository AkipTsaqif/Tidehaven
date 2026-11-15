import type { DevelopmentMaterials } from './development-types.js';

/**
 * Land reclamation rules.
 *
 * ON BY DEFAULT: a scenario need not mention reclamation. Defaults live here, in engine code, rather
 * than being written into stored scenario JSON, because a saved town's rules are checksummed and
 * resuming with changed rules is refused. A scenario may override any field under `growth.reclamation`;
 * `enabled: false` switches the feature off for that scenario.
 *
 * All values are integers. Money is in cents, distance in tiles, time in days.
 */
export interface ReclamationRules {
  enabled: boolean;
  /** Side of the square patch, in tiles (12 -> 144 tiles, roughly sixteen building lots). */
  patchTiles: number;
  /**
   * Scarcity trigger: reclamation may start only when the nearest free building footprint is farther
   * than this many tiles from the town centre (or there is none at all).
   */
  scarcityDistanceTiles: number;
  labourDays: number;
  materials: DevelopmentMaterials;
  constructionCostCents: number;
  /** Days after a completion or cancellation before another project may start. */
  cooldownDays: number;
  maxActive: number;
  maxTotal: number;
  /** Tiles kept clear around every shore building's dock and the water in front of it. */
  dockClearanceTiles: number;
}

export const DEFAULT_RECLAMATION: ReclamationRules = {
  enabled: true,
  patchTiles: 12,
  scarcityDistanceTiles: 16,
  labourDays: 90,
  materials: { timber: 120 },
  constructionCostCents: 40_000,
  cooldownDays: 30,
  maxActive: 1,
  maxTotal: 64,
  dockClearanceTiles: 4,
};

export type ReclamationOverrides = Partial<Omit<ReclamationRules, 'materials'>> & { materials?: DevelopmentMaterials };

/** Merge a scenario's optional overrides over the engine defaults and validate the result. */
export function resolveReclamationRules(overrides?: ReclamationOverrides | null): ReclamationRules {
  const rules: ReclamationRules = { ...DEFAULT_RECLAMATION, ...(overrides ?? {}) };
  if (overrides?.materials) rules.materials = { ...overrides.materials };
  const integers: [string, number, number, number][] = [
    ['patchTiles', rules.patchTiles, 3, 64],
    ['scarcityDistanceTiles', rules.scarcityDistanceTiles, 0, 400],
    ['labourDays', rules.labourDays, 1, 3650],
    ['constructionCostCents', rules.constructionCostCents, 0, 100_000_000],
    ['cooldownDays', rules.cooldownDays, 0, 3650],
    ['maxActive', rules.maxActive, 1, 4],
    ['maxTotal', rules.maxTotal, 1, 1000],
    ['dockClearanceTiles', rules.dockClearanceTiles, 0, 32],
  ];
  for (const [name, value, min, max] of integers) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`reclamation.${name} must be an integer in ${min}..${max}, got ${value}`);
    }
  }
  for (const [good, quantity] of Object.entries(rules.materials)) {
    if (!Number.isSafeInteger(quantity) || (quantity as number) < 0 || (quantity as number) > 10_000) {
      throw new Error(`reclamation.materials.${good} must be an integer in 0..10000`);
    }
  }
  return rules;
}
