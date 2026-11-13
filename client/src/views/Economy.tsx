import { useEffect, useState } from 'react';
import { cents, getJson } from '../api.js';

interface MetricsPoint {
  day: number;
  stateHash: string;
  metrics: Record<string, unknown>;
}

interface EconomyResponse {
  prices: { good: string; price_cents: number }[];
  stock: { good: string; total: number }[];
  households: { id: number; name: string; cash_cents: number; members: number }[];
  businesses: { id: number; name: string; cash_cents: number; kind: string }[];
  recentFlows: { name: string; amount: number }[];
}

export function Economy({ revision = 0 }: { revision?: number }) {
  const [economy, setEconomy] = useState<EconomyResponse | null>(null);
  const [series, setSeries] = useState<MetricsPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      getJson<EconomyResponse>('/api/town'),
      getJson<{ series: MetricsPoint[] }>('/api/metrics?limit=120'),
    ])
      .then(([town, metrics]) => {
        if (!current) return;
        setEconomy(town);
        setSeries(metrics.series);
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

  const treasury = series.map((point) => Number(point.metrics.treasuryCents ?? 0));
  const population = series.map((point) => Number(point.metrics.population ?? 0));
  const hunger = series.map((point) => Number(point.metrics.hunger ?? 0));

  return (
    <section className="stack">
      <div className="grid">
        <div className="panel">
          <h2>Treasury (last {series.length} days)</h2>
          <Sparkline values={treasury} />
          <div className="muted small">
            latest {cents(treasury[treasury.length - 1] ?? 0)} units · min {cents(Math.min(...treasury) || 0)} · max{' '}
            {cents(Math.max(...treasury) || 0)}
          </div>
        </div>
        <div className="panel">
          <h2>Population trend</h2>
          <Sparkline values={population} />
          <div className="muted small">
            latest {population[population.length - 1] ?? 0} · hungry {hunger[hunger.length - 1] ?? 0}
          </div>
        </div>
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

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="muted small">Not enough history yet.</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 320;
  const height = 64;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="spark" role="img" aria-label="trend">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
