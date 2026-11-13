import { useCallback, useEffect, useState } from 'react';
import { calendarDay, getJson, subscribe, type StatusSnapshotView } from './api.js';
import { Overview } from './views/Overview.js';
import { Town } from './views/Town.js';
import { Residents } from './views/Residents.js';
import { Economy } from './views/Economy.js';
import { Drama } from './views/Drama.js';
import { History } from './views/History.js';
import { Controls } from './views/Controls.js';
import { Charts } from './views/Charts.js';
import { HistoryProvider } from './charts.js';

const TABS = ['Overview', 'Charts', 'Town', 'Residents', 'Economy', 'Drama', 'History', 'Controls'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [status, setStatus] = useState<StatusSnapshotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every committed revision so open detail views re-query their bounded page.
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const next = await getJson<StatusSnapshotView>('/api/status');
      setStatus(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    const unsubscribe = subscribe((nextRevision) => {
      setRevision(nextRevision);
      void refresh();
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⌘</span>
          <span className="brand-name">{status?.world?.name ?? 'Tidehaven'}</span>
          {status?.world ? (
            <span className="brand-sub">
              {calendarDay(status.world.day)} · pop {status.world.population}/
              {status.world.populationPolicyEnabled === false ? 'no target' : status.world.populationTarget}
            </span>
          ) : null}
        </div>
        <div className={`state-chip ${stateClass(status)}`}>{stateLabel(status)}</div>
      </header>

      {error ? <div className="banner error">API error: {error}</div> : null}
      {status?.pause ? (
        <div className="banner pause">
          <strong>Paused: {status.pause.reason}</strong> — {status.pause.detail}
          {status.recovery ? <div className="banner-hint">{status.recovery}</div> : null}
        </div>
      ) : null}
      {status && !status.invariants.ok ? (
        <div className="banner error">
          <strong>Invariant failure</strong> — {status.invariants.detail}
        </div>
      ) : null}

      <nav className="tabs">
        {TABS.map((name) => (
          <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>

      <main className="content">
        <HistoryProvider revision={revision}>
        {tab === 'Overview' ? <Overview status={status} revision={revision} /> : null}
        {tab === 'Town' ? <Town revision={revision} /> : null}
        {tab === 'Residents' ? <Residents revision={revision} today={status?.world?.day ?? 0} /> : null}
        {tab === 'Economy' ? <Economy revision={revision} /> : null}
        {tab === 'Drama' ? <Drama revision={revision} /> : null}
        {tab === 'History' ? <History revision={revision} /> : null}
        {tab === 'Charts' ? <Charts /> : null}
        {tab === 'Controls' ? <Controls status={status} onChanged={() => void refresh()} /> : null}
        </HistoryProvider>
      </main>

      <footer className="footer">
        <span>Tidehaven {status?.version ?? ''}</span>
        <span>
          provider {status?.provider.mode ?? '—'}
          {status?.provider.model ? ` · ${status.provider.model}` : ''}
        </span>
        <span>{status?.throughput.daysPerHour ?? '—'} days/hour</span>
      </footer>
    </div>
  );
}

function stateLabel(status: StatusSnapshotView | null): string {
  if (!status) return 'connecting';
  if (status.pause) return `paused · ${status.pause.reason}`;
  if (!status.running) return 'stopped';
  return 'running';
}

function stateClass(status: StatusSnapshotView | null): string {
  if (!status) return 'unknown';
  if (status.pause) return 'paused';
  if (!status.invariants.ok) return 'failed';
  return status.running ? 'running' : 'stopped';
}
