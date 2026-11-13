import { useEffect, useState } from 'react';
import { cents, getJson } from '../api.js';
import { Chart, RangePicker, useLinesWithPrefix } from '../charts.js';

interface EconomyResponse {
  prices: { good: string; price_cents: number }[];
  stock: { good: string; total: number }[];
  households: { id: number; name: string; cash_cents: number; members: number }[];
  businesses: { id: number; name: string; cash_cents: number; kind: string }[];
  recentFlows: { name: string; amount: number }[];
}

export function Economy({ revision = 0 }: { revision?: number }) {
  const prices = useLinesWithPrefix('prices');
  const goods = useLinesWithPrefix('goods');
  const [economy, setEconomy] = useState<EconomyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getJson<EconomyResponse>('/api/town')
      .then((town) => {
        if (!current) return;
        setEconomy(town);
        setError(null);
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [revision]);

  if (error) return <div className="banner error">{error}</div>;
  if (!economy) return <div className="muted">Loading economy…</div>;


  return (
    <section className="stack">
      <RangePicker />
      <div className="chart-grid">
        <Chart title="Treasury" format="money" lines={[{ metric: 'treasuryCents', label: 'treasury' }]} />
        <Chart title="Prices" format="money" lines={prices} />
        <Chart title="Goods in town" lines={goods} />
        <Chart title="Wages" format="money" lines={[{ metric: 'wagesPaidCents', label: 'paid' }, { metric: 'wageArrearsCents', label: 'unpaid' }]} />
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Household cash</h2>
          <table>
            <thead>
              <tr>
                <th>Household</th>
                <th>Members</th>
                <th>Cash</th>
              </tr>
            </thead>
            <tbody>
              {economy.households.map((household) => (
                <tr key={household.id}>
                  <td>{household.name}</td>
                  <td>{household.members}</td>
                  <td className="mono">{cents(household.cash_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Business capital</h2>
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Kind</th>
                <th>Cash</th>
              </tr>
            </thead>
            <tbody>
              {economy.businesses.map((business) => (
                <tr key={business.id}>
                  <td>{business.name}</td>
                  <td className="muted">{business.kind}</td>
                  <td className="mono">{cents(business.cash_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Goods in town</h2>
          <ul className="list">
            {economy.stock.map((item) => (
              <li key={item.good}>
                {item.good}: <span className="mono">{item.total}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2>Today's flows</h2>
          <ul className="list">
            {economy.recentFlows.map((flow) => (
              <li key={flow.name}>
                <span className="mono">{cents(flow.amount)}</span> {flow.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
