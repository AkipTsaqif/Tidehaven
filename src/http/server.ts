import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import type { StatusSnapshot } from '../contracts/api.js';
import type { Logger } from '../runtime/telemetry.js';

export interface ServerDeps {
  config: AppConfig;
  logger: Logger;
  version: string;
  readStatus(): Promise<StatusSnapshot>;
  /** Optional extra route registration (dashboard APIs, SSE, controls). */
  registerExtraRoutes?(app: FastifyInstance): Promise<void>;
}

export interface TidehavenServer {
  app: FastifyInstance;
  /** Ephemeral same-origin session token for mutating dashboard requests. */
  csrfToken: string;
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function allowedOrigins(config: AppConfig): Set<string> {
  return new Set([
    `http://${config.host}:${config.port}`,
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
    'http://127.0.0.1:4318',
    'http://localhost:4318',
  ]);
}

export async function createServer(deps: ServerDeps): Promise<TidehavenServer> {
  const { config, logger } = deps;
  const csrfToken = randomBytes(24).toString('hex');
  const origins = allowedOrigins(config);
  const app = Fastify({ logger: false, bodyLimit: 1_048_576, disableRequestLogging: true });

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const host = request.headers.host ?? '';
    const hostname = host.split(':')[0] ?? '';
    if (!LOOPBACK.has(hostname)) {
      reply.code(403).send({ error: 'host_not_allowed', detail: 'This server only answers on loopback.' });
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      reply.code(403).send({ error: 'origin_not_allowed' });
      return;
    }
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    reply.header('x-frame-options', 'DENY');
  });

  // Mutating routes require the ephemeral token even though we are loopback-only:
  // another process on the machine must not be able to drive the simulation.
  app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    const token = request.headers['x-tidehaven-csrf'];
    const origin = request.headers.origin;
    const tokenOk = typeof token === 'string' && timingSafeEqual(token, csrfToken);
    if (!tokenOk || origin === undefined || !origins.has(origin)) {
      reply.code(403).send({ error: 'csrf_required' });
    }
  });

  app.get('/api/health', async () => ({
    ok: true,
    version: deps.version,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/api/status', async (_request, reply) => {
    const status = await deps.readStatus();
    reply.header('cache-control', 'no-store');
    return status;
  });

  app.get('/api/session', async () => ({ csrfToken }));

  if (deps.registerExtraRoutes) await deps.registerExtraRoutes(app);

  const clientDir = join(config.projectRoot, 'dist', 'client');
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir, prefix: '/' });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (_request, reply) => {
      reply.type('text/html').send(setupPage());
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not_found' });
        return;
      }
      reply.type('text/html').send(setupPage());
    });
  }

  app.setErrorHandler(async (error, request, reply) => {
    const failure = error as { statusCode?: number; message?: string };
    logger.error('http error', { path: request.url, method: request.method, err: error });
    reply.code(failure.statusCode ?? 500).send({
      error: 'internal_error',
      // Never leak stack traces, environment values, or secrets to the browser.
      detail: failure.statusCode && failure.statusCode < 500 ? failure.message : 'Internal error, see server log.',
    });
  });

  return {
    app,
    csrfToken,
    close: async () => {
      await app.close();
    },
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return ha.length === hb.length && ha.equals(hb);
}

function setupPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Tidehaven — build required</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:44rem;margin:4rem auto;padding:0 1rem;background:#0b1015;color:#dce7f0}
code{background:#16202b;padding:.1rem .35rem;border-radius:4px}</style></head>
<body><h1>Tidehaven is running, but the dashboard is not built</h1>
<p>The API is available at <code>/api/status</code> and <code>/api/health</code>.</p>
<p>Build the dashboard with <code>npm run build</code>, then reload this page.</p>
</body></html>`;
}
