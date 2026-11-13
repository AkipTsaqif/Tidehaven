import type { TurnContext } from '../turn-context.js';
import { nextId, quantityOf, type Building, type Business, type Good } from '../state.js';
import { balanceOf } from '../state.js';
import { addInjury, startOutbreak } from './health.js';
import { householdMembers } from '../society/households.js';

/**
 * Hazards: weather, disasters, and the response to them.
 *
 * A hazard opportunity is rolled from versioned rules; when it fires it damages *specific* assets
 * within an envelope, may injure specific residents, and always has a relief/rebuilding stage that
 * closes it. No hazard fabricates deaths to hit a target.
 */

export interface HazardReport {
  occurred: { kind: string; severity: number; buildingId: number | null }[];
  opportunities: number;
}

export interface ResponseReport {
  reliefSpentCents: number;
  healed: number;
  closed: number;
}

const BASE_HAZARDS: { kind: 'storm' | 'flood' | 'fire' | 'drought' | 'outbreak'; ppm: number }[] = [
  { kind: 'storm', ppm: 60 },
  { kind: 'flood', ppm: 20 },
  { kind: 'fire', ppm: 40 },
  { kind: 'drought', ppm: 15 },
  { kind: 'outbreak', ppm: 25 },
];

const DRAMA_MULTIPLIER_BPS: Record<string, number> = { calm: 5_000, dramatic: 10_000, volatile: 20_000 };

export function hazardPhase(ctx: TurnContext): HazardReport {
  const report: HazardReport = { occurred: [], opportunities: 0 };
  const multiplier = DRAMA_MULTIPLIER_BPS[ctx.state.drama] ?? 10_000;
  // Seasonal factor: storms and floods are more likely in the wet half of the year.
  const dayOfYear = ctx.day % ctx.scenario.calendar.daysPerYear;
  const wet = dayOfYear > 150 && dayOfYear < 300;

  for (const hazard of BASE_HAZARDS) {
    let ppm = hazard.ppm;
    if (hazard.kind === 'storm' || hazard.kind === 'flood') ppm = wet ? ppm * 2 : Math.floor(ppm / 2);
    if (hazard.kind === 'drought') ppm = wet ? Math.floor(ppm / 2) : ppm * 2;
    ppm = Math.floor((ppm * multiplier) / 10_000);
    report.opportunities += 1;
    const rng = ctx.rngFor(hazard.kind, 'opportunity');
    if (!rng.chancePpm(ppm)) continue;
    const severity = rng.int(1, 3);
    if (hazard.kind === 'outbreak') {
      startOutbreak(ctx, severity);
      report.occurred.push({ kind: hazard.kind, severity, buildingId: null });
      continue;
    }
    const buildingId = applyHazard(ctx, hazard.kind, severity, rng);
    report.occurred.push({ kind: hazard.kind, severity, buildingId });
  }
  return report;
}

function applyHazard(
  ctx: TurnContext,
  kind: 'storm' | 'flood' | 'fire' | 'drought',
  severity: number,
  rng: ReturnType<TurnContext['rngFor']>,
): number | null {
  const buildings = [...ctx.state.buildings.values()].filter((b) => b.destroyedDay === null);
  const target = rng.pick(buildings);
  if (!target) return null;

  const id = nextId(ctx.state, 'disaster');
  const damage: Record<string, number> = {};
  const conditionLoss = Math.min(2_500, 600 * severity);
  target.conditionBps = Math.max(1_000, target.conditionBps - conditionLoss);
  damage.conditionLossBps = conditionLoss;

  // Stock damage within a bounded envelope: never more than 20% of one business's stock.
  const business = [...ctx.state.businesses.values()].find(
    (b) => b.buildingId === target.id && b.status === 'open',
  );
  if (business && (kind === 'storm' || kind === 'fire' || kind === 'flood')) {
    for (const good of ['grain', 'fish', 'bread', 'timber', 'cloth', 'medicine'] as Good[]) {
      const stock = quantityOf(ctx.state, 'business', business.id, good);
      if (stock <= 0) continue;
      const lost = Math.min(stock, Math.floor((stock * 500 * severity) / 10_000));
      if (lost <= 0) continue;
      ctx.shiftGoods({ owner: { type: 'business', id: business.id }, good, delta: -lost, reason: `disaster_${kind}` });
      damage[good] = lost;
    }
  }

  // Injuries route through the health resolver.
  const injured: number[] = [];
  const occupants = [...ctx.state.residents.values()].filter(
    (r) => r.status === 'living' && (r.householdId !== null ? isInBuilding(ctx, r.id, target) : false),
  );
  for (const resident of occupants) {
    if (!rng.chancePpm(1_500 * severity)) continue;
    const injuryId = addInjury({ ctx, residentId: resident.id, kind, severity, days: rng.int(5, 30) });
    // Preserve the causal disaster: relief must only compensate the injury this disaster caused, and
    // only once.
    ctx.state.counters.set(`injuryDisaster:${injuryId}`, id);
    injured.push(resident.id);
  }

  ctx.state.disasters.set(id, {
    id,
    kind,
    day: ctx.day,
    severity,
    buildingId: target.id,
    stage: 'occurred',
    damage: { ...damage, injured: injured.length },
    closedDay: null,
  });

  ctx.emit({
    kind: `disaster_${kind}`,
    actorId: null,
    targetId: target.id,
    locationId: target.id,
    visibility: 'public',
    importance: 70 + severity * 10,
    title: `${labelFor(kind)} struck ${target.name}`,
    detail: { severity, damage, injured },
  });
  return target.id;
}

function isInBuilding(ctx: TurnContext, residentId: number, building: Building): boolean {
  const resident = ctx.state.residents.get(residentId);
  if (!resident || resident.householdId === null) return false;
  const household = ctx.state.households.get(resident.householdId);
  if (household?.buildingId === building.id) return true;
  const business = [...ctx.state.businesses.values()].find((b) => b.buildingId === building.id && b.status === 'open');
  if (!business) return false;
  return [...ctx.state.contracts.values()].some(
    (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === business.id && c.aId === residentId,
  );
}

function labelFor(kind: string): string {
  switch (kind) {
    case 'storm':
      return 'A storm';
    case 'flood':
      return 'A flood';
    case 'fire':
      return 'A fire';
    case 'drought':
      return 'A drought';
    default:
      return 'A disaster';
  }
}

/** Escrow account namespace for disaster relief, disjoint from estate and trust escrow ids. */
const DISASTER_ESCROW_BASE = 2_000_000;
function disasterEscrowId(disasterId: number): number {
  return DISASTER_ESCROW_BASE + disasterId;
}

/** Materials one repair step consumes, and the paid-labour cost of that step. */
const REPAIR_TIMBER_PER_STEP = 1;
const REPAIR_LABOUR_CENTS_PER_STEP = 120;
const REPAIR_BPS_PER_STEP = 800;
const DISASTER_DEADLINE_DAYS = 120;

/**
 * Response: evacuation, funded relief, material repair, and closure.
 *
 * Relief is not a transfer into a void: the treasury funds a per-disaster escrow, the escrow pays
 * immediate care for the injured, and repairing the building consumes real materials (timber from the
 * public store) plus paid labour drawn from the same escrow. If funds or materials are unavailable the
 * building simply does not recover this day — resources genuinely constrain the outcome — and anything
 * unspent at closure returns to the treasury.
 */
export function protectivePhase(ctx: TurnContext, _hazard: HazardReport): ResponseReport {
  const report: ResponseReport = { reliefSpentCents: 0, healed: 0, closed: 0 };
  for (const disaster of ctx.state.disasters.values()) {
    if (disaster.stage === 'closed') continue;
    if (disaster.buildingId === null) {
      disaster.stage = 'closed';
      disaster.closedDay = ctx.day;
      report.closed += 1;
      continue;
    }
    const building = ctx.state.buildings.get(disaster.buildingId);
    if (!building) {
      disaster.stage = 'closed';
      disaster.closedDay = ctx.day;
      continue;
    }

    // Evacuation: an unsafe building is cleared into any household with spare capacity.
    if (building.conditionBps < 3_000) {
      evacuateBuilding(ctx, building.id, disaster.id);
    }

    if (disaster.stage === 'occurred') {
      disaster.stage = 'relief';
      const escrow = disasterEscrowId(disaster.id);
      const relief = Math.min(balanceOf(ctx.state, 'treasury', 0), 200 * disaster.severity);
      if (relief > 0) {
        ctx.transfer({
          from: { type: 'treasury', id: 0 },
          to: { type: 'escrow', id: escrow },
          cents: relief,
          reason: 'disaster_relief',
        });
        report.reliefSpentCents += relief;
        ctx.emit({
          kind: 'relief_spending',
          actorId: null,
          targetId: building.id,
          locationId: building.id,
          visibility: 'public',
          importance: 30,
          title: `Relief funds released for ${building.name}`,
          detail: { cents: relief, escrowId: escrow },
        });
      }
      continue;
    }

    const escrowId = disasterEscrowId(disaster.id);

    if (disaster.stage === 'relief') {
      // Immediate care: compensate the residents injured by this disaster, bounded by the escrow.
      // Only injuries this *specific* disaster caused, and only once each: matching by kind alone let
      // two same-kind disasters pay the same unresolved injury twice from separate escrows.
      const injured = [...ctx.state.injuries.values()]
        .filter((i) => i.resolvedDay === null && ctx.state.counters.get(`injuryDisaster:${i.id}`) === disaster.id)
        .filter((i) => !ctx.state.counters.has(`reliefPaid:${i.id}`))
        .sort((a, b) => a.id - b.id);
      let paid = 0;
      for (const injury of injured) {
        const held = balanceOf(ctx.state, 'escrow', escrowId);
        const amount = Math.min(held, 60 * Math.max(1, injury.severity));
        if (amount <= 0 || injury.residentId === undefined) break;
        ctx.state.counters.set(`reliefPaid:${injury.id}`, disaster.id);
        ctx.transfer({
          from: { type: 'escrow', id: escrowId },
          to: { type: 'resident', id: injury.residentId },
          cents: amount,
          reason: 'disaster_relief_care',
        });
        paid += amount;
        report.healed += 1;
      }
      report.reliefSpentCents += paid;
      disaster.stage = 'rebuilding';
      continue;
    }

    if (disaster.stage === 'rebuilding') {
      // A repair step needs materials and paid labour. Either constraint blocks it.
      const timber = quantityOf(ctx.state, 'treasury', 0, 'timber');
      const escrow = balanceOf(ctx.state, 'escrow', escrowId);
      if (timber < REPAIR_TIMBER_PER_STEP || escrow < REPAIR_LABOUR_CENTS_PER_STEP) {
        const notice = `repairBlocked:${disaster.id}`;
        if ((ctx.state.counters.get(notice) ?? -30) < ctx.day - 10) {
          ctx.state.counters.set(notice, ctx.day);
          ctx.emit({
            kind: 'repair_blocked',
            actorId: null,
            targetId: building.id,
            locationId: building.id,
            visibility: 'public',
            importance: 25,
            title: `Repairs at ${building.name} are waiting on materials and funds`,
            detail: { timber, escrowCents: escrow },
          });
        }
        void notice;
      } else {
        // Pay for the work from the relief escrow into the town yard, then consume the material.
        ctx.transfer({
          from: { type: 'escrow', id: escrowId },
          to: { type: 'treasury', id: 0 },
          cents: REPAIR_LABOUR_CENTS_PER_STEP,
          reason: 'disaster_repair_labour',
        });
        ctx.shiftGoods({
          owner: { type: 'treasury', id: 0 },
          good: 'timber',
          delta: -REPAIR_TIMBER_PER_STEP,
          reason: 'disaster_repair_material',
        });
        report.reliefSpentCents += REPAIR_LABOUR_CENTS_PER_STEP;
        building.conditionBps = Math.min(10_000, building.conditionBps + REPAIR_BPS_PER_STEP);
      }

      const overdue = ctx.day - disaster.day > DISASTER_DEADLINE_DAYS;
      if (building.conditionBps >= 9_000 || overdue) {
        const remaining = balanceOf(ctx.state, 'escrow', escrowId);
        if (remaining > 0) {
          ctx.transfer({
            from: { type: 'escrow', id: escrowId },
            to: { type: 'treasury', id: 0 },
            cents: remaining,
            reason: 'disaster_relief_refund',
          });
        }
        disaster.stage = 'closed';
        disaster.closedDay = ctx.day;
        report.closed += 1;
        ctx.emit({
          kind: overdue ? 'disaster_closed_after_deadline' : 'disaster_recovered',
          actorId: null,
          targetId: building.id,
          locationId: building.id,
          visibility: 'public',
          importance: 40,
          title: overdue ? `${building.name} was abandoned to its damage` : `${building.name} was rebuilt`,
          detail: { conditionBps: building.conditionBps, overdue },
        });
      }
    }
  }
  return report;
}

/** Move residents out of an unsafe building into available housing, once per disaster. */
function evacuateBuilding(ctx: TurnContext, buildingId: number, disasterId: number): void {
  const key = `evacuated:${disasterId}`;
  if (ctx.state.counters.has(key)) return;
  const households = [...ctx.state.households.values()]
    .filter((h) => h.buildingId === buildingId && h.dissolvedDay === null)
    .sort((a, b) => a.id - b.id);
  const displaced: number[] = [];
  for (const household of households) {
    for (const resident of householdMembers(ctx, household.id)) {
      const destination = [...ctx.state.households.values()]
        .filter((h) => h.dissolvedDay === null && h.id !== household.id)
        .filter((h) => householdMembers(ctx, h.id).length < h.capacity)
        .sort((a, b) => a.id - b.id)[0];
      if (!destination) continue;
      resident.householdId = destination.id;
      displaced.push(resident.id);
    }
  }
  ctx.state.counters.set(key, ctx.day);
  if (displaced.length > 0) {
    ctx.emit({
      kind: 'residents_evacuated',
      actorId: null,
      targetId: buildingId,
      locationId: buildingId,
      visibility: 'public',
      importance: 55,
      title: `Residents were evacuated from an unsafe building`,
      detail: { buildingId, residents: displaced },
    });
  }
}

/** Utility used by founding rules: is the premises usable? */
export function buildingUsable(ctx: TurnContext, business: Business): boolean {
  if (business.buildingId === null) return false;
  const building = ctx.state.buildings.get(business.buildingId);
  return building !== undefined && building.destroyedDay === null && building.conditionBps >= 3_000;
}
