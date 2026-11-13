import type { ActorPlan } from '../contracts/actions.js';
import type { Scenario } from '../contracts/scenario.js';
import { lifeStage, labourCapacity, isShippingDay } from './clock.js';
import { checkInvariants, type InvariantReport } from './invariants.js';
import { createTurnContext, type TurnContext } from './turn-context.js';
import type { WorldState } from './state.js';
import { population } from './state.js';
import { runProduction, type ProductionOutcome } from './economy/production.js';
import { jobMarketPhase, type JobMarketReport } from './economy/job-market.js';
import { runMarket, type MarketReport } from './economy/market.js';
import { runTrade, type TradeReport } from './economy/trade.js';
import { populationPressurePhase } from './society/population.js';
import { constructionPhase, type ConstructionReport } from './society/construction.js';
import { housingSharingPhase } from './society/housing-sharing.js';
import { developmentPhase } from './society/development.js';
import { developmentRules } from './development-rules.js';
import type { DevelopmentReport } from './development-types.js';
import { schedulePhase } from './society/demographics.js';
import { demographyPhase } from './society/demographics.js';
import { householdPhase } from './society/relationships.js';
import { primaryActionPhase, type PrimaryReport } from './society/actions.js';
import { educationPhase } from './society/education.js';
import { rehouseOrphans } from './society/households.js';
import { civicPhase, type CivicReport } from './events/politics.js';
import { conflictPhase, type ConflictReport } from './events/crime.js';
import { unrestPhase, type UnrestReport } from './events/unrest.js';
import { justicePhase, type JusticeReport } from './events/justice.js';
import { healthPhase, type HealthReport } from './events/health.js';
import { hazardPhase, protectivePhase, type HazardReport } from './events/disasters.js';

/**
 * The daily pipeline. One call = one committed day.
 *
 * Phase order is fixed and documented in docs/RULES.md §2. Each phase only sees the effects of the
 * phases before it, so provider completion order can never influence outcomes.
 */

export interface DayResult {
  day: number;
  ctx: TurnContext;
  invariants: InvariantReport;
  metrics: Record<string, unknown>;
  reports: {
    production: ProductionOutcome;
    market: MarketReport;
    trade: TradeReport;
    hazard: HazardReport;
    civic: CivicReport;
    conflict: ConflictReport;
    unrest: UnrestReport;
    justice: JusticeReport;
    health: HealthReport;
    primary: PrimaryReport;
    construction: ConstructionReport;
    development: DevelopmentReport;
    jobs: JobMarketReport;
  };
}

export interface DayInput {
  state: WorldState;
  scenario: Scenario;
  day: number;
  plans: Map<number, ActorPlan>;
  /** Operator settings applied at this boundary. */
  populationTarget?: number;
}

export function runDay(input: DayInput): DayResult {
  const { state, scenario, day, plans } = input;
  const ctx = createTurnContext({ state, scenario, day });

  if (input.populationTarget !== undefined) state.populationTarget = input.populationTarget;
  state.day = day;

  // 1-2. Scheduled obligations, hazard opportunities.
  ctx.setPhase('schedule');
  schedulePhase(ctx);
  const hazard = hazardPhase(ctx);

  // 3-6. Protection, household agreements, labour, production.
  ctx.setPhase('protect');
  protectivePhase(ctx, hazard);

  ctx.setPhase('household');
  housingSharingPhase(ctx, plans);
  householdPhase(ctx, plans);

  // Model-requested founding and migration execute here, with explicit recorded rejections.
  const primary = primaryActionPhase(ctx, plans);

  // Home construction (scenarios with `construction` only): build_home labour, timber, completion.
  const construction = constructionPhase(ctx, plans);
  const development = developmentPhase(ctx, plans, state.development,
    scenario.growth ? developmentRules(scenario.growth) : undefined);

  // Residents' own job applications and resignations, before automatic hiring fills what is left.
  const jobs = jobMarketPhase(ctx, plans);

  const production = runProduction(ctx, plans);

  // 7. Market and consumption.
  const market = runMarket(ctx, plans);

  // 8. Civic: taxes already withheld/levied; public spending, elections, factions.
  ctx.setPhase('civic');
  const civic = civicPhase(ctx, plans);

  // 9. Social conflict and crime.
  ctx.setPhase('conflict');
  const conflict = conflictPhase(ctx, plans);
  const unrest = unrestPhase(ctx, plans, market);

  // 10. Justice.
  ctx.setPhase('justice');
  const justice = justicePhase(ctx);

  // 11. Health: transmission, treatment, injury, recovery, death.
  ctx.setPhase('health');
  const health = healthPhase(ctx);

  // 12. Demography: births, ageing-out, estates, migration, population pressure.
  ctx.setPhase('demography');
  demographyPhase(ctx);
  rehouseOrphans(ctx);
  educationPhase(ctx);
  populationPressurePhase(ctx, scenario);

  // 13. External trade (weekly).
  const trade = runTrade(ctx);

  // 14. Invariants.
  const invariants = checkInvariants(state);

  const metrics = buildMetrics(ctx, invariants, { production, market, trade, health, conflict, unrest });

  return {
    day,
    ctx,
    invariants,
    metrics,
    reports: { production, market, trade, hazard, civic, conflict, unrest, justice, health, primary, construction, development, jobs },
  };
}

function buildMetrics(
  ctx: TurnContext,
  invariants: InvariantReport,
  parts: {
    production: ProductionOutcome;
    market: MarketReport;
    trade: TradeReport;
    health: HealthReport;
    conflict: ConflictReport;
    unrest: UnrestReport;
  },
): Record<string, unknown> {
  const state = ctx.state;
  const living = [...state.residents.values()].filter((r) => r.status === 'living');
  const stages = { child: 0, adult: 0, elder: 0 };
  for (const resident of living) stages[lifeStage(resident.bornDay, ctx.day, ctx.scenario.calendar)] += 1;
  const labourCapacityTotal = living.reduce(
    (sum, r) => sum + labourCapacity(lifeStage(r.bornDay, ctx.day, ctx.scenario.calendar)),
    0,
  );
  const hunger = living.filter((r) => r.hungerDays > 0).length;
  return {
    population: population(state),
    stages,
    households: [...state.households.values()].filter((h) => h.dissolvedDay === null).length,
    businessesOpen: [...state.businesses.values()].filter((b) => b.status === 'open').length,
    labourCapacityTotal,
    hunger,
    moneySupplyCents: invariants.money.totalCents,
    treasuryCents: invariants.money.treasuryCents,
    goods: Object.fromEntries(Object.entries(invariants.goods).map(([k, v]) => [k, v.total])),
    prices: Object.fromEntries(state.prices.entries()),
    wagesPaidCents: parts.production.totalWagesPaidCents,
    wageArrearsCents: parts.production.totalArrearsCents,
    marketFills: parts.market.fills.length,
    marketVolume: parts.market.volumeByGood,
    unmetDemand: parts.market.unmetDemandByGood,
    tradeExported: parts.trade.exported,
    tradeImported: parts.trade.imported,
    activeIllness: parts.health.activeCases,
    newIllness: parts.health.newCases,
    deaths: parts.health.deaths,
    births: 0,
    crimes: parts.conflict.crimes,
    unrestActive: parts.unrest.active,
    invariantsOk: invariants.ok,
    invariantsViolations: invariants.violations.length,
    shippingDay: isShippingDay(ctx.day, ctx.scenario.calendar),
    events: ctx.events.length,
  };
}
