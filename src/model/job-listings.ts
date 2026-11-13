import type { Scenario } from '../contracts/scenario.js';
import type { WorldState } from '../domain/state.js';
import type { ObservationLookups } from '../domain/lookups.js';

/**
 * Public job board: open workplaces with free places, their pay, and how short their output is.
 * Everything here is visible to anyone walking the town (no other resident's wages or wallet).
 * Bounded: at most `limit` listings, most-needed first, so a big town does not bloat every prompt.
 */

export interface JobListing {
  businessId: number;
  name: string;
  kind: string;
  /** Daily wage at full effort, in cents. */
  wageCents: number;
  freePlaces: number;
  /** Unmet demand for this workplace's goods on the last market day (0 = not short). */
  shortage: number;
}

export function jobListings(state: WorldState, scenario: Scenario, lookups: ObservationLookups, limit = 12): JobListing[] {
  const listings: JobListing[] = [];
  for (const business of state.businesses.values()) {
    if (business.status !== 'open' || business.buildingId === null) continue;
    const building = state.buildings.get(business.buildingId);
    if (!building || building.privateFlag || building.destroyedDay !== null) continue;
    const recipe = scenario.economy.recipes[business.kind];
    if (!recipe) continue;
    const staff = (lookups.staffByBusiness.get(business.id) ?? []).filter(
      (contract) => state.residents.get(contract.aId)?.status === 'living',
    ).length;
    const freePlaces = Math.max(0, building.capacity - staff);
    if (freePlaces === 0) continue;
    const shortage = Object.keys(recipe.outputs ?? {}).reduce(
      (sum, good) => sum + (state.counters.get(`shortage:${good}`) ?? 0),
      0,
    );
    listings.push({
      businessId: business.id,
      name: business.name,
      kind: business.kind,
      wageCents: scenario.economy.wages[recipe.wageClass],
      freePlaces,
      shortage,
    });
  }
  listings.sort((a, b) => b.shortage - a.shortage || b.wageCents - a.wageCents || a.businessId - b.businessId);
  return listings.slice(0, Math.max(1, Math.min(50, limit)));
}

export const JOB_GUIDE = [
  'Work: you choose where you work. seek_work with businessId applies to a place under JOB BOARD. If you',
  '  already have a job and the new place accepts you, you switch; if it refuses (full, cannot pay), you',
  '  keep your current job. quit_job leaves your job. seek_work with no businessId lets the town place you.',
  '  Jobs pay only on days you work; a business short of its goods needs workers most.',
].join('\n');
