import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { calendarDay, cents, getJson } from './api.js';

/**
 * Charts for every daily metric. One request per range feeds every chart on a page (HistoryProvider),
 * so switching "30d / 1y / All" is one fetch, not one per chart. Data comes from /api/metrics/history, which
 * samples very long histories down to at most 2,000 points.
 */

export interface History {
  windowDays: number | null;
  firstDay: number | null;
  lastDay: number | null;
  sampled: boolean;
  days: number[];
  series: Record<string, number[]>;
}

export const RANGES = [
  { label: '30 days', days: '30' },
  { label: '1 year', days: '365' },
  { label: '10 years', days: '3650' },
  { label: 'All', days: 'all' },
] as const;
export type RangeKey = (typeof RANGES)[number]['days'];

interface HistoryState {
  history: History | null;
  range: RangeKey;
  setRange: (range: RangeKey) => void;
}

const HistoryContext = createContext<HistoryState | null>(null);

export function HistoryProvider({ revision, children }: { revision: number; children: ReactNode }) {
  const [range, setRange] = useState<RangeKey>(() => (localStorage.getItem('tidehaven.range') as RangeKey | null) ?? '365');
  const [history, setHistory] = useState<History | null>(null);
  useEffect(() => {
    let current = true;
    getJson<History>(`/api/metrics/history?days=${range}`)
      .then((next) => {
        if (current) setHistory(next);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [range, revision]);
  const choose = (next: RangeKey): void => {
    localStorage.setItem('tidehaven.range', next);
    setRange(next);
  };
  return <HistoryContext.Provider value={{ history, range, setRange: choose }}>{children}</HistoryContext.Provider>;
}

function useHistory(): HistoryState {
  const state = useContext(HistoryContext);
  if (!state) throw new Error('Chart used outside HistoryProvider');
  return state;
}

/** Range buttons for the whole page; "All" shows the town's entire history. */
export function RangePicker() {
  const { range, setRange, history } = useHistory();
  return (
    <div className="range-picker" role="group" aria-label="Chart range">
      <span className="muted small">Charts:</span>
      {RANGES.map((option) => (
        <button
          key={option.days}
          className={option.days === range ? 'active' : ''}
          aria-pressed={option.days === range}
          onClick={() => setRange(option.days)}
        >
          {option.label}
        </button>
      ))}
      {history?.sampled ? <span className="muted small">sampled to {history.days.length} points</span> : null}
    </div>
  );
}

export type Format = 'number' | 'money' | 'percent' | 'ms';

export function formatValue(value: number, format: Format): string {
  if (!Number.isFinite(value)) return '—';
  if (format === 'money') return cents(value);
  if (format === 'percent') return `${(value / 100).toFixed(1)}%`;
  if (format === 'ms') return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
  return Math.abs(value) >= 1000 ? value.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(value * 100) / 100);
}

export interface Line {
  /** Metric key from /api/metrics/history, e.g. `treasuryCents` or `goods.grain`. */
  metric: string;
  label?: string;
}

const COLORS = ['#5ab0d8', '#e2b455', '#58c48a', '#e2735a', '#b48ee0', '#7fd4c1', '#d88fb5', '#c9c36a'];

/** A titled line chart of one or more metrics over the selected range. */
export function Chart({ title, lines, format = 'number' }: { title: string; lines: Line[]; format?: Format }) {
  const { history } = useHistory();
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => {
    if (!history) return null;
    const present = lines
      .map((line, index) => ({ ...line, color: COLORS[index % COLORS.length]!, values: history.series[line.metric] ?? [] }))
      .filter((line) => line.values.some((value) => Number.isFinite(value)));
    return { days: history.days, lines: present };
  }, [history, lines]);

  if (!data) return <ChartFrame title={title}><div className="muted small">Loading…</div></ChartFrame>;
  if (data.days.length < 2 || data.lines.length === 0) {
    return <ChartFrame title={title}><div className="muted small">Not enough history yet.</div></ChartFrame>;
  }

  const width = 600;
  const height = 160;
  const pad = { left: 4, right: 4, top: 8, bottom: 4 };
  const all = data.lines.flatMap((line) => line.values.filter((value) => Number.isFinite(value)));
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    // A flat line: give it room without inventing negative values for counts and money.
    max = min >= 0 ? max + Math.max(1, Math.abs(max) * 0.1) : max + 1;
    min = min >= 0 ? 0 : min - 1;
  }
  if (min > 0 && min < max * 0.25) min = 0;
  const firstDay = data.days[0]!;
  const lastDay = data.days[data.days.length - 1]!;
  const x = (day: number) => pad.left + ((day - firstDay) / Math.max(1, lastDay - firstDay)) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - min) / (max - min)) * (height - pad.top - pad.bottom);

  const paths = data.lines.map((line) => {
    let d = '';
    let pen = false;
    line.values.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(data.days[index]!).toFixed(1)},${y(value).toFixed(1)}`;
      pen = true;
    });
    return { ...line, d };
  });

  const index = hover ?? data.days.length - 1;
  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const day = firstDay + ((event.clientX - box.left) / box.width) * (lastDay - firstDay);
    let best = 0;
    for (let i = 1; i < data.days.length; i += 1) {
      if (Math.abs(data.days[i]! - day) < Math.abs(data.days[best]! - day)) best = i;
    }
    setHover(best);
  };

  return (
    <ChartFrame title={title}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart"
        role="img"
        aria-label={`${title} chart`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={pad.left} x2={width - pad.right} y1={y(min)} y2={y(min)} className="chart-axis" />
        {paths.map((line) => (
          <path key={line.metric} d={line.d} fill="none" stroke={line.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        ))}
        {hover !== null ? (
          <line x1={x(data.days[index]!)} x2={x(data.days[index]!)} y1={pad.top} y2={height - pad.bottom} className="chart-cursor" />
        ) : null}
      </svg>
      <div className="chart-meta small">
        <span className="muted">{calendarDay(data.days[index]!)}</span>
        {paths.map((line) => (
          <span key={line.metric}>
            <span className="chart-swatch" style={{ background: line.color }} />
            {line.label ?? line.metric}: <strong>{formatValue(line.values[index] ?? Number.NaN, format)}</strong>
          </span>
        ))}
        <span className="muted">
          range {formatValue(min, format)} – {formatValue(max, format)}
        </span>
      </div>
    </ChartFrame>
  );
}

function ChartFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel chart-panel">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

/** Every metric whose key starts with `prefix` (e.g. all goods), as chart lines. */
export function useLinesWithPrefix(prefix: string): Line[] {
  const { history } = useHistory();
  return useMemo(
    () =>
      Object.keys(history?.series ?? {})
        .filter((key) => key.startsWith(`${prefix}.`))
        .sort()
        .map((key) => ({ metric: key, label: key.slice(prefix.length + 1) })),
    [history, prefix],
  );
}
