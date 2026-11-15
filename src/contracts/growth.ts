import { z } from 'zod';
import { GOODS } from '../domain/state.js';

const units = z.number().int().min(0).max(10_000);
const materials = z.partialRecord(z.enum(GOODS), units);
const money = z.number().int().min(0).max(100_000_000);

export const workplaceTemplateSchema = z.object({
  capacity: z.number().int().min(1).max(100),
  labourDays: z.number().int().min(1).max(3650),
  materials,
  constructionCostCents: money,
  startupCapitalCents: money,
});

export const expansionTemplateSchema = z.object({
  capacityCeiling: z.number().int().min(1).max(1000),
  labourDaysPerCapacity: z.number().int().min(1).max(3650),
  materialsPerCapacity: materials,
  constructionCostCentsPerCapacity: money,
});

/** Optional per-scenario overrides. Omit the whole block to use the engine defaults (reclamation is on). */
export const reclamationOverridesSchema = z.object({
  enabled: z.boolean().optional(),
  patchTiles: z.number().int().min(3).max(64).optional(),
  scarcityDistanceTiles: z.number().int().min(0).max(400).optional(),
  labourDays: z.number().int().min(1).max(3650).optional(),
  materials: materials.optional(),
  constructionCostCents: money.optional(),
  cooldownDays: z.number().int().min(0).max(3650).optional(),
  maxActive: z.number().int().min(1).max(4).optional(),
  maxTotal: z.number().int().min(1).max(1000).optional(),
  dockClearanceTiles: z.number().int().min(0).max(32).optional(),
}).strict();

/** Gameplay expansion is elastic, but active and retained entity work stays finite. */
export const growthSchema = z.object({
  populationPolicyEnabled: z.boolean(),
  housingSharing: z.enum(['consent']),
  maxBuildings: z.number().int().min(1).max(50_000),
  maxBusinesses: z.number().int().min(1).max(20_000),
  maxActiveProjects: z.number().int().min(1).max(100),
  /** Live projects: active plus those closed within the last year (older ones are archived). */
  maxProjects: z.number().int().min(1).max(20_000),
  maxPendingHousingRequests: z.number().int().min(1).max(256),
  housingRequestDays: z.number().int().min(1).max(30),
  workplaceTemplates: z.record(z.string().regex(/^[a-z_]{1,40}$/), workplaceTemplateSchema),
  expansionTemplates: z.record(z.string().regex(/^[a-z_]{1,40}$/), expansionTemplateSchema),
  reclamation: reclamationOverridesSchema.optional(),
});

export type GrowthRules = z.infer<typeof growthSchema>;
