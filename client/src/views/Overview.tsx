import { useEffect, useState, type ReactNode } from 'react';
import { bytes, cents, getJson, type StatusSnapshotView } from '../api.js';

interface OverviewResponse {
  overview: {
    world: {
      day: number;
      phase: string;
      populationTarget: number;
      populationPolicyEnabled?: boolean;
      hostCeiling?: number;
      drama: string;
      rulesVersion: string;
      stateHash: string | null;
    };
    population: { living: number; dead: number; emigrated: number; bornHere: number; expectedBirths: number };
    households: number;
    businesses: { open: number; closed: number };
    money: { treasuryCents: number; totalCents: number; householdCents: number; residentCents: number; businessCents: number };
    events: number;
    openCases: number;
    unrest: number;
    latestMetrics: Record<string, unknown> | null;
  } | null;
  runner: Record<string, unknown> | null;
}

export function Overview({ status, revision = 0 }: { status: StatusSnapshotView | null; revision?: number }) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  useEffect(() => {
    let active = true;
    getJson<OverviewResponse>('/api/overview')
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [status?.world?.day, revision]);

  const overview = data?.overview;
  const metrics = overview?.latestMetrics ?? {};

  return (
    <section className="grid">
      <Card title="Simulated date">
        <div className="big">Day {overview?.world.day ?? status?.world?.day ?? '—'}</div>
        <div className="muted">
          {overview?.world.phase ?? '—'} · rules {overview?.world.rulesVersion ?? '—'}
        </div>
        <div className="mono small">{overview?.world.stateHash?.slice(0, 16) ?? 'no hash yet'}</div>
      </Card>

      <Card title="Population">
        <div className="big">
          {overview?.population.living ?? status?.world?.population ?? '—'}
          <span className="muted">
            {' / '}
            {overview?.world.populationPolicyEnabled === false || status?.world?.populationPolicyEnabled === false
              ? 'no target'
              : overview?.world.populationTarget ?? status?.world?.populationTarget ?? '—'}
          </span>
        </div>
        <Row label="expected births" value={overview?.population.expectedBirths ?? status?.world?.expectedBirths ?? 0} />
        <Row label="born in town" value={overview?.population.bornHere ?? 0} />
        <Row label="died" value={overview?.population.dead ?? 0} />
        <Row label="emigrated" value={overview?.population.emigrated ?? 0} />
        <Row label="host ceiling" value={overview?.world.hostCeiling ?? status?.world?.hostCeiling ?? '—'} />
        <Row label="households" value={overview?.households ?? status?.world?.households ?? 0} />
      </Card>

      <Card title="Economy">
        <Row label="treasury" value={`${cents(overview?.money.treasuryCents ?? status?.world?.treasuryCents)} units`} />
        <Row label="money supply" value={`${cents(overview?.money.totalCents ?? status?.world?.moneySupplyCents)} units`} />
        <Row label="household cash" value={cents(overview?.money.householdCents)} />
        <Row label="business cash" value={cents(overview?.money.businessCents)} />
        <Row label="open businesses" value={overview?.businesses.open ?? status?.world?.businesses ?? 0} />
        <Row label="unmet food demand" value={String(metrics.unmetDemand ?? '—')} />
      </Card>

      <Card title="Throughput">
        <Row label="days/hour" value={status?.throughput.daysPerHour ?? '—'} />
        <Row label="last day" value={status?.throughput.lastDayDurationMs ? `${status.throughput.lastDayDurationMs} ms` : '—'} />
        <Row label="in-flight" value={status?.throughput.inFlightRequests ?? 0} />
        <Row label="queue" value={status?.throughput.queueDepth ?? 0} />
        <Row label="fallbacks" value={`${((status?.throughput.fallbackRateBps ?? 0) / 100).toFixed(1)}%`} />
      </Card>

      <Card title="Usage and storage">
        <Row label="requests today" value={status?.usage.requestsToday ?? 0} />
        <Row label="tokens today" value={status?.usage.tokensToday ?? 0} />
        <Row label="daily ceiling" value={status?.usage.ceilings.dailyTokens ?? 'none'} />
        <Row label="database" value={bytes(status?.storage.databaseBytes)} />
        <Row label="free disk" value={bytes(status?.storage.freeBytes)} />
        <Row label="backups" value={status?.storage.backups ?? 0} />
      </Card>

      <Card title="Town pulse">
        <Row label="events recorded" value={overview?.events ?? 0} />
        <Row label="open cases" value={overview?.openCases ?? 0} />
        <Row label="active unrest" value={overview?.unrest ?? 0} />
        <Row label="invariants" value={status?.invariants.ok ? 'ok' : 'FAILED'} />
        <Row label="drama level" value={overview?.world.drama ?? '—'} />
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {children}
    </div>
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
