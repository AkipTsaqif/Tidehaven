import type { Good, OwnerType } from './state.js';
import type { ReclamationOverrides } from './reclamation-rules.js';

/** Material quantities are scenario-owned; omitted goods have a zero requirement. */
export type DevelopmentMaterials = Partial<Record<Good, number>>;

export interface DevelopmentExpansionCosts {
  labourDaysPerCapacity: number;
  materialsPerCapacity: DevelopmentMaterials;
  constructionCostCentsPerCapacity: number;
  startupCapitalCentsPerCapacity: number;
}

/**
 * A versioned, scenario-owned development template. Residents may select only the key of a template;
 * they cannot supply any of these values in an action.
 */
export interface DevelopmentTemplate {
  businessKind: string;
  name?: string;
  capacity: number;
  /** Maximum capacity permitted for this target building by the matching template. */
  capacityCeiling: number;
  labourDays: number;
  materials: DevelopmentMaterials;
  constructionCostCents: number;
  startupCapitalCents: number;
  expansion: DevelopmentExpansionCosts;
}

export interface DevelopmentRules {
  templates: Record<string, DevelopmentTemplate>;
  /** Optional template used when an existing private home is extended. */
  homeExpansion?: DevelopmentTemplate;
  maxActiveProjects: number;
  maxTotalProjects: number;
  maxBusinesses: number;
  maxBuildings: number;
  /** Land reclamation overrides; absent means engine defaults (feature on). */
  reclamation?: ReclamationOverrides;
  /** Defaults to councillor and magistrate when omitted. */
  authorizedOffices?: readonly ('councillor' | 'magistrate')[];
}

export type DevelopmentProjectKind = 'workplace' | 'expansion' | 'reclamation';
export type DevelopmentProjectStatus = 'active' | 'completed' | 'cancelled' | 'abandoned';

export interface DevelopmentMaterialLot {
  good: Good;
  quantity: number;
  sourceType: Exclude<OwnerType, 'escrow' | 'external'>;
  sourceId: number;
  paidCents: number;
}

/** Durable project record. Parent persistence should serialize this shape without deriving fields. */
export interface DevelopmentProject {
  id: number;
  kind: DevelopmentProjectKind;
  status: DevelopmentProjectStatus;
  sponsorId: number;
  ownerType: 'resident' | 'town';
  ownerId: number;
  authorizedBy: number | null;
  businessKind: string | null;
  targetBuildingId: number;
  targetBusinessId: number | null;
  targetHouseholdId: number | null;
  targetOwnerType: 'resident' | 'town' | null;
  targetOwnerId: number | null;
  targetCapacity: number;
  capacityDelta: number;
  requiredLabour: number;
  appliedLabour: number;
  requiredMaterials: Record<Good, number>;
  securedMaterials: Record<Good, number>;
  materialLots: DevelopmentMaterialLot[];
  constructionCostCents: number;
  startupCapitalCents: number;
  startupEscrowId: number;
  startedDay: number;
  completedDay: number | null;
  cancelledDay: number | null;
  cancellationReason: string | null;
  /** Reclamation only: the square of sea that becomes land, chosen by the engine at start. */
  reclaimTx?: number;
  reclaimTy?: number;
  reclaimSize?: number;
}

export interface DevelopmentState {
  projects: Map<number, DevelopmentProject>;
  nextId: number;
}

export interface DevelopmentRejection {
  actorId: number;
  reason: string;
  projectId?: number;
}

export interface DevelopmentReport {
  started: number;
  progressed: number;
  completed: number;
  cancelled: number;
  rejected: number;
  rejections: DevelopmentRejection[];
}

export interface DevelopmentResult {
  ok: boolean;
  reason?: string;
  projectId?: number;
}

export function emptyDevelopmentState(nextId = 1): DevelopmentState {
  return { projects: new Map(), nextId };
}
