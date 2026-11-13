import { Chart, RangePicker, useLinesWithPrefix } from '../charts.js';

/** Every daily metric the engine records, grouped by topic. The range applies to the whole page. */
export function Charts() {
  const goods = useLinesWithPrefix('goods');
  const prices = useLinesWithPrefix('prices');
  const volume = useLinesWithPrefix('marketVolume');
  const unmet = useLinesWithPrefix('unmetDemand');
  const exported = useLinesWithPrefix('tradeExported');
  const imported = useLinesWithPrefix('tradeImported');

  return (
    <section className="stack">
      <RangePicker />

      <h3 className="section-title">People</h3>
      <div className="chart-grid">
        <Chart title="Population" lines={[{ metric: 'population', label: 'living' }]} />
        <Chart
          title="Life stages"
          lines={[
            { metric: 'stages.child', label: 'children' },
            { metric: 'stages.adult', label: 'adults' },
            { metric: 'stages.elder', label: 'elders' },
          ]}
        />
        <Chart title="Households" lines={[{ metric: 'households', label: 'households' }]} />
        <Chart title="Hunger" lines={[{ metric: 'hunger', label: 'people going hungry' }]} />
        <Chart
          title="Health"
          lines={[
            { metric: 'activeIllness', label: 'ill now' },
            { metric: 'newIllness', label: 'new cases' },
            { metric: 'deaths', label: 'deaths' },
          ]}
        />
        <Chart title="Labour capacity" lines={[{ metric: 'labourCapacityTotal', label: 'labour points' }]} />
        <Chart
          title="Happiness"
          lines={[
            { metric: 'happinessAverage', label: 'average (0-100)' },
            { metric: 'happinessMiserable', label: 'miserable people' },
          ]}
        />
      </div>

      <h3 className="section-title">Money</h3>
      <div className="chart-grid">
        <Chart title="Treasury" format="money" lines={[{ metric: 'treasuryCents', label: 'treasury' }]} />
        <Chart title="Money supply" format="money" lines={[{ metric: 'moneySupplyCents', label: 'all money' }]} />
        <Chart
          title="Wages"
          format="money"
          lines={[
            { metric: 'wagesPaidCents', label: 'paid' },
            { metric: 'wageArrearsCents', label: 'unpaid' },
          ]}
        />
        <Chart title="Prices" format="money" lines={prices} />
      </div>

      <h3 className="section-title">Goods and trade</h3>
      <div className="chart-grid">
        <Chart title="Goods in town" lines={goods} />
        <Chart title="Market volume (units traded)" lines={volume} />
        <Chart title="Unmet demand" lines={unmet} />
        <Chart title="Market fills" lines={[{ metric: 'marketFills', label: 'trades' }]} />
        <Chart title="Exports (weekly ship)" lines={exported} />
        <Chart title="Imports (weekly ship)" lines={imported} />
      </div>

      <h3 className="section-title">Town and drama</h3>
      <div className="chart-grid">
        <Chart title="Open businesses" lines={[{ metric: 'businessesOpen', label: 'open' }]} />
        <Chart title="Crime" lines={[{ metric: 'crimes', label: 'crimes' }]} />
        <Chart title="Unrest" lines={[{ metric: 'unrestActive', label: 'active unrest' }]} />
        <Chart title="Events per day" lines={[{ metric: 'events', label: 'events' }]} />
      </div>

      <h3 className="section-title">Engine</h3>
      <div className="chart-grid">
        <Chart title="Day duration" format="ms" lines={[{ metric: 'durationMs', label: 'time per day' }]} />
        <Chart title="Invariant violations" lines={[{ metric: 'invariantsViolations', label: 'violations' }]} />
      </div>
    </section>
  );
}
