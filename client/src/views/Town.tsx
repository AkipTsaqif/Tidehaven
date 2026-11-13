import { useEffect, useState, type ReactNode } from 'react';
import { cents, getJson } from '../api.js';
import { Chart, RangePicker, useLinesWithPrefix } from '../charts.js';

interface TownResponse {
  prices: { good: string; price_cents: number }[];
  businesses: { id: number; name: string; kind: string; status: string; cash_cents: number; staff: number; owner_id: number | null }[];
  households: { id: number; name: string; building_id: number | null; capacity: number; members: number; cash_cents: number }[];
  stock: { good: string; total: number }[];
  buildings: { id: number; name: string; kind: string; condition_bps: number }[];
  development: { id: number; kind: string; status: string; businessKind: string | null; buildingId: number; sponsorId: number; labourPct: number; capacityDelta: number }[];
  recentFlows: { name: string; amount: number }[];
}

export function Town({ revision = 0 }: { revision?: number }) {
  const prices = useLinesWithPrefix('prices');
  const [data, setData] = useState<TownResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getJson<TownResponse>('/api/town')
      .then((next) => {
        if (current) setData(next);
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [revision]);
  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <div className="muted">Loading town…</div>;

  return (
    <section className="stack">
      <Panel title="Businesses">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Staff</th>
              <th>Cash</th>
            </tr>
          </thead>
          <tbody>
            {data.businesses.map((business) => (
              <tr key={business.id}>
                <td>{business.name}</td>
                <td className="muted">{business.kind}</td>
                <td>{business.status}</td>
                <td>{business.staff}</td>
                <td className="mono">{cents(business.cash_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Households">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Members</th>
              <th>Home</th>
              <th>Cash</th>
            </tr>
          </thead>
          <tbody>
            {data.households.map((household) => (
              <tr key={household.id}>
                <td>{household.name}</td>
                <td>
                  {household.members}/{household.capacity}
                </td>
                <td className={household.building_id === null ? 'chip warn' : undefined}>
                  {household.building_id === null
                    ? 'camping'
                    : (data.buildings.find((building) => building.id === household.building_id)?.name ?? '—')}
                </td>
                <td className="mono">{cents(household.cash_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <RangePicker />
      <div className="chart-grid">
        <Chart title="Households" lines={[{ metric: 'households', label: 'households' }]} />
        <Chart title="Open businesses" lines={[{ metric: 'businessesOpen', label: 'open' }]} />
        <Chart title="Prices" format="money" lines={prices} />
      </div>

      <Panel title="Market">
        <table>
          <thead>
            <tr>
              <th>Good</th>
              <th>Price</th>
              <th>Town stock</th>
            </tr>
          </thead>
          <tbody>
            {data.prices.map((price) => {
              const stock = data.stock.find((item) => item.good === price.good);
              return (
                <tr key={price.good}>
                  <td>{price.good}</td>
                  <td className="mono">{cents(price.price_cents)}</td>
                  <td>{stock?.total ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {data.development && data.development.length > 0 && (
        <Panel title="Development projects">
          <table>
            <thead><tr><th>Project</th><th>Kind</th><th>Status</th><th>Labour</th><th>Added capacity</th></tr></thead>
            <tbody>{data.development.map((project) => (
              <tr key={project.id}>
                <td>#{project.id} · building {project.buildingId}</td>
                <td>{project.businessKind ?? project.kind}</td><td>{project.status}</td>
                <td>{project.labourPct}%</td><td>{project.capacityDelta}</td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      )}

      <Panel title="Buildings">
        <ul className="chips">
          {data.buildings.map((building) => (
            <li key={building.id} className={building.condition_bps < 6000 ? 'chip warn' : 'chip'}>
              {building.name}{' '}
              <span className="muted">
                {building.kind === 'home_site' || building.kind === 'development_site'
                  ? 'under construction'
                  : `${building.kind} · ${Math.round(building.condition_bps / 100)}%`}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Today's largest money flows">
        <ul className="list">
          {data.recentFlows.map((flow) => (
            <li key={flow.name}>
              <span className="mono">{cents(flow.amount)}</span> <span className="muted">{flow.name}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
