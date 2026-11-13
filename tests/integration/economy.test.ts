import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { checkGoodsLedger } from '../../src/domain/invariants.js';
import { GOODS } from '../../src/domain/state.js';

describe('peaceful baseline economy', () => {
  it('runs 120 days without famine, money creation, or unreconciled goods', async () => {
    const town = await seedTown({ seed: 'economy-baseline' });
    let hungryDays = 0;
    let moneyBaseline: number | null = null;

    for (let day = 1; day <= 120; day += 1) {
      const { metrics, violations } = await town.step();
      expect(violations).toEqual([]);
      const money = Number(metrics.moneySupplyCents);
      if (moneyBaseline === null) moneyBaseline = money;
      expect(money).toBe(moneyBaseline);
      if (Number(metrics.hunger) > 0) hungryDays = day;
      if (day > 3) {
        // After the initial stocking days, a peaceful town must feed itself.
        expect(Number(metrics.hunger)).toBe(0);
      }
    }

    expect(hungryDays).toBe(0);
    const living = [...town.state.residents.values()].filter((r) => r.status === 'living');
    expect(living.length).toBeGreaterThanOrEqual(25);

    // Goods reconciliation from the persisted flow ledger, not from memory.
    const flowRows = town.db.all<{ good: string; total: number }>(
      'select good, sum(delta) as total from goods_flows where world_id = ? group by good',
      [town.worldId],
    );
    const totals: Record<string, number> = {};
    for (const row of flowRows) totals[row.good] = row.total;
    for (const good of GOODS) totals[good] = totals[good] ?? 0;
    expect(checkGoodsLedger(town.state, totals)).toHaveLength(0);
  }, 120_000);

  it('keeps a positive treasury and pays wages without permanent arrears', async () => {
    const town = await seedTown({ seed: 'economy-wages' });
    let minTreasury = Number.MAX_SAFE_INTEGER;
    for (let day = 1; day <= 90; day += 1) {
      const { metrics } = await town.step();
      minTreasury = Math.min(minTreasury, Number(metrics.treasuryCents));
    }
    expect(minTreasury).toBeGreaterThan(0);
    const last = town.db.get<{ metrics_json: string }>(
      'select metrics_json from daily_metrics where world_id = ? order by day desc limit 1',
      [town.worldId],
    );
    const metrics = JSON.parse(last?.metrics_json ?? '{}') as { wagesPaidCents?: number; wageArrearsCents?: number };
    expect(metrics.wagesPaidCents ?? 0).toBeGreaterThan(0);
    expect(metrics.wageArrearsCents ?? 0).toBe(0);
  }, 90_000);

  it('responds to a shortage with higher prices and unmet demand', async () => {
    const town = await seedTown({ seed: 'economy-shortage' });
    for (let day = 1; day <= 5; day += 1) await town.step();
    const breadBefore = town.state.prices.get('bread') ?? 0;

    // Burn the bakery's grain and close the farm for a week: a seeded shortage.
    const farm = [...town.state.businesses.values()].find((b) => b.kind === 'farm');
    const bakery = [...town.state.businesses.values()].find((b) => b.kind === 'bakery');
    expect(farm).toBeDefined();
    expect(bakery).toBeDefined();
    if (farm) farm.status = 'closed';
    for (const [key, quantity] of [...town.state.inventories.entries()]) {
      if (key.endsWith(':grain')) town.state.inventories.set(key, Math.floor(quantity / 10));
    }
    for (let day = 6; day <= 20; day += 1) await town.step();
    const breadAfter = town.state.prices.get('bread') ?? 0;
    expect(breadAfter).toBeGreaterThan(breadBefore);
    expect(breadAfter).toBeLessThanOrEqual(225); // bounded at 150% of the reference price
  }, 60_000);
});
