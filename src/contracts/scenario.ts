import { z } from 'zod';
import { GOODS } from '../domain/state.js';
import { growthSchema } from './growth.js';

/** Scenario file contract. Checked in, contains no credentials, versioned by `version`. */

const goodName = z.enum(GOODS);
const goodMap = z.partialRecord(goodName, z.number().int().min(0));

export const recipeSchema = z.object({
  labourPerBatch: z.number().int().min(1),
  inputs: goodMap.default({}),
  outputs: goodMap.default({}),
  service: z.enum(['treatment', 'retail', 'security', 'justice', 'governance', 'works']).optional(),
  wageClass: z.enum(['unskilled', 'skilled', 'official']),
});

/**
 * Immigration cadence. A town may keep newcomers away while the founders settle, then open slowly and
 * speed up as the community grows. The default reproduces the original fixed 5-day cadence.
 */
const immigrationSchema = z
  .object({
    /** No immigration before this day (the founders' settling period); the first newcomer may come then. */
    startDay: z.number().int().min(0).max(36500).default(0),
    /** Gap in days after the first newcomer; later gaps shrink by `stepDays` per arrival. */
    initialIntervalDays: z.number().int().min(1).max(3650).default(5),
    /** The gap never gets shorter than this. */
    minIntervalDays: z.number().int().min(1).max(3650).default(5),
    /** Days removed from the gap after each arrival, until it reaches `minIntervalDays`. */
    stepDays: z.number().int().min(0).max(3650).default(0),
  })
  .refine((value) => value.minIntervalDays <= value.initialIntervalDays, {
    message: 'minIntervalDays must not exceed initialIntervalDays',
  });

export type ImmigrationRules = z.infer<typeof immigrationSchema>;

/**
 * Home construction. When present, residents may choose `build_home`: a house costs labour and timber,
 * and newcomers who find no vacant home camp until a home is built for them. Absent = no construction
 * (the fixed housing stock of the original scenario).
 */
const constructionSchema = z.object({
  /** Residents a finished home holds. */
  homeCapacity: z.number().int().min(1).max(20),
  /** Adult person-days of building work a home needs. */
  labourDays: z.number().int().min(1).max(3650),
  /** Timber units a home needs. */
  timberUnits: z.number().int().min(0).max(1000),
  /** Timber one adult fells in a day when none can be bought. */
  fellPerDay: z.number().int().min(1).max(100),
  /** Homes that may be under construction at the same time. */
  maxActiveSites: z.number().int().min(1).max(50),
  /** Newcomer camps (households with no roof) allowed at once; immigration waits while all are taken. */
  maxCamps: z.number().int().min(0).max(100),
});

export type ConstructionRules = z.infer<typeof constructionSchema>;

export const scenarioSchema = z.object({
  version: z.string().min(1),
  description: z.string().default(''),
  immigration: immigrationSchema.optional(),
  construction: constructionSchema.optional(),
  growth: growthSchema.optional(),
  calendar: z.object({
    daysPerYear: z.number().int().min(1),
    adultDays: z.number().int().min(1),
    elderDays: z.number().int().min(1),
    pregnancyDays: z.number().int().min(1),
    weekDays: z.number().int().min(1),
  }),
  economy: z.object({
    foodNeedPerDay: z.number().int().min(0),
    mealGoods: z.array(goodName).min(1),
    spoilageBps: z.partialRecord(goodName, z.number().int().min(0).max(10000)).default({}),
    spoilageMinStock: z.number().int().min(0).default(1),
    wages: z.object({
      unskilled: z.number().int().min(0),
      skilled: z.number().int().min(0),
      official: z.number().int().min(0),
    }),
    incomeTaxBps: z.number().int().min(0).max(10000),
    personalAllowanceBps: z.number().int().min(0).max(10000),
    personalFloatCents: z.number().int().min(0),
    citizensDividendCents: z.number().int().min(0),
    dividendTreasuryThresholdCents: z.number().int().min(0),
    wealthLevyThresholdCents: z.number().int().min(0),
    wealthLevyBps: z.number().int().min(0).max(10000),
    childAllowanceCentsPerDay: z.number().int().min(0),
    dividendReserveCents: z.number().int().min(0),
    maxIncomeTaxBps: z.number().int().min(0).max(10000),
    businessLevyBps: z.number().int().min(0).max(10000),
    salesTaxBps: z.number().int().min(0).max(10000),
    retailFeeBps: z.number().int().min(0).max(10000),
    toolWearWorkerDays: z.number().int().min(1),
    skillsPerWorkDay: z.number().int().min(0),
    educationPerSchoolDay: z.number().int().min(0),
    schoolCapacity: z.number().int().min(0),
    treasuryCents: z.number().int().min(0),
    businessStartCashCents: z.number().int().min(0),
    townBusinessStartCashCents: z.number().int().min(0),
    householdReserveDays: z.number().int().min(0),
    householdCashCents: z.number().int().min(0),
    externalCashCents: z.number().int(),
    externalCreditLimitCents: z.number().int().min(0),
    externalCapacityUnits: z.number().int().min(0),
    priceBoundsBps: z.object({ low: z.number().int().min(1), high: z.number().int().min(1) }),
    priceStepBps: z.number().int().min(0).max(10000),
    referencePrices: z.record(
      goodName,
      z.object({
        price: z.number().int().min(1),
        import: z.number().int().min(1),
        export: z.number().int().min(1),
      }),
    ),
    recipes: z.record(z.string(), recipeSchema),
    serviceCapacityPerLabour: z.record(z.string(), z.record(z.string(), z.number().int().min(0))).default({}),
    householdBasketWeights: z.partialRecord(goodName, z.number().int().min(0)).default({}),
    householdToolsPerResidentPerYear: z.number().int().min(0),
    clinicMedicinePerDay: z.number().int().min(0),
  }),
  town: z.object({
    buildings: z
      .array(
        z.object({
          id: z.number().int().min(1),
          name: z.string().min(1),
          kind: z.string().min(1),
          capacity: z.number().int().min(0),
        }),
      )
      .min(1),
    households: z
      .array(
        z.object({
          id: z.number().int().min(1),
          name: z.string().min(1),
          building: z.number().int().min(1),
        }),
      )
      .min(1),
    businesses: z
      .array(
        z.object({
          name: z.string().min(1),
          kind: z.string().min(1),
          building: z.number().int().min(1),
          owner: z.string().min(1).nullable(),
        }),
      )
      .min(1),
    residents: z
      .array(
        z.object({
          name: z.string().min(1),
          sex: z.enum(['female', 'male']),
          age: z.number().int().min(0).max(120),
          household: z.number().int().min(1),
          job: z.string().min(1).nullable(),
          traits: z.record(z.string(), z.number().int().min(0).max(100)).default({}),
        }),
      )
      .min(1),
    councilSeats: z.number().int().min(1).max(9),
  }),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
