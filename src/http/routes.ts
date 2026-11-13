import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../storage/database.js';
import type { Logger } from '../runtime/telemetry.js';
import type { SseHub } from './sse.js';
import {
  dramaView,
  eventsPage,
  genealogy,
  historyPage,
  latestArticle,
  metricsSeries,
  overview,
  residentDetail,
  residentsPage,
  townView,
} from '../application/queries.js';
import { completeCommand, enqueueCommand } from '../storage/commands-repo.js';
import type { RunnerSnapshot } from '../runtime/runner.js';

/**
 * Dashboard API. Read routes are bounded and paginated; mutations are queued and applied at the next
 * day boundary by the runner (never mid-resolution).
 */

export interface RouteDeps {
  db: Db;
  worldId: number;
  logger: Logger;
  sse: SseHub;
  runnerSnapshot(): RunnerSnapshot | null;
  requestPause(reason: string): void;
  requestResume(): void;
  version: string;
}

const pauseSchema = z.object({}).strict();
const targetSchema = z.object({ value: z.number().int().min(0).max(10_000) }).strict();
const populationPolicySchema = z.object({ enabled: z.boolean() }).strict();
const settingSchema = z
  .object({
    key: z.enum(['incomeTaxBps', 'drama']),
    value: z.union([z.number(), z.string()]),
  })
  .strict();
const injectSchema = z
  .object({
    kind: z.enum(['storm', 'fire', 'flood', 'outbreak', 'gift']),
    confirm: z.literal('yes'),
  })
  .strict();

function num(value: unknown, fallback: number | undefined = undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, worldId } = deps;

  app.get('/api/overview', async () => ({
    overview: overview(db, worldId),
    runner: deps.runnerSnapshot(),
  }));

  app.get('/api/town', async () => townView(db, worldId));

  app.get('/api/residents', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return residentsPage(db, worldId, {
      limit: num(query.limit),
      offset: num(query.offset),
      search: query.search,
      status: query.status,
    });
  });

  app.get('/api/residents/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400).send({ error: 'invalid_id' });
      return;
    }
    const detail = residentDetail(db, worldId, id);
    if (!detail) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    return detail;
  });

  app.get('/api/residents/:id/genealogy', async (request) => {
    const id = Number((request.params as { id: string }).id);
    return genealogy(db, worldId, id);
  });

  app.get('/api/events', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return eventsPage(db, worldId, {
      limit: num(query.limit),
      offset: num(query.offset),
      day: num(query.day),
      kind: query.kind,
      actorId: num(query.actorId),
      visibility: query.visibility,
    });
  });

  app.get('/api/events/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const event = db.get<Record<string, unknown>>(
      `select id, day, phase, kind, actor_id as actorId, target_id as targetId, visibility, importance, title,
              detail_json as detailJson, cause_ids_json as causeIdsJson, effect_ids_json as effectIdsJson
         from events where world_id = ? and id = ?`,
      [worldId, id],
    );
    if (!event) {
      reply.code(404).send({ error: 'not_found' });
      return;
    }
    const links = db.all<{ from_event_id: number; to_event_id: number; relation: string }>(
      `select from_event_id, to_event_id, relation from event_links where world_id = ? and (from_event_id = ? or to_event_id = ?)`,
      [worldId, id, id],
    );
    return {
      event: {
        ...event,
        detail: JSON.parse(String(event.detailJson ?? '{}')) as unknown,
        causeIds: JSON.parse(String(event.causeIdsJson ?? '[]')) as unknown,
        effectIds: JSON.parse(String(event.effectIdsJson ?? '[]')) as unknown,
      },
      links,
    };
  });

  app.get('/api/drama', async () => dramaView(db, worldId));

  app.get('/api/history', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return historyPage(db, worldId, {
      limit: num(query.limit),
      offset: num(query.offset),
      search: query.search,
    });
  });

  app.get('/api/metrics', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return { series: metricsSeries(db, worldId, num(query.limit, 120) ?? 120) };
  });

  app.get('/api/article/latest', async () => ({ article: latestArticle(db, worldId) }));

  app.get('/api/logs', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const limit = Math.max(1, Math.min(200, num(query.limit, 80) ?? 80));
    return { items: deps.logger.recent(limit) };
  });

  app.get('/api/stream', async (request, reply) => {
    const lastEventId = (request.headers['last-event-id'] as string | undefined) ?? undefined;
    try {
      const { clientId, resync } = deps.sse.add(reply, lastEventId);
      request.raw.on('close', () => deps.sse.remove(clientId));
      if (resync) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'resync' })}\n\n`);
      }
    } catch {
      reply.code(429).send({ error: 'too_many_streams' });
    }
  });

  app.post('/api/controls/pause', async (request, reply) => {
    pauseSchema.parse(request.body ?? {});
    // Pause/resume take effect immediately (a safe boundary), so the queue entry is recorded as
    // applied rather than replayed at the next day boundary.
    const id = enqueueCommand(db, worldId, 'pause', { reason: 'Paused by operator' });
    deps.requestPause('Paused by operator');
    completeCommand(db, id, 'applied');
    reply.code(202).send({ ok: true, applied: 'pause' });
  });

  app.post('/api/controls/resume', async (request, reply) => {
    pauseSchema.parse(request.body ?? {});
    const id = enqueueCommand(db, worldId, 'resume', {});
    deps.requestResume();
    completeCommand(db, id, 'applied');
    reply.code(202).send({ ok: true, applied: 'resume' });
  });

  app.post('/api/controls/target', async (request, reply) => {
    const body = targetSchema.parse(request.body ?? {});
    enqueueCommand(db, worldId, 'set_target', { value: body.value });
    reply.code(202).send({ ok: true, queued: 'set_target', value: body.value });
  });

  app.post('/api/controls/population-policy', async (request, reply) => {
    const body = populationPolicySchema.parse(request.body ?? {});
    enqueueCommand(db, worldId, 'set_population_policy', { enabled: body.enabled });
    reply.code(202).send({ ok: true, queued: 'set_population_policy', enabled: body.enabled });
  });

  app.post('/api/controls/settings', async (request, reply) => {
    const body = settingSchema.parse(request.body ?? {});
    enqueueCommand(db, worldId, 'set_setting', { key: body.key, value: body.value });
    reply.code(202).send({ ok: true, queued: 'set_setting', key: body.key });
  });

  app.post('/api/controls/inject', async (request, reply) => {
    const body = injectSchema.parse(request.body ?? {});
    enqueueCommand(db, worldId, 'inject_event', { kind: body.kind });
    deps.logger.warn('operator requested event injection', { kind: body.kind });
    reply.code(202).send({ ok: true, queued: 'inject_event', kind: body.kind });
  });
}
