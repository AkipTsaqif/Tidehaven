import { useState } from 'react';
import { postJson, type StatusSnapshotView } from '../api.js';

export function Controls({ status, onChanged }: { status: StatusSnapshotView | null; onChanged: () => void }) {
  const [target, setTarget] = useState<string>(String(status?.world?.populationTarget ?? 120));
  const policyEnabled = status?.world?.populationPolicyEnabled ?? true;
  const [tax, setTax] = useState('1200');
  const [drama, setDrama] = useState('dramatic');
  const [injectKind, setInjectKind] = useState('outbreak');
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(label: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      setMessage(`${label} queued; it applies at the next day boundary.`);
      setError(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setMessage(null);
    }
  }

  return (
    <section className="stack">
      {message ? <div className="banner">{message}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      <div className="grid">
        <div className="panel">
          <h2>Simulation</h2>
          <p className="muted small">
            {status?.running ? 'running' : 'stopped'}
            {status?.pause ? ` · paused: ${status.pause.reason}` : ''}
          </p>
          <div className="buttons">
            <button onClick={() => void send('Pause', () => postJson('/api/controls/pause', {}))}>Pause</button>
            <button onClick={() => void send('Resume', () => postJson('/api/controls/resume', {}))}>Resume</button>
          </div>
        </div>

        <div className="panel">
          <h2>Population policy</h2>
          <p className="muted small">
            {policyEnabled
              ? 'The numeric target creates gradual, story-driven pressure. Nobody is deleted; no deaths are fabricated.'
              : 'Disabled: no social target pressure or conception target block. The finite host ceiling still applies.'}
          </p>
          <div className="buttons">
            <span className="muted small">status: {policyEnabled ? 'soft target' : 'no target'}</span>
            <button
              onClick={() =>
                void send(`Population policy ${policyEnabled ? 'disabled' : 'enabled'}`, () =>
                  postJson('/api/controls/population-policy', { enabled: !policyEnabled }),
                )
              }
            >
              {policyEnabled ? 'Disable policy' : 'Enable policy'}
            </button>
          </div>
          <h3 className="small">Population target (soft)</h3>
          <p className="muted small">
            Stored and used only while the policy is enabled. Host safety ceiling: {status?.world?.hostCeiling ?? '—'} residents.
          </p>
          <div className="buttons">
            <input
              type="number"
              min={0}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              aria-label="Population target"
            />
            <button
              onClick={() =>
                void send('Population target', () =>
                  postJson('/api/controls/target', { value: Number(target) }),
                )
              }
            >
              Apply target
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>Policy</h2>
          <div className="buttons">
            <label className="muted small">Income tax (bps, cap 2500)</label>
            <input type="number" min={0} max={2500} value={tax} onChange={(event) => setTax(event.target.value)} />
            <button
              onClick={() =>
                void send('Income tax', () =>
                  postJson('/api/controls/settings', { key: 'incomeTaxBps', value: Number(tax) }),
                )
              }
            >
              Set tax
            </button>
          </div>
          <div className="buttons">
            <label className="muted small">Drama level</label>
            <select value={drama} onChange={(event) => setDrama(event.target.value)} aria-label="Drama level">
              <option value="calm">calm</option>
              <option value="dramatic">dramatic</option>
              <option value="volatile">volatile</option>
            </select>
            <button
              onClick={() =>
                void send('Drama level', () => postJson('/api/controls/settings', { key: 'drama', value: drama }))
              }
            >
              Set drama
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>Event injection (dangerous)</h2>
          <p className="muted small">
            Validated, audited, and applied at the next boundary. It cannot kill residents directly — consequences route
            through the normal rules.
          </p>
          <div className="buttons">
            <select value={injectKind} onChange={(event) => setInjectKind(event.target.value)} aria-label="Event kind">
              <option value="outbreak">outbreak</option>
              <option value="storm">storm</option>
              <option value="fire">fire</option>
              <option value="flood">flood</option>
              <option value="gift">gift</option>
            </select>
            <label className="small">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I
              understand this changes the town
            </label>
            <button
              disabled={!confirmed}
              onClick={() =>
                void send('Event injection', () =>
                  postJson('/api/controls/inject', { kind: injectKind, confirm: 'yes' }),
                )
              }
            >
              Inject
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Limits in force</h2>
        <ul className="list">
          <li>daily token ceiling: {status?.usage.ceilings.dailyTokens ?? 'none (maximum throughput)'}</li>
          <li>monthly token ceiling: {status?.usage.ceilings.monthlyTokens ?? 'none'}</li>
          <li>used today: {status?.usage.requestsToday ?? 0} requests / {status?.usage.tokensToday ?? 0} tokens</li>
          <li>free disk: see Overview</li>
        </ul>
        <p className="muted small">
          Closing this browser does not stop the simulation. Stop the process with Ctrl+C, or pause here.
        </p>
      </div>
    </section>
  );
}
