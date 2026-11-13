import type { TurnContext } from '../turn-context.js';
import type { Scenario } from '../../contracts/scenario.js';
import { ageInDays, isShippingDay } from '../clock.js';
import { nextId, relationshipKey, type Resident } from '../state.js';
import { releaseMinorTrust, settleEstate } from './estates.js';
import { reassignCare } from './households.js';
import { applyDeathLifecycle } from './lifecycle.js';
import { isAdult } from '../clock.js';

/**
 * The schedule and demography phases.
 *
 * schedule: obligations that come due today (pregnancy terms, sentence timers, contract expiry,
 *   case timers, weekly/annual markers). Nothing here is applied twice: each timer is keyed by day.
 * demography: births, guardianship for children of the dead, estate settlement, lineage tombstones.
 */

export function schedulePhase(ctx: TurnContext): void {
  // Contracts that reached their end day are marked ended.
  for (const contract of ctx.state.contracts.values()) {
    if (contract.status !== 'active') continue;
    if (contract.endDay !== null && contract.endDay <= ctx.day) contract.status = 'ended';
  }

  // Sentences that have run their course are marked served (release happens in justice).
  for (const sentence of ctx.state.sentences.values()) {
    if (sentence.status !== 'active') continue;
    if (sentence.endDay !== null && sentence.endDay < ctx.day) sentence.status = 'served';
  }

  // Pregnancies reaching term are collected by demographyPhase; mark nothing here to avoid double
  // application after a restart.

  // Proposals expire.
  for (const proposal of ctx.state.proposals.values()) {
    if (proposal.status === 'pending' && proposal.expiresDay < ctx.day) proposal.status = 'expired';
  }

  // Prisoners cannot work; their hunger is handled by the household they belong to (if any).
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    if (resident.hungerDays > 30 && ctx.day % 30 === 0) {
      ctx.emit({
        kind: 'resident_desperate',
        actorId: resident.id,
        targetId: null,
        visibility: 'public',
        importance: 25,
        title: `${resident.name} has gone hungry for ${resident.hungerDays} days`,
        detail: { hungerDays: resident.hungerDays },
      });
    }
  }
}

export function demographyPhase(ctx: TurnContext): void {
  const scenario: Scenario = ctx.scenario;
  const births: number[] = [];

  for (const pregnancy of ctx.state.pregnancies.values()) {
    if (pregnancy.status !== 'active') continue;
    if (pregnancy.dueDay > ctx.day) continue;
    const mother = ctx.state.residents.get(pregnancy.motherId);
    const father = ctx.state.residents.get(pregnancy.fatherId);
    if (!mother || mother.status !== 'living') {
      pregnancy.status = 'lost';
      pregnancy.resolvedDay = ctx.day;
      continue;
    }
    const roll = ctx.rngFor(mother.id, `birth:${pregnancy.id}`);
    const lossChancePpm = mother.healthState === 'healthy' ? 5_000 : 40_000;
    if (roll.chancePpm(lossChancePpm)) {
      pregnancy.status = 'lost';
      pregnancy.resolvedDay = ctx.day;
      ctx.emit({
        kind: 'pregnancy_lost',
        actorId: mother.id,
        targetId: father?.id ?? null,
        visibility: 'private',
        importance: 60,
        title: `${mother.name} lost the pregnancy`,
        detail: { pregnancyId: pregnancy.id },
      });
      continue;
    }
    const child = createChild(ctx, mother, father ?? null, pregnancy.id);
    pregnancy.status = 'delivered';
    pregnancy.childId = child.id;
    pregnancy.resolvedDay = ctx.day;
    births.push(child.id);
    ctx.emit({
      kind: 'birth',
      actorId: mother.id,
      targetId: child.id,
      visibility: 'public',
      importance: 80,
      title: `${child.name} was born to ${mother.name}${father ? ` and ${father.name}` : ''}`,
      detail: { motherId: mother.id, fatherId: father?.id ?? null, childId: child.id },
    });
    ctx.remember(mother.id, 'life', `${child.name} was born on day ${ctx.day}.`, 90, []);
    if (father) ctx.remember(father.id, 'life', `${child.name} was born on day ${ctx.day}.`, 90, []);
  }

  // Deaths: settle estates and reassign care. Keyed by "no estate yet" rather than "died today" so a
  // crash between death and settlement cannot orphan an estate.
  const settled = new Set([...ctx.state.estates.values()].map((estate) => estate.deceasedId));
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'dead') continue;
    if (settled.has(resident.id)) continue;
    openEstateFor(ctx, resident);
    reassignCare(ctx, resident);
    // Estate settlement runs first (it needs the deceased's original holdings and partner); then the
    // departure lifecycle ends employment, offices, the partnership, and any remaining asset ties.
    applyDeathLifecycle(ctx, resident);
  }

  // Ageing milestone events (adulthood) keep history readable.
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    const age = ageInDays(resident.bornDay, ctx.day);
    if (age === scenario.calendar.adultDays) {
      // Protected minor assets become the adult's own money on the day they come of age.
      releaseMinorTrust(ctx, resident.id);
      ctx.emit({
        kind: 'coming_of_age',
        actorId: resident.id,
        targetId: null,
        visibility: 'public',
        importance: 35,
        title: `${resident.name} came of age`,
        detail: { age },
      });
      ctx.remember(resident.id, 'life', `I became an adult on day ${ctx.day}.`, 70, []);
    }
  }

  // Lineage tombstones: emigrated residents keep a compact record in the residents table (status
  // 'emigrated') and are never deleted, so descendants can still be traced.

  if (isShippingDay(ctx.day, scenario.calendar) && births.length === 0) {
    // Weekly demographic bookkeeping is intentionally silent; metrics carry the numbers.
  }
}

function createChild(ctx: TurnContext, mother: Resident, father: Resident | null, pregnancyId: number): Resident {
  const id = nextId(ctx.state, 'resident');
  const rng = ctx.rngFor(id, 'traits');
  const surname = father?.name.split(' ').slice(-1)[0] ?? mother.name.split(' ').slice(-1)[0] ?? 'Born';
  const givenNames = [
    'Ada', 'Brin', 'Cora', 'Dane', 'Elm', 'Frey', 'Gil', 'Hale', 'Ivy', 'Joss',
    'Kell', 'Lark', 'Mira', 'Nell', 'Orin', 'Pell', 'Quin', 'Rue', 'Silo', 'Tess',
  ];
  const given = rng.pick(givenNames) ?? 'Ada';
  const traits: Record<string, number> = {};
  const keys = Object.keys(mother.traits);
  for (const key of keys) {
    const a = mother.traits[key] ?? 50;
    const b = father?.traits[key] ?? 50;
    const midpoint = Math.floor((a + b) / 2);
    traits[key] = Math.max(0, Math.min(100, midpoint + rng.int(-12, 12)));
  }
  const child: Resident = {
    id,
    name: `${given} ${surname}`,
    sex: rng.chanceBps(5_000) ? 'male' : 'female',
    bornDay: ctx.day,
    origin: 'born',
    status: 'living',
    deathDay: null,
    deathCause: null,
    householdId: mother.householdId,
    partnerId: null,
    motherId: mother.id,
    fatherId: father?.id ?? null,
    guardianId: null,
    traits,
    skills: {},
    healthState: 'healthy',
    health: { wellbeing: 60 },
    hungerDays: 0,
    educationDays: 0,
    legacyOf: pregnancyId,
    emigratedDay: null,
    destination: null,
    rngSalt: rng.nextUint32(),
  };
  ctx.state.residents.set(id, child);
  ctx.state.accounts.set(`resident:${id}`, { ownerType: 'resident', ownerId: id, balanceCents: 0 });
  // Canonical relationship key: a custom in-memory key would be renormalised by `loadState`, making
  // the live state diverge from its own committed hash.
  const parentKey = relationshipKey(mother.id, id, 'friend');
  ctx.state.relationships.set(parentKey, {
    key: parentKey,
    aId: mother.id,
    bId: id,
    kind: 'friend',
    trust: 90,
    intimacy: 80,
    publicBelief: 90,
    sinceDay: ctx.day,
    untilDay: null,
    cooldownUntil: null,
  });
  return child;
}

function openEstateFor(ctx: TurnContext, resident: Resident): void {
  settleEstate(ctx, resident.id);
}

export { isAdult };
