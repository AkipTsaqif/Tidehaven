import { useEffect, useState, type ReactNode } from 'react';
import { cents, getJson } from '../api.js';

interface DramaResponse {
  disasters: { id: number; kind: string; day: number; severity: number; stage: string; closedDay: number | null }[];
  illnesses: { id: number; name: string; disease: string; state: string; severity: number }[];
  cases: {
    id: number;
    kind: string;
    status: string;
    verdict: string | null;
    defendantName: string | null;
    plaintiffName: string | null;
    openedDay: number;
  }[];
  evidence: { id: number; caseId: number; kind: string; weightBps: number; public: number }[];
  sentences: { id: number; caseId: number; kind: string; amountCents: number; days: number; status: string; endDay: number | null }[];
  factions: { id: number; name: string; interest: string; supportBps: number; leaderId: number | null }[];
  offices: { office: string; seat: number; holderName: string | null; sinceDay: number }[];
  unrest: { id: number; kind: string; status: string; severity: number; startedDay: number }[];
  estates: { id: number; deceasedId: number; status: string; totalCents: number; closedDay: number | null }[];
}

export function Drama({ revision = 0 }: { revision?: number }) {
  const [data, setData] = useState<DramaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getJson<DramaResponse>('/api/drama')
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
  if (!data) return <div className="muted">Loading drama…</div>;

  return (
    <section className="stack">
      <div className="grid">
        <Panel title="Hazards">
          {data.disasters.length === 0 ? <div className="muted">No disasters recorded.</div> : null}
          <ul className="list">
            {data.disasters.map((disaster) => (
              <li key={disaster.id}>
                <span className="chip warn">{disaster.stage}</span> {disaster.kind} · day {disaster.day} · severity{' '}
                {disaster.severity}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Illness">
          {data.illnesses.length === 0 ? <div className="muted">Nobody is unwell.</div> : null}
          <ul className="list">
            {data.illnesses.map((illness) => (
              <li key={illness.id}>
                {illness.name} — {illness.disease} ({illness.state}, sev {illness.severity})
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Unrest">
          {data.unrest.length === 0 ? <div className="muted">No unrest.</div> : null}
          <ul className="list">
            {data.unrest.map((item) => (
              <li key={item.id}>
                <span className={`chip ${item.status === 'active' ? 'warn' : ''}`}>{item.status}</span> {item.kind} since day{' '}
                {item.startedDay}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Offices">
          <ul className="list">
            {data.offices.map((office) => (
              <li key={`${office.office}-${office.seat}`}>
                {office.office} {office.seat}: {office.holderName ?? 'vacant'}{' '}
                <span className="muted">since day {office.sinceDay}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Factions">
          {data.factions.length === 0 ? <div className="muted">No factions formed.</div> : null}
          <ul className="list">
            {data.factions.map((faction) => (
              <li key={faction.id}>
                {faction.name} <span className="muted">({faction.interest})</span> · support{' '}
                {(faction.supportBps / 100).toFixed(1)}%
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Estates">
          {data.estates.length === 0 ? <div className="muted">No estates settled.</div> : null}
          <ul className="list">
            {data.estates.map((estate) => (
              <li key={estate.id}>
                resident {estate.deceasedId} · {estate.status} · {cents(estate.totalCents)}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Cases and justice">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Kind</th>
              <th>Defendant</th>
              <th>Plaintiff</th>
              <th>Status</th>
              <th>Verdict</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((item) => {
              const evidence = data.evidence.filter((entry) => entry.caseId === item.id);
              return (
                <tr key={item.id}>
                  <td className="mono">#{item.id}</td>
                  <td>{item.kind}</td>
                  <td>{item.defendantName ?? '—'}</td>
                  <td>{item.plaintiffName ?? '—'}</td>
                  <td>{item.status}</td>
                  <td>{item.verdict ?? '—'}</td>
                  <td className="muted">
                    {evidence.map((entry) => `${entry.kind}${entry.public ? '' : ' (hidden)'}`).join(', ') || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <h3>Sentences</h3>
        <ul className="list">
          {data.sentences.map((sentence) => (
            <li key={sentence.id}>
              case #{sentence.caseId}: {sentence.kind}
              {sentence.amountCents ? ` ${cents(sentence.amountCents)}` : ''}
              {sentence.days ? ` ${sentence.days} days` : ''} · {sentence.status}
              {sentence.endDay ? ` (until day ${sentence.endDay})` : ''}
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
