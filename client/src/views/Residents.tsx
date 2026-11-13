import { useEffect, useState } from 'react';
import { ageYears, getJson } from '../api.js';
import { Resident } from './Resident.js';

interface ResidentRow {
  id: number;
  name: string;
  sex: string;
  bornDay: number;
  status: string;
  householdId: number | null;
  healthState: string;
  hungerDays: number;
  origin: string;
}

interface ResidentsResponse {
  items: ResidentRow[];
  total: number;
  limit: number;
  offset: number;
}

export function Residents({ revision = 0, today = 0 }: { revision?: number; today?: number }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('living');
  const [selected, setSelected] = useState<number | null>(null);
  const [data, setData] = useState<ResidentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({ limit: '60', status, search });
    getJson<ResidentsResponse>(`/api/residents?${query.toString()}`)
      .then((next) => {
        if (current) setData(next);
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [search, status, revision]);

  if (selected !== null) {
    return <Resident residentId={selected} revision={revision} today={today} onBack={() => setSelected(null)} />;
  }

  return (
    <section className="stack">
      <div className="toolbar">
        <input
          placeholder="Search residents…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search residents"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
          <option value="living">Living</option>
          <option value="dead">Dead</option>
          <option value="emigrated">Emigrated</option>
          <option value="all">All</option>
        </select>
        <span className="muted">{data?.total ?? 0} residents</span>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Sex</th>
              <th>Age</th>
              <th>Household</th>
              <th>Health</th>
              <th>Hunger</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((resident) => (
              <tr key={resident.id} className="clickable" onClick={() => setSelected(resident.id)}>
                <td>{resident.name}</td>
                <td className="muted">{resident.sex}</td>
                <td>{ageYears(resident.bornDay, today)}</td>
                <td>{resident.householdId ?? '—'}</td>
                <td className={resident.healthState === 'healthy' ? '' : 'warn-text'}>{resident.healthState}</td>
                <td>{resident.hungerDays}</td>
                <td className="muted">{resident.origin}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted small">
        Ages are in simulated years (365 days each); adulthood is at 18. Money is shown in dollars.
      </div>
      <div className="muted small">Tip: open a resident to see assets, memories, cases, and genealogy.</div>
    </section>
  );
}
