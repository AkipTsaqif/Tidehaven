import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { createTurnContext } from '../../src/domain/turn-context.js';
import { hireWorker } from '../../src/domain/economy/employment.js';

async function hiringTown() {
  const town = await seedTown({ seed: 'hiring-capacity' });
  const ctx = createTurnContext({ state: town.state, scenario: town.scenario, day: 1 });
  const farm = [...town.state.businesses.values()].find((b) => b.kind === 'farm')!;
  const adult = [...town.state.residents.values()].find((r) => r.bornDay <= -town.scenario.calendar.adultDays)!;
  for (const contract of town.state.contracts.values()) {
    if (contract.aId === adult.id) contract.status = 'ended';
  }
  return { ...town, ctx, farm, adult };
}

describe('hiring validates physical and funding limits', () => {
  it('rejects a full building without creating a contract', async () => {
    const town = await hiringTown();
    try {
      town.state.buildings.get(town.farm.buildingId!)!.capacity = 0;
      const before = town.state.contracts.size;
      expect(hireWorker({ ctx: town.ctx, businessId: town.farm.id, residentId: town.adult.id })).toMatchObject({
        ok: false, reason: 'premises_full',
      });
      expect(town.state.contracts.size).toBe(before);
    } finally { town.db.close(); }
  });

  it('requires five periods of the proposed wage in the actual payer account', async () => {
    const town = await hiringTown();
    try {
      town.state.accounts.get('treasury:0')!.balanceCents = 0;
      expect(hireWorker({ ctx: town.ctx, businessId: town.farm.id, residentId: town.adult.id })).toMatchObject({
        ok: false, reason: 'insufficient_payroll_reserve',
      });
    } finally { town.db.close(); }
  });

  it('rejects invalid wages and non-operational premises', async () => {
    const town = await hiringTown();
    try {
      for (const wageCents of [-1, 0.5, Number.MAX_SAFE_INTEGER, NaN]) {
        expect(hireWorker({ ctx: town.ctx, businessId: town.farm.id, residentId: town.adult.id, wageCents }).ok).toBe(false);
      }
      town.state.buildings.get(town.farm.buildingId!)!.destroyedDay = 1;
      expect(hireWorker({ ctx: town.ctx, businessId: town.farm.id, residentId: town.adult.id }).ok).toBe(false);
    } finally { town.db.close(); }
  });

  it('accepts an eligible worker only when there is space and funded payroll', async () => {
    const town = await hiringTown();
    try {
      const result = hireWorker({ ctx: town.ctx, businessId: town.farm.id, residentId: town.adult.id });
      expect(result.ok).toBe(true);
      expect(town.state.contracts.get(result.contractId!)?.aId).toBe(town.adult.id);
      expect(hireWorker({ ctx: town.ctx, businessId: town.farm.id, residentId: town.adult.id }).ok).toBe(false);
    } finally { town.db.close(); }
  });
});
