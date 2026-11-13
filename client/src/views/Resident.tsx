import { useEffect, useState, type ReactNode } from 'react';
import { ageYears, calendarDay, cents, getJson } from '../api.js';

interface ResidentDetail {
  id: number;
  name: string;
  sex: string;
  bornDay: number;
  status: string;
  origin: string;
  householdId: number | null;
  partnerId: number | null;
  motherId: number | null;
  fatherId: number | null;
  guardianId: number | null;
  traits: Record<string, number>;
  skills: Record<string, number>;
  healthState: string;
  hungerDays: number;
  educationDays: number;
  deathDay: number | null;
  deathCause: string | null;
  emigratedDay: number | null;
  destination: string | null;
  cashCents: number;
  inventory: { good: string; quantity: number }[];
  employment: { businessName?: string; termsJson?: string } | null;
  relationships: { kind: string; otherId: number; trust: number }[];
  events: { id: number; day: number; kind: string; title: string; visibility: string }[];
  memories: { day: number; kind: string; text: string; importance: number }[];
  health: { disease: string; state: string; severity: number }[];
  injuries: { kind: string; severity: number; disability: number }[];
  cases: { id: number; kind: string; status: string; verdict: string | null }[];
  sentences: { kind: string; days: number; status: string }[];
  children: { id: number; name: string }[];
  parents: { id: number; name: string }[];
  grievances: { kind: string; severity: number; reason: string }[];
}

interface Genealogy {
  ancestors: { id: number; name: string; depth: number }[];
  descendants: { id: number; name: string; depth: number; status: string }[];
}

export function Resident({
  residentId,
  revision = 0,
  today = 0,
  onBack,
}: {
  residentId: number;
  revision?: number;
  today?: number;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<ResidentDetail | null>(null);
  const [tree, setTree] = useState<Genealogy | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clear only when switching residents; a new day refreshes in place instead of flashing "Loading".
  useEffect(() => {
    setDetail(null);
    setTree(null);
  }, [residentId]);

  useEffect(() => {
    let current = true;
    getJson<ResidentDetail>(`/api/residents/${residentId}`)
      .then((next) => {
        if (current) setDetail(next);
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      });
    getJson<Genealogy>(`/api/residents/${residentId}/genealogy`)
      .then((next) => {
        if (current) setTree(next);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [residentId, revision]);

  if (error) return <div className="banner error">{error}</div>;
  if (!detail) return <div className="muted">Loading resident…</div>;

  return (
    <section className="stack">
      <div className="toolbar">
        <button onClick={onBack}>← All residents</button>
        <h2>{detail.name}</h2>
        <span className={`chip ${detail.status === 'living' ? '' : 'warn'}`}>{detail.status}</span>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Identity</h2>
          <Row label="id" value={detail.id} />
          <Row label="sex" value={detail.sex} />
          <Row label="age" value={`${ageYears(detail.bornDay, detail.deathDay ?? detail.emigratedDay ?? today)} years`} />
          <Row label="born" value={bornLabel(detail.bornDay)} />
          <Row label="origin" value={detail.origin} />
          <Row label="household" value={detail.householdId ?? '—'} />
          <Row label="partner" value={detail.partnerId ?? '—'} />
          <Row label="guardian" value={detail.guardianId ?? '—'} />
          <Row label="education days" value={detail.educationDays} />
          {detail.deathDay !== null ? <Row label="died" value={`day ${detail.deathDay} (${detail.deathCause})`} /> : null}
          {detail.emigratedDay !== null ? <Row label="left" value={`day ${detail.emigratedDay} → ${detail.destination ?? '?'}`} /> : null}
        </div>

        <div className="card">
          <h2>Health and money</h2>
          <Row label="health" value={detail.healthState} />
          <Row label="hungry days" value={detail.hungerDays} />
          <Row label="cash" value={`${cents(detail.cashCents)}`} />
          <Row label="job" value={detail.employment?.businessName ?? 'unemployed'} />
          {detail.health.map((item, index) => (
            <Row key={index} label="illness" value={`${item.disease} (${item.state})`} />
          ))}
          {detail.injuries.map((injury, index) => (
            <Row key={index} label="injury" value={`${injury.kind} sev ${injury.severity}${injury.disability ? ' · disability' : ''}`} />
          ))}
        </div>

        <div className="card">
          <h2>Traits and skills</h2>
          {Object.entries(detail.traits).map(([key, value]) => (
            <Row key={key} label={key} value={value} />
          ))}
          {Object.entries(detail.skills).map(([key, value]) => (
            <Row key={key} label={`skill: ${key}`} value={value} />
          ))}
        </div>

        <div className="card">
          <h2>Belongings</h2>
          {detail.inventory.length === 0 ? <div className="muted">No goods held personally.</div> : null}
          {detail.inventory.map((item) => (
            <Row key={item.good} label={item.good} value={item.quantity} />
          ))}
          {detail.grievances.map((grievance, index) => (
            <Row key={index} label={`grievance: ${grievance.kind}`} value={`${grievance.severity} — ${grievance.reason}`} />
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Relationships</h2>
        <ul className="list">
          {detail.relationships.length === 0 ? <li className="muted">No recorded relationships.</li> : null}
          {detail.relationships.map((relationship, index) => (
            <li key={index}>
              <span className="chip">{relationship.kind}</span> resident {relationship.otherId}{' '}
              <span className="muted">trust {relationship.trust}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Ancestors</h2>
          <ul className="list">
            {(tree?.ancestors ?? []).map((person) => (
              <li key={person.id}>
                {person.name} <span className="muted">depth {person.depth}</span>
              </li>
            ))}
            {(tree?.ancestors ?? []).length === 0 ? <li className="muted">Unknown lineage.</li> : null}
          </ul>
        </div>
        <div className="panel">
          <h2>Descendants</h2>
          <ul className="list">
            {(tree?.descendants ?? []).map((person) => (
              <li key={person.id}>
                {person.name} <span className="muted">depth {person.depth} · {person.status}</span>
              </li>
            ))}
            {(tree?.descendants ?? []).length === 0 ? <li className="muted">No descendants yet.</li> : null}
          </ul>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Recent events</h2>
          <ul className="list">
            {detail.events.map((event) => (
              <li key={event.id}>
                <span className="mono">d{event.day}</span> {event.title}{' '}
                <span className="muted">[{event.visibility}]</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2>Memories</h2>
          <ul className="list">
            {detail.memories.map((memory, index) => (
              <li key={index}>
                <span className="mono">d{memory.day}</span> {memory.text}{' '}
                <span className="muted">({memory.kind})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel">
        <h2>Legal record</h2>
        <ul className="list">
          {detail.cases.length === 0 && detail.sentences.length === 0 ? <li className="muted">Clean record.</li> : null}
          {detail.cases.map((item) => (
            <li key={item.id}>
              case {item.id}: {item.kind} — {item.status}
              {item.verdict ? ` · verdict ${item.verdict}` : ''}
            </li>
          ))}
          {detail.sentences.map((sentence, index) => (
            <li key={index}>
              sentence: {sentence.kind} {sentence.days ? `(${sentence.days} days)` : ''} · {sentence.status}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/**
 * Days count from the town's founding (day 0). A founder who was 25 at founding was born 9,125 days
 * (25 years) before it, so the raw value is negative; show it as a date instead.
 */
function bornLabel(bornDay: number): string {
  if (bornDay >= 0) return calendarDay(bornDay);
  return `${calendarDay(bornDay)} (day ${bornDay})`;
}
