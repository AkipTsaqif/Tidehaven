import { describe, expect, it } from 'vitest';
import { seedTown } from '../fixtures/seed-town.js';
import { mapView } from '../../src/application/map-query.js';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/http/server.js';
import { registerRoutes } from '../../src/http/routes.js';
import { SseHub } from '../../src/http/sse.js';
import { silentLogger } from '../../src/runtime/telemetry.js';
import { stateHash } from '../../src/domain/hash.js';
import { readFileSync } from 'node:fs';

const atlas = JSON.parse(readFileSync('client/public/map/atlas.json', 'utf8')) as {
  biomes: Record<string, { frames: Record<string, unknown> }>;
};

describe('town map projection', () => {
  it('returns empty scenery for a missing world', async () => {
    const town = await seedTown({ seed: 'map-missing' });
    try {
      expect(mapView(town.db, town.worldId + 999)).toMatchObject({
        world: null, terrain: null, lots: [], roads: [], trees: [], roadTargetsOmitted: 0,
      });
    } finally {
      town.db.close();
    }
  });

  it('shows every building on a real town, with sprite frames the atlas actually has', async () => {
    const town = await seedTown({ seed: 'map-real-town' });
    try {
      for (let day = 1; day <= 4; day += 1) await town.step();
      const view = mapView(town.db, town.worldId);
      const live = [...town.state.buildings.values()];
      expect(view.world?.name).toBeTruthy();
      expect(view.terrain?.rows.length).toBe(view.terrain?.height);
      expect(view.lots.filter((lot) => lot.buildingId !== null)).toHaveLength(live.length);
      expect(view.unplaced).toEqual({ buildings: 0, camps: 0 });
      expect(view.roads.length).toBeGreaterThan(0);
      expect(view.trees.length).toBeGreaterThan(0);
      expect(view.trees.length).toBeLessThanOrEqual(1200);
      expect(mapView(town.db, town.worldId)).toEqual(view);
      const frames = atlas.biomes[view.biome]!.frames;
      for (const lot of view.lots) {
        expect(lot.frame, `${lot.name} (${lot.kind})`).not.toBeNull();
        expect(frames[lot.frame!], `atlas frame ${lot.frame}`).toBeDefined();
      }
      // Workplaces show their business; at least one open business is staffed on the map.
      expect(view.lots.some((lot) => lot.business?.status === 'open')).toBe(true);
    } finally {
      town.db.close();
    }
  }, 60_000);

  it('is read-only: building the map does not change the simulation state or database', async () => {
    const town = await seedTown({ seed: 'map-read-only' });
    try {
      await town.step();
      const before = stateHash(town.state);
      const changes = () => town.db.get<{ n: number }>('select total_changes() as n')!.n;
      const writes = changes();
      mapView(town.db, town.worldId);
      mapView(town.db, town.worldId);
      expect(changes()).toBe(writes);
      expect(stateHash(town.state)).toBe(before);
    } finally {
      town.db.close();
    }
  }, 60_000);

  it('keeps existing buildings in place as the town builds more', async () => {
    const town = await seedTown({ seed: 'map-stable' });
    try {
      const before = new Map(mapView(town.db, town.worldId).lots.map((lot) => [lot.key, `${lot.tx},${lot.ty}`]));
      // Add buildings the way the engine does (new, higher ids), then persist through a normal day.
      const nextId = Math.max(...town.state.buildings.keys()) + 1;
      for (let n = 0; n < 6; n += 1) {
        town.state.buildings.set(nextId + n, {
          id: nextId + n, name: `Test site ${n}`, kind: n % 2 ? 'home_site' : 'development_site', capacity: 0,
          conditionBps: 10_000, builtDay: 1, destroyedDay: null, privateFlag: true,
        });
      }
      town.state.nextIds.building = nextId + 6;
      await town.step();
      const after = mapView(town.db, town.worldId);
      for (const lot of after.lots) {
        if (!lot.key.startsWith('b')) continue;
        const was = before.get(lot.key);
        if (was) expect(`${lot.tx},${lot.ty}`, lot.name).toBe(was);
      }
      expect(after.lots.filter((lot) => lot.name.startsWith('Test site'))).toHaveLength(6);
    } finally {
      town.db.close();
    }
  }, 60_000);

  it('serves /api/map over HTTP', async () => {
    const town = await seedTown({ seed: 'map-route' });
    const server = await createServer({
      config: loadConfig({ env: { TIDEHAVEN_DATA_DIR: 'data/map-route-test' }, fixtureProvider: true }),
      logger: silentLogger(),
      version: 'test',
      readStatus: async () => ({}) as never,
      registerExtraRoutes: async (app) =>
        registerRoutes(app, {
          db: town.db, worldId: town.worldId, logger: silentLogger(), sse: new SseHub(),
          runnerSnapshot: () => null, requestPause: () => undefined, requestResume: () => undefined, version: 'test',
        }),
    });
    try {
      const response = await server.app.inject({ method: 'GET', url: '/api/map' });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { lots: unknown[]; trees: unknown[]; roads: unknown[]; roadTargetsOmitted: number; tile: { width: number; height: number } };
      expect(body.tile).toMatchObject({ width: 32, height: 16 });
      expect(body.lots.length).toBeGreaterThan(0);
      expect(body.trees.length).toBeGreaterThan(0);
      expect(body.roads.length).toBeGreaterThan(0);
      expect(body.roadTargetsOmitted).toBeGreaterThanOrEqual(0);
      // Observer view: no seed-independent secrets such as provider keys can appear here.
      expect(response.body).not.toMatch(/api[_-]?key/i);
    } finally {
      await server.close();
      town.db.close();
    }
  }, 60_000);
});
