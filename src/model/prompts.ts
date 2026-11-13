import type { Scenario } from '../contracts/scenario.js';
import type { WorldState, Resident } from '../domain/state.js';
import { lifeStage } from '../domain/clock.js';
import { householdFoodDaysForCount } from '../domain/society/households.js';
import { balanceOf, quantityOf } from '../domain/state.js';
import { buildObservationLookups, type ObservationLookups } from '../domain/lookups.js';
import { DEVELOPMENT_GUIDE, developmentObservation } from './development-observation.js';
import { JOB_GUIDE, jobListings } from './job-listings.js';
import { buildHappinessContext, moodLabel, scoreHappiness } from '../domain/society/happiness.js';
import { buildHousingObservation } from './housing-observation.js';

/**
 * Prompt construction. Bounded, privacy-filtered, and deterministic for a given observation set:
 * an actor only sees public facts, their own accounts, their own household, and events they witnessed.
 */

export interface PromptMemory {
  day: number;
  text: string;
  importance: number;
}

export interface PromptEvent {
  day: number;
  kind: string;
  title: string;
  public: boolean;
}

export interface ActorPromptInput {
  state: WorldState;
  scenario: Scenario;
  resident: Resident;
  day: number;
  memories: PromptMemory[];
  events: PromptEvent[];
  maxBytes: number;
  maxRecords: number;
  /**
   * Shared lookups for a batch of prompts built against the same unchanged state and day. Optional:
   * when absent or built for a different state/day, the prompt builds its own.
   */
  lookups?: ObservationLookups;
}

export interface ActorPrompt {
  system: string;
  user: string;
  promptVersion: string;
  bytes: number;
}

export const PROMPT_VERSION = 'resident-plan-v2';

const ACTION_GUIDE = [
  'Choose exactly one primary action:',
  '  work (do your paid job), rest, study, seek_work (businessId = where to apply), quit_job, shop, civic (unpaid',
  '  public duty), care (look after someone),',
  '  request_relief, found_business (needs buildingId), invest, migrate (leave Tidehaven),',
  'Choose at most one social action (or null):',
  '  courtship, affair, conceive, divorce, accept (accept a pending proposal), refuse, talk, befriend, feud,',
  '  reconcile, report_crime, accuse, defend, apologise. Social actions need a targetId.',
  '  write_will (needs targetId of your heir; detail is the share in basis points, 1-10000).',
  'Give up to four market orders (or none): {good, side:"buy"|"sell", quantity, limitPriceCents}.',
  'Give up to three intents (or none): theft, fraud, bribery, tax_evasion, assault, intimidate, strike_call,',
  '  protest_call, riot_call, rebel, sabotage, conceal_affair, spread_rumour, guard_patrol, treat_patient, teach.',
  'Crime and violence require a targetId or businessId and are resolved by the town, not by you.',
  'Reply with a single JSON object matching the provided schema. No prose, no code fences.',
].join('\n');

const BUILD_GUIDE = [
  'Housing: build_home is also a primary action. You spend most of your day on a home site (your job keeps',
  '  the rest). A home needs the labour and timber shown under HOUSING; timber is taken from your household,',
  '  bought from the store or timber camp, or felled by hand when none can be bought. Build when your household',
  '  has no roof, is full, or the town has no free home for newcomers and new couples. Do not build when there',
  '  are already free homes.',
].join('\n');

export function buildActorPrompt(input: ActorPromptInput): ActorPrompt {
  const { state, scenario, resident, day } = input;
  const lookups =
    input.lookups && input.lookups.state === state && input.lookups.day === day
      ? input.lookups
      : buildObservationLookups(state, day);
  const household = resident.householdId === null ? null : state.households.get(resident.householdId);
  const contract = lookups.employmentByResident.get(resident.id) ?? null;
  const job =
    contract === null || contract?.businessId === null || contract?.businessId === undefined
      ? null
      : (state.businesses.get(contract.businessId) ?? null);

  const identity = {
    name: resident.name,
    id: resident.id,
    sex: resident.sex,
    ageYears: Math.floor((day - resident.bornDay) / scenario.calendar.daysPerYear),
    stage: lifeStage(resident.bornDay, day, scenario.calendar),
    health: resident.healthState,
    cashCents: balanceOf(state, 'resident', resident.id),
    traits: resident.traits,
    skills: resident.skills,
    mood: moodFor(lookups, scenario, resident),
  };

  const householdMembers = household ? (lookups.membersByHousehold.get(household.id) ?? []) : [];
  const householdInfo = household
    ? {
        id: household.id,
        name: household.name,
        foodDays: householdFoodDaysForCount(state, scenario, household.id, householdMembers.length),
        cashCents: balanceOf(state, 'household', household.id),
        members: householdMembers
          .map((r) => ({ id: r.id, name: r.name, age: Math.floor((day - r.bornDay) / scenario.calendar.daysPerYear) })),
      }
    : null;

  const work = job
    ? {
        businessId: job.id,
        name: job.name,
        kind: job.kind,
        wageClass: contract?.terms.wageClass ?? 'unskilled',
        wageCents: typeof contract?.terms.wageCents === 'number' ? contract.terms.wageCents : null,
      }
    : null;
  const adult = lifeStage(resident.bornDay, day, scenario.calendar) !== 'child';
  const board = adult ? jobListings(state, scenario, lookups) : [];

  const relationships = [...state.relationships.values()]
    .filter((r) => r.aId === resident.id || r.bId === resident.id)
    .filter((r) => r.untilDay === null)
    .slice(0, 12)
    .map((r) => ({
      kind: r.kind,
      otherId: r.aId === resident.id ? r.bId : r.aId,
      trust: r.trust,
    }));

  const housing = housingInfo(input, lookups);
  const development = developmentObservation(state, scenario, resident, lookups);
  const sharing = scenario.growth?.housingSharing === 'consent'
    ? buildHousingObservation({ state, scenario, actorId: resident.id, day, maxHosts: 8, maxRequests: 8, lookups }) : null;

  const prices = Object.fromEntries(state.prices.entries());
  const visibleEvents = input.events
    .slice(-input.maxRecords)
    .map((e) => `${e.day}: ${e.title}${e.public ? '' : ' (private)'}`);
  const memories = input.memories.slice(-input.maxRecords).map((m) => `${m.day}: ${m.text}`);

  const user = [
    `SIMULATED DAY ${day} in ${state.name}.`,
    `You are ${resident.name}.`,
    '',
    'IDENTITY',
    JSON.stringify(identity),
    '',
    'HOUSEHOLD',
    JSON.stringify(householdInfo),
    '',
    'WORK',
    JSON.stringify(work),
    '',
    ...(adult ? ['JOB BOARD (open places)', board.length > 0 ? JSON.stringify(board) : '(no open places today)', ''] : []),
    'RELATIONSHIPS',
    JSON.stringify(relationships),
    '',
    ...(housing === null ? [] : ['HOUSING', JSON.stringify(housing), '']),
    ...(development === null ? [] : ['DEVELOPMENT', JSON.stringify(development), '']),
    ...(sharing === null ? [] : ['HOUSING AGREEMENTS', JSON.stringify(sharing), '']),
    'MARKET PRICES (cents)',
    JSON.stringify(prices),
    '',
    'WHAT YOU KNOW HAS HAPPENED',
    visibleEvents.length > 0 ? visibleEvents.join('\n') : '(nothing new)',
    '',
    'WHAT YOU REMEMBER',
    memories.length > 0 ? memories.join('\n') : '(nothing remembered)',
    '',
    'RULES THAT BIND YOU',
    ACTION_GUIDE,
    ...(adult ? [JOB_GUIDE] : []),
    ...(housing === null ? [] : [BUILD_GUIDE]),
    ...(development === null ? [] : [DEVELOPMENT_GUIDE]),
    ...(sharing === null ? [] : [
      'A single independent camping adult may request_housing with targetId=an adult host ID.',
      'Every adult host must accept_housing (targetId=proposalId), or refuse_housing. Silence is not agreement.',
      'Sharing a home does not mean romance; no one moves until every required host agrees and space is rechecked.',
      'If you want to offer a spare room, accept a request; if you prefer privacy, refuse. Otherwise build_home remains available.',
    ]),
  ].join('\n');

  // Bound the prompt: drop oldest context lines until it fits.
  const maxBytes = Math.max(4_096, input.maxBytes);
  let boundedUser = user;
  if (Buffer.byteLength(boundedUser, 'utf8') > maxBytes) {
    const lines = boundedUser.split('\n');
    while (Buffer.byteLength(lines.join('\n'), 'utf8') > maxBytes && lines.length > 40) {
      lines.splice(1, 1);
    }
    boundedUser = lines.join('\n');
  }

  const system =
    'You are a resident of a small island town in a simulated society. ' +
    'You act in your own interest within the law and your circumstances, and you never invent facts. ' +
    'Your answer is a JSON plan that the town will validate; illegal or impossible actions are simply refused. ' +
    'Never mention being a model, and never output anything except the JSON object.';

  return {
    system,
    user: boundedUser,
    promptVersion: development !== null ? `${PROMPT_VERSION}+growth-v1` : housing === null ? PROMPT_VERSION : `${PROMPT_VERSION}+housing`,
    bytes: Buffer.byteLength(system, 'utf8') + Buffer.byteLength(boundedUser, 'utf8'),
  };
}

/**
 * Public housing facts, only for scenarios with construction rules: the actor's roof, free homes, and
 * open building sites with their progress. Everything here is visible to any resident walking the town.
 */
function housingInfo(input: ActorPromptInput, lookups: ObservationLookups): Record<string, unknown> | null {
  const { state, scenario, resident } = input;
  const rules = scenario.construction;
  if (!rules) return null;
  const household = resident.householdId === null ? null : state.households.get(resident.householdId);
  const home = household === null || household === undefined || household.buildingId === null ? null : state.buildings.get(household.buildingId);
  const members = household ? (lookups.membersByHousehold.get(household.id)?.length ?? 0) : 0;
  const occupied = lookups.occupiedBuildingIds;
  const freeHomes = [...state.buildings.values()].filter(
    (b) => b.kind === 'home' && b.destroyedDay === null && !occupied.has(b.id),
  ).length;
  const sites = [...state.buildings.values()]
    .filter((b) => b.kind === 'home_site' && b.destroyedDay === null)
    .sort((a, b) => a.id - b.id)
    .slice(0, 5)
    .map((b) => ({
      name: b.name,
      labourPct: Math.floor(((state.counters.get(`site:${b.id}:labour`) ?? 0) * 100) / (rules.labourDays * 100)),
      timber: `${state.counters.get(`site:${b.id}:timber`) ?? 0}/${rules.timberUnits}`,
    }));
  return {
    yourHome: home ? { name: home.name, capacity: household?.capacity ?? 0, members } : 'none: your household is camping',
    freeHomes,
    sitesUnderConstruction: sites,
    toBuildOneHome: {
      labourDays: rules.labourDays,
      timberUnits: rules.timberUnits,
      timberPriceCents: state.prices.get('timber') ?? scenario.economy.referencePrices.timber.price,
      householdTimber: household ? quantityOf(state, 'household', household.id, 'timber') : 0,
      capacity: rules.homeCapacity,
    },
  };
}

/**
 * The resident's own mood and its biggest reasons, so the model can act on how its life is going.
 * Only their own life: no other resident's happiness is ever shown.
 */
function moodFor(lookups: ObservationLookups, scenario: Scenario, resident: Resident): Record<string, unknown> {
  lookups.happiness ??= buildHappinessContext(lookups.state, lookups.day);
  const { score, factors } = scoreHappiness(lookups.happiness, resident, scenario.calendar);
  const reasons = Object.entries(factors)
    .filter(([, value]) => value !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 4)
    .map(([name, value]) => `${name} ${value > 0 ? '+' : ''}${value}`);
  return { happiness: score, feeling: moodLabel(score), reasons };
}
