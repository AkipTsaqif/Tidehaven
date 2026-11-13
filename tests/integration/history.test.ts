import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { metricHistory } from '../../src/application/history.js';
import { formatPrices } from '../../src/application/newspaper.js';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/http/server.js';
import { registerRoutes } from '../../src/http/routes.js';
import { SseHub } from '../../src/http/sse.js';
import { silentLogger } from '../../src/runtime/telemetry.js';

describe('chart history', () => {
  it('returns every metric as an aligned numeric series, flattening nested maps', async () => {
    const town = await seedTown({ seed: 'history' });
    try {
      for (let day = 1; day <= 12; day += 1) await town.step();
      const history = metricHistory(town.db, town.worldId, null);
      // Founding records day 0, so a chart starts at the town's first state.
      expect(history.days).toEqual([...Array(13).keys()]);
      expect(history.firstDay).toBe(0);
      expect(history.lastDay).toBe(12);
      expect(history.sampled).toBe(false);
      for (const key of ['population', 'treasuryCents', 'goods.grain', 'prices.bread', 'stages.adult', 'invariantsOk']) {
        expect(history.series[key], key).toHaveLength(13);
      }
      for (const values of Object.values(history.series)) expect(values).toHaveLength(13);
      expect(history.series.population!.every((value) => value >= 25)).toBe(true);
    } finally {
      town.db.close();
    }
  }, 60_000);

  it('limits a window to the last N days and samples long histories, always ending on the newest day', async () => {
    const town = await seedTown({ seed: 'history-window' });
    try {
      for (let day = 1; day <= 30; day += 1) await town.step();
      expect(metricHistory(town.db, town.worldId, 7).days).toEqual([24, 25, 26, 27, 28, 29, 30]);
      const sampled = metricHistory(town.db, town.worldId, null, 5);
      expect(sampled.sampled).toBe(true);
      expect(sampled.days.length).toBeLessThanOrEqual(6);
      expect(sampled.days[0]).toBe(0);
      expect(sampled.days.at(-1)).toBe(30);
    } finally {
      town.db.close();
    }
  }, 60_000);

  it('has only the founding row for a brand-new town, and nothing for an unknown world', async () => {
    const town = await seedTown({ seed: 'history-empty' });
    try {
      expect(metricHistory(town.db, town.worldId, null).days).toEqual([0]);
      expect(metricHistory(town.db, town.worldId + 999, null)).toMatchObject({ days: [], firstDay: null, lastDay: null });
    } finally {
      town.db.close();
    }
  });
});

describe('newspaper price line', () => {
  it('lists prices in dollars instead of printing [object Object]', () => {
    const line = formatPrices(new Map([['fish', 180], ['bread', 150]]));
    expect(line).toBe('bread $1.50 · fish $1.80');
    expect(line).not.toContain('object');
    expect(formatPrices(new Map())).toBe('none recorded');
  });
});

async function serve(town: Awaited<ReturnType<typeof seedTown>>) {
  return createServer({
      config: loadConfig({ env: { TIDEHAVEN_DATA_DIR: 'data/history-route-test' }, fixtureProvider: true }),
      logger: silentLogger(),
      version: 'test',
      readStatus: async () => ({}) as never,
      registerExtraRoutes: async (app) =>
        registerRoutes(app, {
          db: town.db, worldId: town.worldId, logger: silentLogger(), sse: new SseHub(),
          runnerSnapshot: () => null, requestPause: () => undefined, requestResume: () => undefined, version: 'test',
        }),
  });
}

describe('dashboard read routes', () => {
  it('answers every read endpoint on a real town without a server error', async () => {
    const town = await seedTown({ seed: 'history-all-routes', behaviour: 'drama' });
    for (let day = 1; day <= 5; day += 1) await town.step();
    const server = await serve(town);
    try {
      const resident = [...town.state.residents.keys()][0]!;
      for (const url of [
        '/api/overview', '/api/town', '/api/residents', `/api/residents/${resident}`, `/api/residents/${resident}/genealogy`,
        '/api/events', '/api/events/1', '/api/drama', '/api/history', '/api/metrics', '/api/metrics/history?days=all',
        '/api/article/latest', '/api/logs',
      ]) {
        const response = await server.app.inject({ method: 'GET', url });
        expect(response.statusCode, `${url}: ${response.body.slice(0, 200)}`).toBeLessThan(500);
      }
      const overview = (await server.app.inject({ method: 'GET', url: '/api/overview' })).json() as { overview: { businesses: { open: number } } };
      expect(overview.overview.businesses.open).toBeGreaterThan(0);
    } finally {
      await server.close();
      town.db.close();
    }
  }, 60_000);
});

describe('history routes', () => {
  it('serves the chart history and the newspaper archive on separate routes', async () => {
    const town = await seedTown({ seed: 'history-route' });
    for (let day = 1; day <= 3; day += 1) await town.step();
    const server = await serve(town);
    try {
      const chart = await server.app.inject({ method: 'GET', url: '/api/metrics/history?days=all' });
      expect(chart.statusCode).toBe(200);
      expect((chart.json() as { days: number[] }).days).toEqual([0, 1, 2, 3]);
      const archive = await server.app.inject({ method: 'GET', url: '/api/history?limit=5' });
      expect(archive.statusCode).toBe(200);
      expect(archive.json()).toHaveProperty('items');
    } finally {
      await server.close();
      town.db.close();
    }
  }, 60_000);
});
