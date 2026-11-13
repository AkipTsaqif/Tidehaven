import type { TurnContext } from '../turn-context.js';
import { nextId, quantityOf, type Resident } from '../state.js';
import { householdMembers } from '../society/households.js';

/**
 * Public health. Transmission, treatment, injury, recovery, and death all resolve here.
 *
 * Death is only ever produced by the mortality resolver below (natural, age/condition weighted) or by
 * a validated injury/attack that routes through it with a raised multiplier. A model can attempt harm;
 * it can never set a resident dead.
 */

export interface HealthReport {
  activeCases: number;
  newCases: number;
  treated: number;
  deaths: number;
  injuriesHealing: number;
  injuryDeaths: number;
}

const AGE_HAZARD_PPM = {
  child: 40,
  adult: 60,
  elder: 800,
  veryOld: 3_000,
};

export function healthPhase(ctx: TurnContext): HealthReport {
  const report: HealthReport = {
    activeCases: 0,
    newCases: 0,
    treated: 0,
    deaths: 0,
    injuriesHealing: 0,
    injuryDeaths: 0,
  };

  let clinicCapacity = clinicTreatmentCapacity(ctx);
  let medicineStock = totalMedicine(ctx);

  // ---------------------------------------------------------------- transmission
  const infectious = [...ctx.state.healthCases.values()].filter(
    (c) => c.state === 'infectious' && c.resolvedDay === null,
  );
  for (const carrier of infectious) {
    const patient = ctx.state.residents.get(carrier.residentId);
    if (!patient || patient.status !== 'living') continue;
    const contacts = contactResidents(ctx, patient);
    for (const contact of contacts) {
      if (contact.status !== 'living') continue;
      if (hasActiveCase(ctx, contact.id)) continue;
      const rng = ctx.rngFor(contact.id, `transmission:${carrier.id}`);
      const ppm = Math.min(60_000, 4_000 * Math.max(1, contacts.length) + carrier.severity * 500);
      if (!rng.chancePpm(ppm)) continue;
      const id = nextId(ctx.state, 'healthCase');
      ctx.state.healthCases.set(id, {
        id,
        residentId: contact.id,
        disease: carrier.disease,
        state: 'exposed',
        severity: carrier.severity,
        sinceDay: ctx.day,
        infectiousUntil: null,
        treatedDays: 0,
        resolvedDay: null,
        outcome: null,
      });
      contact.healthState = 'exposed';
      report.newCases += 1;
      ctx.emit({
        kind: 'illness_exposed',
        actorId: contact.id,
        targetId: carrier.residentId,
        visibility: 'private',
        importance: 30,
        title: `${contact.name} fell ill`,
        detail: { disease: carrier.disease },
      });
    }
  }

  // ---------------------------------------------------------------- progression + treatment
  for (const healthCase of ctx.state.healthCases.values()) {
    if (healthCase.resolvedDay !== null) continue;
    const patient = ctx.state.residents.get(healthCase.residentId);
    if (!patient || patient.status !== 'living') {
      healthCase.resolvedDay = ctx.day;
      healthCase.outcome = 'patient_gone';
      continue;
    }
    const rng = ctx.rngFor(healthCase.residentId, `case:${healthCase.id}`);

    if (healthCase.state === 'exposed') {
      if (ctx.day - healthCase.sinceDay >= 2) {
        healthCase.state = 'infectious';
        healthCase.infectiousUntil = ctx.day + rng.int(7, 14);
        patient.healthState = 'infectious';
      }
    } else if (healthCase.state === 'infectious') {
      // Treatment consumes one medicine per three treated days and a clinic slot.
      if (medicineStock > 0 && clinicCapacity > 0) {
        healthCase.treatedDays += 1;
        clinicCapacity -= 1;
        chargeClinicFee(ctx, patient);
        if (healthCase.treatedDays % 3 === 0) {
          consumeMedicine(ctx);
          medicineStock -= 1;
        }
        report.treated += 1;
      }
      if (healthCase.infectiousUntil !== null && ctx.day >= healthCase.infectiousUntil) {
        healthCase.state = 'recovering';
        patient.healthState = 'recovering';
      }
    } else if (healthCase.state === 'recovering') {
      const recoveryDays = healthCase.treatedDays > 0 ? 3 : 5;
      const sinceRecovering = ctx.day - (healthCase.infectiousUntil ?? healthCase.sinceDay);
      if (sinceRecovering >= recoveryDays) {
        healthCase.state = 'recovered';
        healthCase.resolvedDay = ctx.day;
        healthCase.outcome = 'recovered';
        patient.healthState = patient.healthState === 'recovering' ? 'healthy' : patient.healthState;
      }
    }
    if (healthCase.state !== 'recovered') report.activeCases += 1;
  }

  // ---------------------------------------------------------------- injuries
  for (const injury of ctx.state.injuries.values()) {
    if (injury.resolvedDay !== null) continue;
    if (injury.untilDay !== null && ctx.day >= injury.untilDay) {
      injury.resolvedDay = ctx.day;
      report.injuriesHealing += 1;
      const patient = ctx.state.residents.get(injury.residentId);
      if (patient && patient.healthState === 'injured') {
        patient.healthState = injury.disability > 0 ? 'disabled' : 'healthy';
      }
    }
  }

  // ---------------------------------------------------------------- mortality
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    const hazard = mortalityHazardPpm(ctx, resident);
    const rng = ctx.rngFor(resident.id, 'mortality');
    if (!rng.chancePpm(hazard)) continue;
    const cause = deathCauseFor(ctx, resident);
    killResident(ctx, resident, cause);
    report.deaths += 1;
    if (cause.startsWith('injury')) report.injuryDeaths += 1;
  }

  // Hunger pressure degrades health without instantly killing.
  for (const resident of ctx.state.residents.values()) {
    if (resident.status !== 'living') continue;
    if (resident.hungerDays >= 3 && resident.healthState === 'healthy') {
      resident.healthState = 'recovering';
      resident.health = { ...resident.health, wellbeing: Math.max(0, (resident.health.wellbeing ?? 60) - 5) };
    }
    if (resident.hungerDays === 0 && resident.healthState === 'recovering' && !hasActiveCase(ctx, resident.id)) {
      resident.healthState = 'healthy';
    }
  }

  return report;
}

export function mortalityHazardPpm(ctx: TurnContext, resident: Resident): number {
  const age = ctx.day - resident.bornDay;
  const calendar = ctx.scenario.calendar;
  let band: keyof typeof AGE_HAZARD_PPM;
  if (age < calendar.adultDays) band = 'child';
  else if (age < calendar.elderDays) band = 'adult';
  else if (age < calendar.elderDays + calendar.daysPerYear * 15) band = 'elder';
  else band = 'veryOld';
  let hazard = AGE_HAZARD_PPM[band];

  if (resident.healthState === 'infectious') hazard *= 2;
  if (resident.healthState === 'injured') hazard *= 2;
  if (resident.healthState === 'disabled') hazard *= 2;
  if (resident.healthState === 'recovering') hazard = Math.floor(hazard * 1.5);
  if (resident.hungerDays >= 3) hazard *= 2;

  const seriousCase = [...ctx.state.healthCases.values()].find(
    (c) => c.residentId === resident.id && c.resolvedDay === null && c.treatedDays === 0 && c.state === 'infectious',
  );
  if (seriousCase) hazard *= 3;

  const openInjury = [...ctx.state.injuries.values()].some(
    (i) => i.residentId === resident.id && i.resolvedDay === null && i.severity >= 2,
  );
  if (openInjury) hazard = Math.floor(hazard * 1.5);

  return Math.max(0, Math.min(200_000, Math.floor(hazard)));
}

function deathCauseFor(ctx: TurnContext, resident: Resident): string {
  const openInjury = [...ctx.state.injuries.values()].find(
    (i) => i.residentId === resident.id && i.resolvedDay === null && i.severity >= 2,
  );
  if (openInjury) return `injury:${openInjury.kind}`;
  const activeCase = [...ctx.state.healthCases.values()].find(
    (c) => c.residentId === resident.id && c.resolvedDay === null && c.state !== 'recovered',
  );
  if (activeCase) return `illness:${activeCase.disease}`;
  if (resident.hungerDays >= 3) return 'hunger';
  return 'natural';
}

export function killResident(ctx: TurnContext, resident: Resident, cause: string): void {
  resident.status = 'dead';
  resident.deathDay = ctx.day;
  resident.deathCause = cause;
  resident.healthState = 'dead';
  if (resident.partnerId !== null) {
    const partner = ctx.state.residents.get(resident.partnerId);
    if (partner) {
      const grievanceId = nextId(ctx.state, 'grievance');
      ctx.state.grievances.set(grievanceId, {
        id: grievanceId,
        residentId: partner.id,
        kind: 'bereavement',
        severity: 35,
        sinceDay: ctx.day,
        untilDay: ctx.day + 180,
        reason: `${resident.name} died`,
      });
      ctx.remember(partner.id, 'grief', `${resident.name} died on day ${ctx.day}.`, 95, []);
    }
  }
  ctx.emit({
    kind: 'death',
    actorId: resident.id,
    targetId: null,
    visibility: 'public',
    importance: 90,
    title: `${resident.name} died (${cause})`,
    detail: { cause, ageDays: ctx.day - resident.bornDay },
  });
}

export function addInjury(params: {
  ctx: TurnContext;
  residentId: number;
  kind: string;
  severity: number;
  days: number;
  eventId?: number | null;
}): number {
  const { ctx, residentId, kind, severity, days } = params;
  const id = nextId(ctx.state, 'injury');
  ctx.state.injuries.set(id, {
    id,
    residentId,
    kind,
    severity,
    sinceDay: ctx.day,
    untilDay: ctx.day + days,
    disability: severity >= 3 ? 1 : 0,
    resolvedDay: null,
  });
  const resident = ctx.state.residents.get(residentId);
  if (resident) resident.healthState = 'injured';
  return id;
}

function hasActiveCase(ctx: TurnContext, residentId: number): boolean {
  for (const healthCase of ctx.state.healthCases.values()) {
    if (healthCase.residentId === residentId && healthCase.resolvedDay === null) return true;
  }
  return false;
}

function contactResidents(ctx: TurnContext, patient: Resident): Resident[] {
  const contacts = new Set<number>();
  if (patient.householdId !== null) {
    for (const member of householdMembers(ctx, patient.householdId)) {
      if (member.id !== patient.id) contacts.add(member.id);
    }
  }
  for (const contract of ctx.state.contracts.values()) {
    if (contract.kind !== 'employment' || contract.status !== 'active') continue;
    if (contract.aId !== patient.id || contract.businessId === null) continue;
    for (const other of ctx.state.contracts.values()) {
      if (other.kind !== 'employment' || other.status !== 'active') continue;
      if (other.businessId !== contract.businessId || other.aId === patient.id) continue;
      contacts.add(other.aId);
    }
  }
  const result: Resident[] = [];
  for (const id of contacts) {
    const resident = ctx.state.residents.get(id);
    if (resident) result.push(resident);
  }
  return result.sort((a, b) => a.id - b.id).slice(0, 12);
}

function clinicTreatmentCapacity(ctx: TurnContext): number {
  let capacity = 0;
  for (const business of ctx.state.businesses.values()) {
    if (business.kind !== 'clinic' || business.status !== 'open') continue;
    const workers = [...ctx.state.contracts.values()].filter(
      (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === business.id,
    ).length;
    capacity += Math.max(0, workers) * 4;
  }
  return capacity;
}

/** Treatment is not free: the patient's household pays the clinic, or the treasury covers relief. */
function chargeClinicFee(ctx: TurnContext, patient: Resident): void {
  const fee = 300;
  const clinic = [...ctx.state.businesses.values()].find((b) => b.kind === 'clinic' && b.status === 'open');
  if (!clinic) return;
  const householdId = patient.householdId;
  const householdCash = householdId === null ? 0 : ctx.state.accounts.get(`household:${householdId}`)?.balanceCents ?? 0;
  if (householdId !== null && householdCash >= fee) {
    ctx.transfer({
      from: { type: 'household', id: householdId },
      to: { type: 'business', id: clinic.id },
      cents: fee,
      reason: 'clinic_fee',
    });
    return;
  }
  const residentCash = ctx.state.accounts.get(`resident:${patient.id}`)?.balanceCents ?? 0;
  if (residentCash >= fee) {
    ctx.transfer({
      from: { type: 'resident', id: patient.id },
      to: { type: 'business', id: clinic.id },
      cents: fee,
      reason: 'clinic_fee',
    });
    return;
  }
  const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
  if (treasury >= fee) {
    ctx.transfer({
      from: { type: 'treasury', id: 0 },
      to: { type: 'business', id: clinic.id },
      cents: fee,
      reason: 'clinic_fee_relief',
    });
  }
}

function totalMedicine(ctx: TurnContext): number {
  let total = 0;
  for (const [key, quantity] of ctx.state.inventories.entries()) {
    if (!key.endsWith(':medicine')) continue;
    total += quantity;
  }
  return total;
}

function consumeMedicine(ctx: TurnContext): void {
  for (const [key, quantity] of ctx.state.inventories.entries()) {
    if (!key.endsWith(':medicine') || quantity <= 0) continue;
    const parts = key.split(':');
    ctx.shiftGoods({
      owner: { type: parts[0] as 'treasury', id: Number(parts[1]) },
      good: 'medicine',
      delta: -1,
      reason: 'treatment',
    });
    return;
  }
}

/** Start an outbreak (used by the hazard phase): seed infections in a household or workplace. */
export function startOutbreak(ctx: TurnContext, severity: number): number {
  const candidates = [...ctx.state.residents.values()].filter((r) => r.status === 'living');
  const rng = ctx.rngFor(`outbreak:${ctx.day}`, 'patient-zero');
  const patient = rng.pick(candidates);
  if (!patient) return 0;
  const id = nextId(ctx.state, 'healthCase');
  ctx.state.healthCases.set(id, {
    id,
    residentId: patient.id,
    disease: 'harbour fever',
    state: 'infectious',
    severity: Math.max(1, severity),
    sinceDay: ctx.day,
    infectiousUntil: ctx.day + rng.int(7, 14),
    treatedDays: 0,
    resolvedDay: null,
    outcome: null,
  });
  patient.healthState = 'infectious';
  ctx.emit({
    kind: 'outbreak',
    actorId: patient.id,
    targetId: null,
    visibility: 'public',
    importance: 70,
    title: 'A fever is going around Tidehaven',
    detail: { patientId: patient.id, severity },
  });
  return id;
}

export function medicineInTreasury(ctx: TurnContext): number {
  return quantityOf(ctx.state, 'treasury', 0, 'medicine');
}
