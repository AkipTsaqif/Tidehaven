import type { ActorPlan } from '../../contracts/actions.js';
import type { ConstructionRules } from '../../contracts/scenario.js';
import type { TurnContext } from '../turn-context.js';
import { balanceOf, nextId, quantityOf, type Building, type Household } from '../state.js';
import { personalLabour } from '../economy/employment.js';
import { bumpBusinessRevenue, marketPrice } from '../economy/market.js';
import { chargeBusinessLevy } from '../economy/ledger.js';
import { findVacantHome, householdMembers } from './households.js';
import { logRejected } from './relationships.js';
import { liveBuildingCount } from '../growth-limits.js';

/**
 * Home construction.
 *
 * A town with `scenario.construction` is not stuck with its founding housing stock. Residents may
 * choose `build_home` as their primary action. A home is a real project: it needs adult labour-days
 * and timber. Timber comes from the builder's own household stock first, then is bought from the
 * public store or the timber camp at the market price, and when none can be bought the builder fells
 * it by hand (slower: those days go to felling, not building). Nothing is created from nothing.
 *
 * A site is a `building` row with kind `home_site` (capacity 0, not lived in). Progress lives in
 * counters. When the labour and timber are complete, the site becomes a `home`. A household that
 * built it (a camp) moves in; otherwise it stands vacant for the next newcomer or new couple.
 *
 * Newcomers who arrive to no vacant home form a *camp*: a household without a building. Camps do not
 * grow (capacity = members), and immigration waits while `maxCamps` camps exist. The camp builds
 * first, because the people with no roof are the ones with the strongest reason to build.
 */

export interface ConstructionReport {
  builders: number;
  sitesStarted: number;
  homesCompleted: number;
  timberBought: number;
  timberFelled: number;
  rejected: number;
}

const SITE_KIND = 'home_site';
/** Share of a builder's daily labour that goes to the site; the job keeps the rest (see effectiveLabour). */
const BUILD_SHARE_PCT = 70;
const HOME_NAMES = ['Hearth', 'Willow', 'Stone', 'Ridge', 'Brook', 'Fern', 'Gull', 'Thorn', 'Ash', 'Moss'];

const labourKey = (siteId: number): string => `site:${siteId}:labour`;
const timberKey = (siteId: number): string => `site:${siteId}:timber`;
const ownerKey = (siteId: number): string => `site:${siteId}:household`;

/** Camps: living households with no building. */
export function campHouseholds(ctx: TurnContext): Household[] {
  return [...ctx.state.households.values()]
    .filter((h) => h.dissolvedDay === null && h.buildingId === null && householdMembers(ctx, h.id).length > 0)
    .sort((a, b) => a.id - b.id);
}

export function activeSites(ctx: TurnContext): Building[] {
  return [...ctx.state.buildings.values()]
    .filter((b) => b.kind === SITE_KIND && b.destroyedDay === null)
    .sort((a, b) => a.id - b.id);
}

/** True when a newcomer can be received: a vacant home, or room to pitch another camp. */
export function canReceiveNewcomer(ctx: TurnContext): boolean {
  const rules = ctx.scenario.construction;
  if (!rules) return false;
  if (findVacantHome(ctx) !== null) return true;
  return campHouseholds(ctx).length < rules.maxCamps;
}

export function constructionPhase(ctx: TurnContext, plans: Map<number, ActorPlan>): ConstructionReport {
  const report: ConstructionReport = {
    builders: 0,
    sitesStarted: 0,
    homesCompleted: 0,
    timberBought: 0,
    timberFelled: 0,
    rejected: 0,
  };
  const rules = ctx.scenario.construction;
  const builders = [...plans.values()]
    .filter((p) => p.plan.primary?.kind === 'build_home')
    .sort((a, b) => a.actorId - b.actorId);
  if (builders.length === 0) return report;
  if (!rules) {
    for (const plan of builders) {
      logRejected(ctx, plan, 'construction_not_available');
      report.rejected += 1;
    }
    return report;
  }

  for (const actorPlan of builders) {
    const actor = ctx.state.residents.get(actorPlan.actorId);
    if (!actor || actor.status !== 'living') continue;
    // Building takes the part of the day a non-work primary frees (the job keeps the other 30%).
    const labour = Math.floor((personalLabour(ctx, actor) * BUILD_SHARE_PCT) / 100);
    if (labour <= 0) {
      logRejected(ctx, actorPlan, 'builder_unfit');
      report.rejected += 1;
      continue;
    }
    const site = siteFor(ctx, rules, actor.householdId, report);
    if (!site) {
      logRejected(ctx, actorPlan, 'construction_sites_full');
      report.rejected += 1;
      continue;
    }
    report.builders += 1;
    if (!supplyTimber(ctx, rules, site, actor.id, actor.householdId, labour, report)) {
      // The day went to felling timber; nothing else to add to the site.
      continue;
    }
    const done = ctx.state.counters.get(labourKey(site.id)) ?? 0;
    ctx.state.counters.set(labourKey(site.id), Math.min(rules.labourDays * 100, done + labour));
  }

  for (const site of activeSites(ctx)) {
    const labour = ctx.state.counters.get(labourKey(site.id)) ?? 0;
    const timber = ctx.state.counters.get(timberKey(site.id)) ?? 0;
    if (labour >= rules.labourDays * 100 && timber >= rules.timberUnits) {
      completeHome(ctx, rules, site);
      report.homesCompleted += 1;
    }
  }
  return report;
}

/**
 * The site a builder works on: their own household's site if it has one, otherwise the oldest site
 * (help a neighbour), otherwise a new one if the limit allows. A camp always gets its own site first.
 */
function siteFor(
  ctx: TurnContext,
  rules: ConstructionRules,
  householdId: number | null,
  report: ConstructionReport,
): Building | null {
  const sites = activeSites(ctx);
  const own = sites.find((s) => householdId !== null && ctx.state.counters.get(ownerKey(s.id)) === householdId);
  if (own) return own;
  const household = householdId === null ? null : ctx.state.households.get(householdId);
  const isCamp = household !== null && household !== undefined && household.buildingId === null;
  if (!isCamp && sites.length > 0) return sites[0] ?? null;
  if (sites.length >= rules.maxActiveSites) return isCamp ? (sites[0] ?? null) : null;

  // Total buildings include finished/abandoned sites: repeated construction cannot grow state forever.
  if (ctx.scenario.growth && liveBuildingCount(ctx.state) >= ctx.scenario.growth.maxBuildings) return null;
  const id = nextId(ctx.state, 'building');
  const started = ctx.state.counters.get('homesStarted') ?? 0;
  ctx.state.counters.set('homesStarted', started + 1);
  const round = Math.floor(started / HOME_NAMES.length);
  const name = `${HOME_NAMES[started % HOME_NAMES.length]} Cottage${round > 0 ? ` ${round + 1}` : ''}`;
  const site: Building = {
    id,
    name,
    kind: SITE_KIND,
    capacity: 0,
    conditionBps: 10_000,
    builtDay: ctx.day,
    destroyedDay: null,
    privateFlag: true,
  };
  ctx.state.buildings.set(id, site);
  ctx.state.counters.set(labourKey(id), 0);
  ctx.state.counters.set(timberKey(id), 0);
  if (isCamp && householdId !== null) ctx.state.counters.set(ownerKey(id), householdId);
  report.sitesStarted += 1;
  ctx.emit({
    kind: 'construction_started',
    actorId: null,
    targetId: id,
    locationId: id,
    visibility: 'public',
    importance: 35,
    title: `Work began on a new home, ${name}`,
    detail: { labourDays: rules.labourDays, timberUnits: rules.timberUnits, forHousehold: isCamp ? householdId : null },
  });
  return site;
}

/**
 * Make sure the site has the timber the next stage of work needs: one unit per `labourDays /
 * timberUnits` of labour. Returns false when the builder spent the day felling timber instead.
 */
function supplyTimber(
  ctx: TurnContext,
  rules: ConstructionRules,
  site: Building,
  builderId: number,
  householdId: number | null,
  labour: number,
  report: ConstructionReport,
): boolean {
  const have = ctx.state.counters.get(timberKey(site.id)) ?? 0;
  if (have >= rules.timberUnits) return true;
  const labourDone = ctx.state.counters.get(labourKey(site.id)) ?? 0;
  // Timber needed so far, proportional to the work done after today's labour, rounded up.
  const neededSoFar = Math.min(
    rules.timberUnits,
    Math.ceil(((labourDone + labour) * rules.timberUnits) / (rules.labourDays * 100)),
  );
  let missing = Math.max(0, neededSoFar - have);
  if (missing === 0) return true;
  let added = 0;

  // 1. The builder's household stock.
  if (householdId !== null) {
    const own = Math.min(missing, quantityOf(ctx.state, 'household', householdId, 'timber'));
    if (own > 0) {
      ctx.shiftGoods({ owner: { type: 'household', id: householdId }, good: 'timber', delta: -own, reason: 'construction_material' });
      added += own;
      missing -= own;
    }
  }

  // 2. Buy: public store first, then an open timber camp, at the market price, paid by the household
  //    first and the builder second. Nothing is bought on credit.
  if (missing > 0) {
    const price = marketPrice(ctx, 'timber');
    const sellers: { type: 'treasury' | 'business'; id: number }[] = [{ type: 'treasury', id: 0 }];
    for (const business of [...ctx.state.businesses.values()].sort((a, b) => a.id - b.id)) {
      if (business.status === 'open' && business.kind === 'timber_camp') sellers.push({ type: 'business', id: business.id });
    }
    const payers: { type: 'household' | 'resident'; id: number }[] = [];
    if (householdId !== null) payers.push({ type: 'household', id: householdId });
    payers.push({ type: 'resident', id: builderId });
    for (const seller of sellers) {
      if (missing <= 0) break;
      const stock = quantityOf(ctx.state, seller.type, seller.id, 'timber');
      let units = Math.min(missing, stock);
      for (const payer of payers) {
        if (units <= 0) break;
        const affordable = Math.min(units, Math.floor(balanceOf(ctx.state, payer.type, payer.id) / Math.max(1, price)));
        if (affordable <= 0) continue;
        ctx.transfer({ from: payer, to: seller, cents: affordable * price, reason: 'construction_timber' });
        if (seller.type === 'business') {
          // A sale like any other: the camp pays its levy and the revenue counts toward hiring.
          chargeBusinessLevy({ ctx, businessId: seller.id, proceedsCents: affordable * price });
          bumpBusinessRevenue(ctx, seller.id, affordable * price);
        }
        // The timber leaves the seller's stock straight into the walls: a recorded sink, like any use.
        ctx.shiftGoods({ owner: seller, good: 'timber', delta: -affordable, reason: 'construction_material' });
        added += affordable;
        missing -= affordable;
        units -= affordable;
        report.timberBought += affordable;
      }
    }
  }

  if (added > 0) ctx.state.counters.set(timberKey(site.id), have + added);
  if (missing <= 0) return true;

  // 3. Fell it by hand: a full day of the builder's labour yields `fellPerDay` timber for the site
  //    (scaled by how much labour they have), and no building work happens today.
  const felled = Math.max(1, Math.floor((rules.fellPerDay * labour) / 100));
  ctx.state.counters.set(timberKey(site.id), Math.min(rules.timberUnits, have + added + felled));
  report.timberFelled += felled;
  return false;
}

function completeHome(ctx: TurnContext, rules: ConstructionRules, site: Building): void {
  site.kind = 'home';
  site.capacity = rules.homeCapacity;
  site.builtDay = ctx.day;
  const ownerId = ctx.state.counters.get(ownerKey(site.id));
  ctx.state.counters.delete(labourKey(site.id));
  ctx.state.counters.delete(timberKey(site.id));
  ctx.state.counters.delete(ownerKey(site.id));

  // The camp that built it moves in; otherwise the oldest camp; otherwise it stands vacant.
  const owner = ownerId === undefined ? undefined : ctx.state.households.get(ownerId);
  const camp =
    owner && owner.dissolvedDay === null && owner.buildingId === null ? owner : campHouseholds(ctx)[0];
  if (camp) {
    camp.buildingId = site.id;
    camp.capacity = rules.homeCapacity;
  }
  ctx.emit({
    kind: 'home_built',
    actorId: null,
    targetId: site.id,
    locationId: site.id,
    visibility: 'public',
    importance: 45,
    title: camp ? `${site.name} is finished and ${camp.name} moved in` : `${site.name} is finished and stands ready`,
    detail: { capacity: rules.homeCapacity, householdId: camp?.id ?? null },
  });
  for (const member of camp ? householdMembers(ctx, camp.id) : []) {
    ctx.remember(member.id, 'life', `On day ${ctx.day} we moved into ${site.name}, the home we built.`, 70, []);
  }
}
