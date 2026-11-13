import type { TurnContext } from '../turn-context.js';
import { nextId, type CaseRecord, type Resident } from '../state.js';
import { balanceOf } from '../state.js';
import { officeHolderFor } from './politics.js';
import { payEstateAward } from '../society/estates.js';

/**
 * Justice: investigation, trial, sentence, and closure.
 *
 * An allegation is not guilt. Investigation accumulates admissible evidence over 3–10 days; the trial
 * weighs prosecution against defence with bounded noise; sentences are fines, restitution, probation,
 * or time-limited imprisonment with jail capacity and automatic release.
 */

export interface JusticeReport {
  investigated: number;
  trials: number;
  convictions: number;
  acquittals: number;
  finesCents: number;
  imprisoned: number;
  released: number;
}

const JAIL_CAPACITY = 3;

export function justicePhase(ctx: TurnContext): JusticeReport {
  const report: JusticeReport = {
    investigated: 0,
    trials: 0,
    convictions: 0,
    acquittals: 0,
    finesCents: 0,
    imprisoned: 0,
    released: 0,
  };

  const magistrate = officeHolderFor(ctx, 'magistrate');
  const courtCapacity = courtCapacityPerDay(ctx);

  for (const caseRecord of ctx.state.cases.values()) {
    if (caseRecord.status === 'closed' || caseRecord.status === 'sentenced') {
      continue;
    }

    if (caseRecord.status === 'investigating') {
      if (courtCapacity.remaining <= 0) continue;
      courtCapacity.remaining -= 1;
      caseRecord.investigationDays += 1;
      caseRecord.prosecutionBps = Math.min(
        10_000,
        caseRecord.prosecutionBps + evidenceWeight(ctx, caseRecord.id),
      );
      caseRecord.defenceBps = Math.min(
        10_000,
        caseRecord.defenceBps + defenceWeight(ctx, caseRecord),
      );
      report.investigated += 1;
      const hearingDays = typeof caseRecord.truth.hearingDays === 'number' ? caseRecord.truth.hearingDays : 3;
      if (caseRecord.investigationDays >= hearingDays) {
        caseRecord.status = 'trial';
      }
      continue;
    }

    if (caseRecord.status === 'trial') {
      if (courtCapacity.remaining <= 0) continue;
      courtCapacity.remaining -= 1;
      report.trials += 1;
      chargeCourtFee(ctx, caseRecord);
      const verdict = decideVerdict(ctx, caseRecord);
      caseRecord.verdict = verdict.kind;
      caseRecord.status = 'sentenced';
      caseRecord.closedDay = ctx.day;
      applyVerdict(ctx, caseRecord, report, magistrate);
    }
  }

  // Release prisoners whose sentence expired (sentence.status set by schedulePhase). The release is a
  // one-time transition recorded on the sentence: a served sentence stays served, so a restart or a
  // later day must not emit a second release event.
  for (const sentence of ctx.state.sentences.values()) {
    if (sentence.kind !== 'imprisonment') continue;
    if (sentence.status !== 'served') continue;
    if (sentence.releasedDay !== null) continue;
    const caseRecord = ctx.state.cases.get(sentence.caseId);
    if (!caseRecord) continue;
    if (!ctx.state.residents.get(caseRecord.defendantId)) continue;
    sentence.releasedDay = ctx.day;
    report.released += 1;
    ctx.emit({
      kind: 'prisoner_released',
      actorId: caseRecord.defendantId,
      targetId: sentence.id,
      visibility: 'public',
      importance: 40,
      title: `${ctx.state.residents.get(caseRecord.defendantId)?.name ?? 'A prisoner'} was released`,
      detail: { sentenceId: sentence.id },
    });
  }

  // Estate disputes: escrowed property stays frozen until the court rules *by its deadline*. A will
  // that disinherits a natural heir cannot simply override them; the court settles the remainder.
  for (const estate of ctx.state.estates.values()) {
    if (estate.status !== 'disputed') continue;
    const deadline = estate.disputeDeadlineDay ?? estate.openedDay;
    if (ctx.day < deadline) continue;
    const claimants = [...ctx.state.estateClaims.values()]
      .filter((c) => c.estateId === estate.id && c.status === 'pending' && c.claimantId !== null)
      .sort((a, b) => a.id - b.id);
    if (estate.escrowCents <= 0 || claimants.length === 0) {
      estate.status = 'closed';
      estate.closedDay = ctx.day;
      continue;
    }
    let distributed = 0;
    for (const claim of claimants) {
      const payable = Math.min(claim.amountCents, Math.max(0, estate.escrowCents - distributed));
      if (payable <= 0) {
        claim.status = 'rejected';
        claim.resolvedDay = ctx.day;
        continue;
      }
      const claimantId = claim.claimantId;
      if (claimantId === null) continue;
      // The disputed award follows the same protected route as ordinary settlement: a minor heir's
      // money goes to their trust, never to a spendable resident account.
      payEstateAward({
        ctx,
        estateId: estate.id,
        claimantId,
        amountCents: payable,
        kind: claim.kind,
      });
      claim.status = 'paid';
      claim.resolvedDay = ctx.day;
      distributed += payable;
    }
    // Whatever the court did not award returns to the town rather than vanishing in escrow.
    const residue = estate.escrowCents - distributed;
    if (residue > 0) {
      ctx.transfer({
        from: { type: 'escrow', id: estate.id },
        to: { type: 'treasury', id: 0 },
        cents: residue,
        reason: 'estate_dispute_residue',
      });
    }
    estate.escrowCents = 0;
    estate.status = 'closed';
    estate.closedDay = ctx.day;
    ctx.emit({
      kind: 'estate_dispute_resolved',
      actorId: null,
      targetId: estate.id,
      visibility: 'public',
      importance: 50,
      title: `The court divided the estate of the deceased`,
      detail: { estateId: estate.id, distributed, residue },
    });
  }

  return report;
}

function courtCapacityPerDay(ctx: TurnContext): { remaining: number } {
  let capacity = 1;
  for (const business of ctx.state.businesses.values()) {
    if (business.kind !== 'court' || business.status !== 'open') continue;
    const workers = [...ctx.state.contracts.values()].filter(
      (c) => c.kind === 'employment' && c.status === 'active' && c.businessId === business.id,
    ).length;
    capacity += workers;
  }
  return { remaining: Math.min(3, capacity) };
}

/** A modest court fee keeps the town hall solvent without making justice unaffordable. */
function chargeCourtFee(ctx: TurnContext, caseRecord: CaseRecord): void {
  const fee = 200;
  const court = [...ctx.state.businesses.values()].find((b) => b.kind === 'court' && b.status === 'open');
  if (!court) return;
  const defendant = ctx.state.residents.get(caseRecord.defendantId);
  const cash = defendant ? ctx.state.accounts.get(`resident:${defendant.id}`)?.balanceCents ?? 0 : 0;
  if (defendant && cash >= fee) {
    ctx.transfer({ from: { type: 'resident', id: defendant.id }, to: { type: 'business', id: court.id }, cents: fee, reason: 'court_fee' });
    return;
  }
  const treasury = ctx.state.accounts.get('treasury:0')?.balanceCents ?? 0;
  if (treasury >= fee) {
    ctx.transfer({ from: { type: 'treasury', id: 0 }, to: { type: 'business', id: court.id }, cents: fee, reason: 'court_fee_relief' });
  }
}

function evidenceWeight(ctx: TurnContext, caseId: number): number {
  let weight = 0;
  for (const item of ctx.state.evidence.values()) {
    if (item.caseId !== caseId) continue;
    if (!item.public) continue; // hidden ground truth is not admissible by itself
    weight += Math.floor(item.weightBps / 4);
  }
  return weight;
}

function defenceWeight(ctx: TurnContext, caseRecord: CaseRecord): number {
  const defendant = ctx.state.residents.get(caseRecord.defendantId);
  if (!defendant) return 0;
  const standing = (defendant.traits.honesty ?? 50) * 10 + (defendant.traits.sociability ?? 50) * 5;
  const already = caseRecord.defenceBps;
  return Math.min(1_200, Math.floor(standing / 10) - Math.floor(already / 40));
}

function decideVerdict(ctx: TurnContext, caseRecord: CaseRecord): { kind: string; strength: number } {
  const rng = ctx.rngFor(caseRecord.id, 'verdict');
  const noise = rng.int(-1_500, 1_500); // ±15%
  const prosecution = caseRecord.prosecutionBps + noise;
  const defence = caseRecord.defenceBps + rng.int(0, 800);
  const strength = prosecution - defence;
  if (caseRecord.prosecutionBps === 0) return { kind: 'dismissal', strength };
  if (strength <= 0) return { kind: 'acquittal', strength };
  if (strength < 2_000) return { kind: 'probation', strength };
  if (strength < 5_000) return { kind: 'fine', strength };
  return { kind: 'imprisonment', strength };
}

function applyVerdict(
  ctx: TurnContext,
  caseRecord: CaseRecord,
  report: JusticeReport,
  magistrate: Resident | null,
): void {
  const defendant = ctx.state.residents.get(caseRecord.defendantId);
  if (!defendant) {
    caseRecord.status = 'closed';
    return;
  }
  const truth = caseRecord.truth;
  const stolenGoods = typeof truth.quantity === 'number' ? truth.quantity : 0;
  const stolenValue = stolenGoods * 100;
  const sentenceId = nextId(ctx.state, 'sentence');

  switch (caseRecord.verdict) {
    case 'acquittal':
    case 'dismissal': {
      report.acquittals += 1;
      ctx.state.sentences.set(sentenceId, {
        id: sentenceId,
        caseId: caseRecord.id,
        kind: caseRecord.verdict === 'acquittal' ? 'acquittal' : 'dismissal',
        amountCents: 0,
        days: 0,
        startDay: ctx.day,
        endDay: ctx.day,
        status: 'served',
        releasedDay: ctx.day,
      });
      ctx.emit({
        kind: `verdict_${caseRecord.verdict}`,
        actorId: defendant.id,
        targetId: caseRecord.id,
        visibility: 'public',
        importance: 55,
        title: `${defendant.name} was ${caseRecord.verdict === 'acquittal' ? 'acquitted' : 'cleared on procedure'}`,
        detail: { caseId: caseRecord.id, prosecutionBps: caseRecord.prosecutionBps, defenceBps: caseRecord.defenceBps },
      });
      break;
    }
    case 'probation': {
      report.convictions += 1;
      const days = 30 + Math.min(150, Math.floor((caseRecord.prosecutionBps - caseRecord.defenceBps) / 40));
      ctx.state.sentences.set(sentenceId, {
        id: sentenceId,
        caseId: caseRecord.id,
        kind: 'probation',
        amountCents: 0,
        days,
        startDay: ctx.day,
        endDay: ctx.day + days,
        status: 'active',
        releasedDay: null,
      });
      ctx.emit({
        kind: 'verdict_probation',
        actorId: defendant.id,
        targetId: caseRecord.id,
        visibility: 'public',
        importance: 50,
        title: `${defendant.name} was placed on probation`,
        detail: { days, caseId: caseRecord.id },
      });
      break;
    }
    case 'fine': {
      report.convictions += 1;
      const fine = Math.min(20_000, Math.max(500, stolenValue > 0 ? stolenValue * 2 : 2_000));
      const paid = Math.min(fine, balanceOf(ctx.state, 'resident', defendant.id));
      if (paid > 0) {
        ctx.transfer({
          from: { type: 'resident', id: defendant.id },
          to: { type: 'treasury', id: 0 },
          cents: paid,
          reason: 'fine',
        });
        report.finesCents += paid;
      }
      const plaintiffId = caseRecord.plaintiffId;
      if (plaintiffId !== null && stolenValue > 0) {
        const restitution = Math.min(stolenValue, balanceOf(ctx.state, 'resident', defendant.id));
        if (restitution > 0) {
          ctx.transfer({
            from: { type: 'resident', id: defendant.id },
            to: { type: 'resident', id: plaintiffId },
            cents: restitution,
            reason: 'restitution',
          });
        }
      }
      ctx.state.sentences.set(sentenceId, {
        id: sentenceId,
        caseId: caseRecord.id,
        kind: 'fine',
        amountCents: paid,
        days: 0,
        startDay: ctx.day,
        endDay: ctx.day,
        status: 'paid',
        releasedDay: null,
      });
      ctx.emit({
        kind: 'verdict_fine',
        actorId: defendant.id,
        targetId: caseRecord.id,
        visibility: 'public',
        importance: 50,
        title: `${defendant.name} was fined ${paid} cents`,
        detail: { fineCents: paid, caseId: caseRecord.id },
      });
      break;
    }
    case 'imprisonment':
    default: {
      report.convictions += 1;
      const occupancy = [...ctx.state.sentences.values()].filter(
        (s) => s.kind === 'imprisonment' && s.status === 'active' && (s.endDay ?? 0) >= ctx.day,
      ).length;
      if (occupancy >= JAIL_CAPACITY) {
        // No cell: probation with the same closure guarantees.
        ctx.state.sentences.set(sentenceId, {
          id: sentenceId,
          caseId: caseRecord.id,
          kind: 'probation',
          amountCents: 0,
          days: 60,
          startDay: ctx.day,
          endDay: ctx.day + 60,
          status: 'active',
          releasedDay: null,
        });
        ctx.emit({
          kind: 'verdict_probation',
          actorId: defendant.id,
          targetId: caseRecord.id,
          visibility: 'public',
          importance: 50,
          title: `${defendant.name} received probation because the jail was full`,
          detail: { caseId: caseRecord.id, occupancy },
        });
        break;
      }
      const days = Math.min(120, 10 + Math.floor((caseRecord.prosecutionBps - caseRecord.defenceBps) / 100));
      ctx.state.sentences.set(sentenceId, {
        id: sentenceId,
        caseId: caseRecord.id,
        kind: 'imprisonment',
        amountCents: 0,
        days,
        startDay: ctx.day,
        endDay: ctx.day + days,
        status: 'active',
        releasedDay: null,
      });
      report.imprisoned += 1;
      for (const contract of ctx.state.contracts.values()) {
        if (contract.aId !== defendant.id || contract.status !== 'active') continue;
        contract.status = 'ended';
        contract.endDay = ctx.day;
      }
      ctx.emit({
        kind: 'verdict_imprisonment',
        actorId: defendant.id,
        targetId: caseRecord.id,
        visibility: 'public',
        importance: 60,
        title: `${defendant.name} was sentenced to ${days} days in the guard house`,
        detail: { days, caseId: caseRecord.id, magistrateId: magistrate?.id ?? null },
      });
      break;
    }
  }

  caseRecord.status = 'closed';
  caseRecord.closedDay = ctx.day;
  if (caseRecord.verdict === 'acquittal' || caseRecord.verdict === 'dismissal') {
    if (caseRecord.plaintiffId !== null) {
      ctx.emit({
        kind: 'allegation_unproven',
        actorId: caseRecord.plaintiffId,
        targetId: defendant.id,
        visibility: 'public',
        importance: 30,
        title: `The complaint against ${defendant.name} was not proven`,
        detail: { caseId: caseRecord.id },
      });
    }
  }
}

/** Public view of a case for the dashboard: allegations, findings, and ground truth stay distinct. */
export function caseSummary(ctx: TurnContext, caseId: number): Record<string, unknown> | null {
  const caseRecord = ctx.state.cases.get(caseId);
  if (!caseRecord) return null;
  const evidence = [...ctx.state.evidence.values()]
    .filter((e) => e.caseId === caseId)
    .map((e) => ({ kind: e.kind, weightBps: e.weightBps, public: e.public, createdDay: e.createdDay }));
  return {
    id: caseRecord.id,
    kind: caseRecord.kind,
    defendantId: caseRecord.defendantId,
    plaintiffId: caseRecord.plaintiffId,
    status: caseRecord.status,
    openedDay: caseRecord.openedDay,
    closedDay: caseRecord.closedDay,
    verdict: caseRecord.verdict,
    evidence,
    allegation: `A ${caseRecord.kind} complaint was filed`,
    groundTruth: caseRecord.truth,
  };
}
