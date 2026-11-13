import type { WorldState } from './state.js';

/**
 * Safety limits count what is in use, not everything that ever existed. A closed business or an
 * abandoned/destroyed site holds no capacity, so it does not block new growth decades later.
 */
export function liveBuildingCount(state: WorldState): number {
  let count = 0;
  for (const building of state.buildings.values()) {
    if (building.destroyedDay === null && building.kind !== 'development_abandoned') count += 1;
  }
  return count;
}

export function openBusinessCount(state: WorldState): number {
  let count = 0;
  for (const business of state.businesses.values()) if (business.status === 'open') count += 1;
  return count;
}
