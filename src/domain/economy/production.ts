import type { ActorPlan } from '../../contracts/actions.js';
import type { TurnContext } from '../turn-context.js';
import { balanceOf, nextId, type Business, type Good, type Resident } from '../state.js';
import { availableOf, quantityOf } from '../state.js';
import { payWage, wagesDue, sectorTotal } from './ledger.js';
import { collectWorkers, hireWorker, strikeActive, type WorkerAssignment } from './employment.js';
import { markBusinessInsolvent } from './businesses.js';
import { activeEmploymentByBusiness, activeEmploymentByResident } from '../lookups.js';

/**
 * Production. Labour (lp) + inputs -> outputs, using scenario recipes. Models cannot change recipes
 * or set output directly; they can only influence how much labour they personally supply.
 */

export interface ProductionReport {
  businessId: number;
  kind: string;
  /** Labour supplied by staff, in labour points. */
  labourPoints: number;
  /** Labour actually applied after premises condition, tools, strikes, and input limits. */
  appliedLabour: number;
  /** Whole-batch equivalent of the applied labour (for reporting; output is prorated). */
  batches: number;
  blockedReason: string | null;
  produced: Partial<Record<Good, number>>;
  consumed: Partial<Record<Good, number>>;
  wagesPaidCents: number;
  wageArrearsCents: number;
  levyBaseCents: number;
}

export interface ProductionOutcome {
  reports: ProductionReport[];
  totalWagesPaidCents: number;
  totalArrearsCents: number;
  workersByBusiness: Map<number, WorkerAssignment[]>;
}

export function runProduction(ctx: TurnContext, plans: Map<number, ActorPlan>): ProductionOutcome {
  ctx.setPhase('produce');
  layoffs(ctx);
  autoHire(ctx);
  const workersByBusiness = collectWorkers(ctx, plans);
  const reports: ProductionReport[] = [];
  let totalWagesPaidCents = 0;
  let totalArrearsCents = 0;

  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    const workers = workersByBusiness.get(business.id) ?? [];
    const recipe = ctx.scenario.economy.recipes[business.kind];
    if (!recipe) continue;

    const building = business.buildingId === null ? null : ctx.state.buildings.get(business.buildingId);
    const conditionBps = building?.conditionBps ?? 10_000;
    let labour = workers.reduce((sum, w) => sum + w.labourPoints, 0);
    if (strikeActive(ctx, business.id)) labour = Math.floor(labour / 2);
    labour = Math.floor((labour * conditionBps) / 10_000);

    // Tool wear: without a tool the workshop loses effectiveness; wear is accrued per worker-day.
    const wearKey = `toolWear:${business.id}`;
    const wearPerDay = Math.floor(labour / 100);
    let effectiveLabour = labour;
    if (labour > 0 && quantityOf(ctx.state, 'business', business.id, 'tools') === 0) {
      effectiveLabour = Math.floor((labour * 90) / 100);
    }

    // Integer prorating, exactly as documented in docs/RULES.md: output is
    //   floor(appliedLabour * outputPerBatch / labourPerBatch)
    // with the remainder lost, and inputs consumed in the same proportion. Partial labour therefore
    // still produces partial output (an elder's 50 lp on an 8-per-100 farm yields 4 grain) instead of
    // being rounded down to nothing.
    let appliedLabour = effectiveLabour;
    let blockedReason: string | null = null;

    for (const [good, perBatch] of Object.entries(recipe.inputs ?? {})) {
      if (perBatch <= 0) continue;
      const available = availableOf(ctx.state, 'business', business.id, good as Good);
      const maxLabour = Math.floor((available * recipe.labourPerBatch) / perBatch);
      if (maxLabour < appliedLabour) {
        appliedLabour = Math.max(0, maxLabour);
        blockedReason = `insufficient_${good}`;
      }
    }

    const produced: Partial<Record<Good, number>> = {};
    const consumed: Partial<Record<Good, number>> = {};

    const outputAmounts = Object.entries(recipe.outputs ?? {}).map(
      ([good, perBatch]) =>
        [good as Good, perBatch > 0 ? Math.floor((appliedLabour * perBatch) / recipe.labourPerBatch) : 0] as const,
    );
    const hasOutputs = Object.keys(recipe.outputs ?? {}).length > 0;
    const producesAnything = outputAmounts.some(([, amount]) => amount > 0);
    if (hasOutputs && appliedLabour > 0 && !producesAnything) {
      blockedReason ??= 'no_labour';
    }

    if (appliedLabour > 0 && (!hasOutputs || producesAnything)) {
      for (const [good, perBatch] of Object.entries(recipe.inputs ?? {})) {
        if (perBatch <= 0) continue;
        // `appliedLabour` was capped so this never exceeds what is available.
        const amount = Math.floor((appliedLabour * perBatch) / recipe.labourPerBatch);
        if (amount <= 0) continue;
        ctx.shiftGoods({
          owner: { type: 'business', id: business.id },
          good: good as Good,
          delta: -amount,
          reason: `production_input:${business.kind}`,
        });
        consumed[good as Good] = amount;
      }
      for (const [good, amount] of outputAmounts) {
        if (amount <= 0) continue;
        ctx.shiftGoods({
          owner: { type: 'business', id: business.id },
          good,
          delta: amount,
          reason: `production_output:${business.kind}`,
        });
        produced[good] = amount;
      }
    }

    // Report the whole-batch equivalent for continuity, plus the labour actually applied.
    const batches = Math.floor(appliedLabour / recipe.labourPerBatch);

    if (wearPerDay > 0) {
      const worn = (ctx.state.counters.get(wearKey) ?? 0) + wearPerDay;
      if (worn >= ctx.scenario.economy.toolWearWorkerDays) {
        const tools = quantityOf(ctx.state, 'business', business.id, 'tools');
        if (tools > 0) {
          ctx.shiftGoods({
            owner: { type: 'business', id: business.id },
            good: 'tools',
            delta: -1,
            reason: 'tool_wear',
          });
          ctx.state.counters.set(wearKey, worn - ctx.scenario.economy.toolWearWorkerDays);
        } else {
          ctx.state.counters.set(wearKey, ctx.scenario.economy.toolWearWorkerDays);
        }
      } else {
        ctx.state.counters.set(wearKey, worn);
      }
    }

    // Wages.
    let wagesPaidCents = 0;
    let wageArrearsCents = 0;
    for (const worker of workers) {
      const gross = wagesDue(ctx, worker.wageCents, worker.labourPoints);
      if (gross <= 0) continue;
      const payerIsTown = business.ownerType === 'town';
      const payerType = payerIsTown ? 'treasury' : 'business';
      const payerId = payerIsTown ? 0 : business.id;
      if (balanceOf(ctx.state, payerType, payerId) < gross && payerIsTown) {
        payPublicPayroll(ctx, worker, gross);
        continue;
      }
      const paid = payWage({
        ctx,
        fromOwner: payerType,
        fromId: payerId,
        workerId: worker.resident.id,
        grossCents: gross,
        reason: `wage:${business.kind}`,
      });
      wagesPaidCents += paid.paidCents;
      wageArrearsCents += paid.arrearsCents;
      if (paid.arrearsCents > 0) {
        // Recorded obligation of the business to the worker; consulted when their estate settles.
        const key = `wageArrears:${worker.resident.id}`;
        ctx.state.counters.set(key, (ctx.state.counters.get(key) ?? 0) + paid.arrearsCents);
      }
      if (paid.paidCents > 0) {
        worker.resident.skills[business.kind] = (worker.resident.skills[business.kind] ?? 0) + ctx.scenario.economy.skillsPerWorkDay;
      }
    }

    if (wageArrearsCents > 0) {
      markBusinessInsolvent(ctx, business.id, wageArrearsCents);
      ctx.emit({
        kind: 'wage_arrears',
        actorId: business.ownerId,
        targetId: business.id,
        visibility: 'public',
        importance: 40,
        title: `${business.name} cannot pay all wages`,
        detail: { arrearsCents: wageArrearsCents },
      });
      addGrievance(ctx, business.id, 'unpaid_wages', wageArrearsCents);
    }

    reports.push({
      businessId: business.id,
      kind: business.kind,
      labourPoints: labour,
      appliedLabour,
      batches,
      blockedReason,
      produced,
      consumed,
      wagesPaidCents,
      wageArrearsCents,
      levyBaseCents: 0,
    });
    totalWagesPaidCents += wagesPaidCents;
    totalArrearsCents += wageArrearsCents;

    if (blockedReason !== null && labour > 0) {
      const throttleKey = `blockedNotice:${business.id}`;
      if ((ctx.state.counters.get(throttleKey) ?? 0) < ctx.day - 6) {
        ctx.state.counters.set(throttleKey, ctx.day);
        ctx.emit({
          kind: 'production_blocked',
          actorId: business.managerId,
          targetId: business.id,
          visibility: 'public',
          importance: 20,
          title: `${business.name} cannot work at full capacity (${blockedReason})`,
          detail: { blockedReason, labourPoints: labour },
        });
      }
    }
  }

  return { reports, totalWagesPaidCents, totalArrearsCents, workersByBusiness };
}

/**
 * Hiring rule. Businesses with unused premises capacity and enough cash take on one unemployed adult
 * per day (most diligent first, id as the tie-break). This is what makes `seek_work` meaningful and
 * keeps production staffed after a death, retirement, or immigration wave.
 */
/**
 * Layoffs. A business whose rolling revenue cannot cover a third of its wage bill, and whose cash is
 * below a day of payroll, releases its most recently hired worker instead of letting the owner
 * household fund permanent losses. The released worker joins the hiring pool next day.
 */
export function layoffs(ctx: TurnContext): void {
  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    // Public services are not profit-driven: their staffing is a civic decision, not a market one.
    if (business.ownerType === 'town') continue;
    const contracts = [...ctx.state.contracts.values()]
      .filter(
        (c) =>
          c.kind === 'employment' &&
          c.status === 'active' &&
          c.businessId === business.id &&
          ctx.state.residents.get(c.aId)?.status === 'living',
      )
      .sort((a, b) => b.startDay - a.startDay || b.aId - a.aId);
    if (contracts.length <= 1) continue;
    const wageBill = contracts.reduce(
      (sum, contract) => sum + (typeof contract.terms.wageCents === 'number' ? contract.terms.wageCents : 300),
      0,
    );
    const revenue = ctx.state.counters.get(`revenue:${business.id}`) ?? 0;
    const cash = ctx.state.accounts.get(`business:${business.id}`)?.balanceCents ?? 0;
    if (revenue * 3 >= wageBill) continue;
    if (cash >= wageBill) continue;
    const victim = contracts[0];
    if (!victim) continue;
    victim.status = 'ended';
    victim.endDay = ctx.day;
    ctx.emit({
      kind: 'layoff',
      actorId: victim.aId,
      targetId: business.id,
      visibility: 'public',
      importance: 35,
      title: `${ctx.state.residents.get(victim.aId)?.name ?? 'A worker'} was laid off at ${business.name}`,
      detail: { reason: 'no_demand', rollingRevenueCents: revenue, wageBillCents: wageBill },
    });
  }
}

export function autoHire(ctx: TurnContext): void {
  // Snapshots taken before any hire: the candidate list is computed once, as before, and per-business
  // staff counts re-check each contract's live status, so a contract ended earlier in this loop (labour
  // reallocation) is excluded exactly as a fresh scan would exclude it.
  const employed = activeEmploymentByResident(ctx.state, ctx.day);
  const staffByBusiness = activeEmploymentByBusiness(ctx.state);
  const unemployed = [...ctx.state.residents.values()]
    .filter((r) => r.status === 'living')
    .filter((r) => r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays)
    .filter((r) => !employed.has(r.id))
    .sort((a, b) => (b.traits.diligence ?? 0) - (a.traits.diligence ?? 0) || a.id - b.id);
  if (unemployed.length === 0) return;

  // At most one hire per business per day; staffing follows observed demand, not ambition.
  for (const business of ctx.state.businesses.values()) {
    if (business.status !== 'open') continue;
    if (unemployed.length === 0) break;
    const building = business.buildingId === null ? null : ctx.state.buildings.get(business.buildingId);
    const capacity = Math.max(1, building?.capacity ?? 2);
    // Only this business's own iteration can add a contract for it, and that happens after this count.
    const staff = (staffByBusiness.get(business.id) ?? []).filter(
      (c) =>
        c.status === 'active' &&
        // A dead or departed worker supplies no labour and must not hold a staffing slot.
        ctx.state.residents.get(c.aId)?.status === 'living',
    ).length;
    if (staff >= capacity) continue;
    const recipe = ctx.scenario.economy.recipes[business.kind];
    if (!recipe) continue;
    const wageClass = (recipe.wageClass ?? 'unskilled') as 'unskilled' | 'skilled' | 'official';
    const wageCents = ctx.scenario.economy.wages[wageClass];

    // Demand test: hire when the market reported unmet demand for something this business makes.
    const outputs = Object.keys(recipe.outputs ?? {});
    const shortage = outputs.reduce(
      (sum, good) => sum + (ctx.state.counters.get(`shortage:${good}`) ?? 0),
      0,
    );
    const revenue = ctx.state.counters.get(`revenue:${business.id}`) ?? 0;
    if (shortage <= 0 && revenue < wageCents * 3) continue;

    const payer = business.ownerType === 'town' ? 'treasury' : 'business';
    const payerId = business.ownerType === 'town' ? 0 : business.id;
    if (balanceOf(ctx.state, payer, payerId) < wageCents * 5) continue;

    let candidate = unemployed.shift();
    if (!candidate) {
      // Labour reallocation: if a food business is short but every adult already has a job, it may take
      // one worker from a non-food business whose own output is not short. Food security comes first.
      candidate = poachableWorker(ctx, business.id) ?? undefined;
      if (!candidate) break;
    }
    if (ctx.scenario.growth) {
      const hired = hireWorker({ ctx, businessId: business.id, residentId: candidate.id, wageCents });
      if (!hired.ok) unemployed.unshift(candidate);
      continue;
    }
    const id = nextId(ctx.state, 'contract');
    ctx.state.contracts.set(id, {
      id,
      kind: 'employment',
      aId: candidate.id,
      bId: business.id,
      businessId: business.id,
      terms: { wageClass, wageCents },
      startDay: ctx.day,
      endDay: null,
      status: 'active',
    });
    ctx.emit({
      kind: 'employment_started',
      actorId: candidate.id,
      targetId: business.id,
      visibility: 'public',
      importance: 20,
      title: `${candidate.name} was taken on at ${business.name}`,
      detail: { wageCents, wageClass, rollingRevenueCents: revenue },
    });
  }
}

const ESSENTIAL_KINDS = new Set(['farm', 'fishery', 'bakery']);

/** Find a worker the town can move into essential food production without creating another shortage. */
function poachableWorker(ctx: TurnContext, targetBusinessId: number): Resident | null {
  const target = ctx.state.businesses.get(targetBusinessId);
  if (!target || !ESSENTIAL_KINDS.has(target.kind)) return null;
  const candidates: { resident: Resident; business: Business; startDay: number }[] = [];
  for (const contract of ctx.state.contracts.values()) {
    if (contract.kind !== 'employment' || contract.status !== 'active') continue;
    if (contract.businessId === null || contract.businessId === targetBusinessId) continue;
    const business = ctx.state.businesses.get(contract.businessId);
    if (!business || business.status !== 'open') continue;
    if (ESSENTIAL_KINDS.has(business.kind)) continue;
    const recipe = ctx.scenario.economy.recipes[business.kind];
    if (!recipe) continue;
    const shortHere = Object.keys(recipe.outputs ?? {}).reduce(
      (sum, good) => sum + (ctx.state.counters.get(`shortage:${good}`) ?? 0),
      0,
    );
    if (shortHere > 0) continue;
    const resident = ctx.state.residents.get(contract.aId);
    if (!resident || resident.status !== 'living') continue;
    candidates.push({ resident, business, startDay: contract.startDay });
  }
  candidates.sort((a, b) => a.startDay - b.startDay || a.resident.id - b.resident.id);
  const chosen = candidates[0];
  if (!chosen) return null;
  for (const contract of ctx.state.contracts.values()) {
    if (contract.kind !== 'employment' || contract.status !== 'active') continue;
    if (contract.aId !== chosen.resident.id) continue;
    contract.status = 'ended';
    contract.endDay = ctx.day;
  }
  ctx.emit({
    kind: 'labour_reallocated',
    actorId: chosen.resident.id,
    targetId: targetBusinessId,
    visibility: 'public',
    importance: 25,
    title: `${chosen.resident.name} moved from ${chosen.business.name} to food work`,
    detail: { fromBusinessId: chosen.business.id },
  });
  return chosen.resident;
}

/**
 * Town services are paid from the treasury, capped at 40% of the treasury per day so public payroll
 * can never drain the treasury in a single day.
 */
function payPublicPayroll(ctx: TurnContext, worker: WorkerAssignment, grossCents: number): void {
  const capKey = `publicPayroll:${ctx.day}`;
  const spent = ctx.state.counters.get(capKey) ?? 0;
  const cap = Math.floor(balanceOf(ctx.state, 'treasury', 0) * 0.4) - spent;
  const payable = Math.max(0, Math.min(grossCents, balanceOf(ctx.state, 'treasury', 0), cap));
  if (payable <= 0) {
    addGrievance(ctx, worker.business.id, 'unpaid_wages', grossCents);
    return;
  }
  const paid = payWage({
    ctx,
    fromOwner: 'treasury',
    fromId: 0,
    workerId: worker.resident.id,
    grossCents: payable,
    reason: `public_wage:${worker.business.kind}`,
  });
  ctx.state.counters.set(capKey, spent + paid.paidCents);
  worker.resident.skills[worker.business.kind] =
    (worker.resident.skills[worker.business.kind] ?? 0) + ctx.scenario.economy.skillsPerWorkDay;
}

export function addGrievance(ctx: TurnContext, subjectId: number, kind: string, weight: number): void {
  const residentIds = [...ctx.state.residents.values()]
    .filter((r) => r.status === 'living' && r.id !== subjectId)
    .slice(0, 0);
  void residentIds;
  // Grievances are attached to specific residents by the conflict/labour modules; here we only bump
  // the town-wide counter used by the unrest thresholds.
  ctx.state.counters.set(`grievanceWeight:${kind}`, (ctx.state.counters.get(`grievanceWeight:${kind}`) ?? 0) + weight);
}

export function totalTreasury(ctx: TurnContext): number {
  return sectorTotal(ctx, 'treasury');
}

export function businessCash(ctx: TurnContext, business: Business): number {
  return balanceOf(ctx.state, 'business', business.id);
}
