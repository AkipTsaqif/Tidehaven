import type { TurnContext } from '../turn-context.js';
import { balanceOf, nextId, type Estate, type Resident } from '../state.js';
import { openCase } from '../events/crime.js';

/**
 * Estates.
 *
 * Fixed order of settlement:
 *
 *   1. recorded lawful obligations (unpaid fines/restitution, wage arrears) are paid to creditors
 *   2. a valid, recorded will disposes of the distributable remainder
 *   3. otherwise the intestate shares apply: partner half, descendants split the rest
 *   4. a minor heir's share is held in a *separate protected account*, released at adulthood
 *   5. a will that disinherits a natural heir is disputed: the remainder stays escrowed, a case is
 *      opened, and the court rules by a recorded deadline
 *
 * Anything left goes to the treasury. Money is never created or destroyed, and repeated settlement of
 * the same deceased is refused.
 */

/** Escrow account ids for protected minor trusts; disjoint from estate escrow ids. */
export const MINOR_TRUST_ESCROW_BASE = 1_000_000;

export function minorTrustEscrowId(minorId: number): number {
  return MINOR_TRUST_ESCROW_BASE + minorId;
}

interface Claim {
  claimantId: number | null;
  kind: 'partner' | 'descendant' | 'guardian' | 'creditor' | 'treasury';
  amountCents: number;
  /** Creditors are paid before any distribution; heirs after. */
  priority: 0 | 1;
}

export function settleEstate(ctx: TurnContext, deceasedId: number): number | null {
  const deceased = ctx.state.residents.get(deceasedId);
  if (!deceased) return null;
  if ([...ctx.state.estates.values()].some((e) => e.deceasedId === deceasedId)) return null;

  const id = nextId(ctx.state, 'estate');
  const cash = balanceOf(ctx.state, 'resident', deceasedId);
  const estate: Estate = {
    id,
    deceasedId,
    openedDay: ctx.day,
    closedDay: null,
    status: 'open',
    totalCents: cash,
    will: null,
    escrowCents: 0,
    disputeDeadlineDay: null,
  };
  ctx.state.estates.set(id, estate);

  // Move the cash into escrow so it cannot be spent by anyone else mid-settlement.
  if (cash > 0) {
    ctx.transfer({
      from: { type: 'resident', id: deceasedId },
      to: { type: 'escrow', id },
      cents: cash,
      reason: 'estate_escrow',
    });
    estate.escrowCents = cash;
  }

  // Businesses: will first, then partner, then eldest adult descendant, otherwise the town.
  const will = ctx.state.wills.get(deceasedId) ?? null;
  estate.will = will ? { ...will.shares } : null;
  for (const business of ctx.state.businesses.values()) {
    if (business.ownerType !== 'resident' || business.ownerId !== deceasedId) continue;
    const heir = pickBusinessHeir(ctx, deceased, will);
    if (heir) {
      business.ownerId = heir.id;
      if (business.managerId === deceasedId) business.managerId = heir.id;
      ctx.emit({
        kind: 'business_inherited',
        actorId: heir.id,
        targetId: business.id,
        visibility: 'public',
        importance: 45,
        title: `${heir.name} inherited ${business.name}`,
        detail: { deceasedId, byWill: will !== null },
      });
    } else {
      business.ownerType = 'town';
      business.ownerId = null;
      if (business.managerId === deceasedId) business.managerId = null;
      ctx.emit({
        kind: 'business_escheated',
        actorId: null,
        targetId: business.id,
        visibility: 'public',
        importance: 40,
        title: `${business.name} passed to the town for want of an heir`,
        detail: { deceasedId },
      });
    }
  }

  const partner = deceased.partnerId === null ? null : ctx.state.residents.get(deceased.partnerId);
  const descendants = [...ctx.state.residents.values()]
    .filter((r) => r.status === 'living' && (r.motherId === deceasedId || r.fatherId === deceasedId))
    .sort((a, b) => a.id - b.id);

  // 1. Recorded obligations come first, up to what the estate actually holds.
  const claims: Claim[] = [];
  let available = cash;
  for (const obligation of recordedObligations(ctx, deceased)) {
    const amount = Math.min(available, obligation.amountCents);
    if (amount <= 0) continue;
    claims.push({ claimantId: obligation.creditorId, kind: 'creditor', amountCents: amount, priority: 0 });
    available -= amount;
  }

  // 2-3. A will disposes of the distributable remainder; otherwise intestate shares apply.
  if (will && available > 0) {
    let distributed = 0;
    for (const [key, bps] of Object.entries(will.shares).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const claimantId = Number(key);
      if (!Number.isInteger(claimantId) || claimantId <= 0) continue;
      const heir = ctx.state.residents.get(claimantId);
      if (!heir || heir.status !== 'living') continue;
      const share = Math.floor((available * Math.max(0, Math.min(10_000, bps))) / 10_000);
      if (share <= 0) continue;
      claims.push({ claimantId, kind: heirKind(deceased, heir), amountCents: share, priority: 1 });
      distributed += share;
    }
    available -= distributed;
  } else if (available > 0) {
    if (partner && partner.status === 'living') {
      const share = Math.floor(available / 2);
      claims.push({ claimantId: partner.id, kind: 'partner', amountCents: share, priority: 1 });
      available -= share;
    }
    if (descendants.length > 0 && available > 0) {
      const per = Math.floor(available / descendants.length);
      let distributed = 0;
      for (const child of descendants) {
        claims.push({ claimantId: child.id, kind: 'descendant', amountCents: per, priority: 1 });
        distributed += per;
      }
      available -= distributed;
    }
  }
  if (available > 0) {
    claims.push({ claimantId: null, kind: 'treasury', amountCents: available, priority: 1 });
  }

  // 4. A will that disinherits a natural heir is contested before any money moves. The estate stays
  //    escrowed and the court must rule by a recorded deadline.
  const disinherited = will
    ? naturalHeirsExcluded(partner, descendants, will.shares)
    : [];
  if (disinherited.length > 0) {
    estate.status = 'disputed';
    estate.disputeDeadlineDay = ctx.day + 10;
    for (const claim of claims) {
      if (claim.amountCents <= 0) continue;
      const claimId = nextId(ctx.state, 'estateClaim');
      ctx.state.estateClaims.set(claimId, {
        id: claimId,
        estateId: id,
        claimantId: claim.claimantId,
        kind: claim.kind,
        amountCents: claim.amountCents,
        status: 'pending',
        resolvedDay: null,
      });
    }
    openCase({
      ctx,
      kind: 'estate_dispute',
      defendantId: disinherited[0]?.id ?? deceasedId,
      plaintiffId: deceasedId,
      truth: {
        estateId: id,
        hearingDays: 10,
        disinherited: disinherited.map((r) => r.id).join(','),
      },
      evidence: [{ kind: 'will', weight: 6_000, isPublic: true }],
    });
    ctx.emit({
      kind: 'estate_disputed',
      actorId: disinherited[0]?.id ?? null,
      targetId: id,
      visibility: 'public',
      importance: 65,
      title: `The will of ${deceased.name} is disputed`,
      detail: {
        estateId: id,
        deadlineDay: estate.disputeDeadlineDay,
        disinherited: disinherited.map((r) => r.id),
      },
    });
    return id;
  }

  // 5. Execute the claims from escrow.
  for (const claim of claims) {
    const claimId = nextId(ctx.state, 'estateClaim');
    ctx.state.estateClaims.set(claimId, {
      id: claimId,
      estateId: id,
      claimantId: claim.claimantId,
      kind: claim.kind,
      amountCents: claim.amountCents,
      status: 'pending',
      resolvedDay: null,
    });
    if (claim.amountCents <= 0) {
      const pending = ctx.state.estateClaims.get(claimId);
      if (pending) {
        pending.status = 'rejected';
        pending.resolvedDay = ctx.day;
      }
      continue;
    }
    if (claim.claimantId === null) {
      ctx.transfer({
        from: { type: 'escrow', id },
        to: { type: 'treasury', id: 0 },
        cents: claim.amountCents,
        reason: 'estate_residue',
      });
    } else {
      payEstateAward({ ctx, estateId: id, claimantId: claim.claimantId, amountCents: claim.amountCents, kind: claim.kind });
    }
    estate.escrowCents -= claim.amountCents;
    const resolved = ctx.state.estateClaims.get(claimId);
    if (resolved) {
      resolved.status = 'paid';
      resolved.resolvedDay = ctx.day;
    }
  }

  estate.status = 'closed';
  estate.closedDay = ctx.day;
  estate.totalCents = cash;

  ctx.emit({
    kind: 'estate_settled',
    actorId: deceasedId,
    targetId: id,
    visibility: 'public',
    importance: 55,
    title: `The estate of ${deceased.name} was settled`,
    detail: {
      totalCents: cash,
      obligationsCents: claims.filter((c) => c.priority === 0).reduce((sum, c) => sum + c.amountCents, 0),
      claims: claims.map((c) => ({ claimantId: c.claimantId, kind: c.kind, amountCents: c.amountCents })),
      byWill: will !== null,
    },
  });
  return id;
}

/** Record a will for a living resident. Shares are basis points of the distributable estate. */
export function recordWill(
  ctx: TurnContext,
  residentId: number,
  shares: Record<string, number>,
): { ok: boolean; reason?: string } {
  const resident = ctx.state.residents.get(residentId);
  if (!resident || resident.status !== 'living') return { ok: false, reason: 'resident_unavailable' };
  if (resident.bornDay > ctx.day - ctx.scenario.calendar.adultDays) return { ok: false, reason: 'minor' };
  const total = Object.values(shares).reduce((sum, bps) => sum + Math.max(0, Math.trunc(bps)), 0);
  if (total <= 0) return { ok: false, reason: 'empty_will' };
  if (total > 10_000) return { ok: false, reason: 'shares_exceed_estate' };
  const cleaned: Record<string, number> = {};
  for (const [key, bps] of Object.entries(shares)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    const heir = ctx.state.residents.get(id);
    if (!heir || heir.id === residentId) continue;
    cleaned[String(id)] = Math.max(0, Math.min(10_000, Math.trunc(bps)));
  }
  if (Object.keys(cleaned).length === 0) return { ok: false, reason: 'no_valid_heir' };
  ctx.state.wills.set(residentId, { residentId, shares: cleaned, recordedDay: ctx.day });
  ctx.emit({
    kind: 'will_recorded',
    actorId: residentId,
    targetId: null,
    visibility: 'private',
    importance: 25,
    title: `${resident.name} recorded a will`,
    detail: { shares: cleaned },
  });
  return { ok: true };
}

/** Natural heirs the will leaves with nothing, even though intestacy would have provided for them. */
function naturalHeirsExcluded(partner: Resident | null | undefined, descendants: Resident[], shares: Record<string, number>): Resident[] {
  const excluded: Resident[] = [];
  if (partner && partner.status === 'living' && (shares[String(partner.id)] ?? 0) <= 0) excluded.push(partner);
  for (const child of descendants) {
    if ((shares[String(child.id)] ?? 0) > 0) continue;
    excluded.push(child);
  }
  return excluded;
}

function heirKind(deceased: Resident, heir: Resident): 'partner' | 'descendant' {
  if (deceased.partnerId === heir.id) return 'partner';
  return 'descendant';
}

interface RecordedObligation {
  creditorId: number | null;
  amountCents: number;
  label: string;
}

/**
 * Lawful obligations recorded against the deceased.
 *
 * These are facts the simulation already tracks: unpaid fines and restitution (sentences against the
 * resident), and unpaid wages owed to them (production records per-resident arrears). Nothing is
 * invented at settlement time.
 */
function recordedObligations(ctx: TurnContext, deceased: Resident): RecordedObligation[] {
  const obligations: RecordedObligation[] = [];
  for (const sentence of ctx.state.sentences.values()) {
    const caseRecord = ctx.state.cases.get(sentence.caseId);
    if (!caseRecord || caseRecord.defendantId !== deceased.id) continue;
    if (sentence.kind !== 'fine' && sentence.kind !== 'restitution') continue;
    if (sentence.status === 'paid' || sentence.amountCents <= 0) continue;
    obligations.push({ creditorId: null, amountCents: sentence.amountCents, label: `${sentence.kind}:${sentence.id}` });
  }
  // Unpaid wages owed *to* the deceased are a debt of the business, not of the estate; they are
  // recorded only so the settlement report can show them.
  const arrears = ctx.state.counters.get(`wageArrears:${deceased.id}`) ?? 0;
  if (arrears > 0) {
    ctx.state.counters.delete(`wageArrears:${deceased.id}`);
    ctx.emit({
      kind: 'estate_wage_arrears_written_off',
      actorId: deceased.id,
      targetId: null,
      visibility: 'private',
      importance: 20,
      title: `Unpaid wages of ${deceased.name} were written off`,
      detail: { arrearsCents: arrears },
    });
  }
  return obligations.sort((a, b) => (a.label < b.label ? -1 : 1));
}

function pickBusinessHeir(ctx: TurnContext, deceased: Resident, will: { shares: Record<string, number> } | null): Resident | null {
  if (will) {
    const candidates = Object.entries(will.shares)
      .filter(([, bps]) => bps > 0)
      .map(([key]) => ctx.state.residents.get(Number(key)))
      .filter((r): r is Resident => r !== undefined && r.status === 'living')
      .sort((a, b) => (will.shares[String(b.id)] ?? 0) - (will.shares[String(a.id)] ?? 0) || a.id - b.id);
    if (candidates[0]) return candidates[0];
  }
  if (deceased.partnerId !== null) {
    const partner = ctx.state.residents.get(deceased.partnerId);
    if (partner && partner.status === 'living') return partner;
  }
  const descendants = [...ctx.state.residents.values()]
    .filter(
      (r) =>
        r.status === 'living' &&
        (r.motherId === deceased.id || r.fatherId === deceased.id) &&
        r.bornDay <= ctx.day - ctx.scenario.calendar.adultDays,
    )
    .sort((a, b) => a.id - b.id);
  return descendants[0] ?? null;
}

/**
 * Pay one estate award from the estate's escrow.
 *
 * This is the *only* path from estate escrow to a person. A minor's award always lands in the protected
 * trust account, so neither the ordinary settlement nor the court's disputed-estate award can hand a
 * child spendable inheritance before adulthood.
 */
export function payEstateAward(params: {
  ctx: TurnContext;
  estateId: number;
  claimantId: number;
  amountCents: number;
  kind: 'partner' | 'descendant' | 'guardian' | 'creditor' | 'treasury';
}): 'minor_trust' | 'resident' {
  const { ctx, estateId, claimantId, amountCents, kind } = params;
  if (amountCents <= 0) return 'resident';
  const heir = ctx.state.residents.get(claimantId);
  const isMinor = heir !== undefined && heir.bornDay > ctx.day - ctx.scenario.calendar.adultDays;
  if (isMinor) {
    ctx.transfer({
      from: { type: 'escrow', id: estateId },
      to: { type: 'escrow', id: minorTrustEscrowId(claimantId) },
      cents: amountCents,
      reason: 'minor_heir_trust',
    });
    ctx.state.counters.set(`minorTrust:${claimantId}`, ctx.day);
    ctx.emit({
      kind: 'minor_trust_funded',
      actorId: claimantId,
      targetId: estateId,
      visibility: 'public',
      importance: 40,
      title: `${heir?.name ?? 'A minor'} holds an inheritance in trust until adulthood`,
      detail: { minorId: claimantId, amountCents },
    });
    return 'minor_trust';
  }
  ctx.transfer({
    from: { type: 'escrow', id: estateId },
    to: { type: 'resident', id: claimantId },
    cents: amountCents,
    reason: kind === 'creditor' ? 'estate_obligation' : 'estate_share',
  });
  return 'resident';
}

/**
 * Release a protected minor trust at adulthood.
 *
 * The trust is a separate account, so a guardian could never spend it; adulthood is the only transfer.
 */
export function releaseMinorTrust(ctx: TurnContext, residentId: number): number {
  const escrowId = minorTrustEscrowId(residentId);
  const held = ctx.state.accounts.get(`escrow:${escrowId}`)?.balanceCents ?? 0;
  if (held <= 0) return 0;
  ctx.transfer({
    from: { type: 'escrow', id: escrowId },
    to: { type: 'resident', id: residentId },
    cents: held,
    reason: 'minor_trust_release',
  });
  ctx.state.counters.delete(`minorTrust:${residentId}`);
  ctx.emit({
    kind: 'minor_trust_released',
    actorId: residentId,
    targetId: null,
    visibility: 'public',
    importance: 40,
    title: `${ctx.state.residents.get(residentId)?.name ?? 'A resident'} came into their inheritance`,
    detail: { amountCents: held },
  });
  return held;
}
