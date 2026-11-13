import type { FastifyReply } from 'fastify';

/**
 * Server-Sent Events hub.
 *
 * Clients receive small revision notifications (and an event id) and then fetch bounded detail pages.
 * Slow or disconnected browsers are dropped rather than allowed to grow an unbounded buffer, and a
 * reconnect with an expired Last-Event-ID is told to resync instead of replaying from the beginning.
 */

export interface SseClient {
  id: number;
  reply: FastifyReply;
  connectedAt: string;
}

interface RetainedEvent {
  id: number;
  payload: string;
}

export class SseHub {
  private clients = new Map<number, SseClient>();
  private nextId = 1;
  private retained: RetainedEvent[] = [];
  private maxClients: number;
  private retention: number;

  constructor(options: { maxClients?: number; retention?: number } = {}) {
    this.maxClients = options.maxClients ?? 20;
    this.retention = options.retention ?? 200;
  }

  count(): number {
    return this.clients.size;
  }

  /**
   * Register a stream.
   *
   * A reconnect that supplies `Last-Event-ID` gets every retained notification *after* that id
   * replayed, so a browser that missed revisions while disconnected catches up without polling. Only
   * an id older than the retention window forces an explicit resync.
   */
  /**
   * Register a stream.
   *
   * A reconnect that supplies `Last-Event-ID` gets every retained notification *after* that id
   * replayed, so a browser that missed revisions while disconnected catches up without polling. Only
   * an id older than the retention window forces an explicit resync.
   */
  add(reply: FastifyReply, lastEventId: string | undefined): { clientId: number; resync: boolean } {
    if (this.clients.size >= this.maxClients) {
      // Refuse politely; the client will retry with backoff.
      throw new Error('too_many_stream_clients');
    }
    const id = this.nextId++;
    this.clients.set(id, { id, reply, connectedAt: new Date().toISOString() });
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const oldest = this.retained[0]?.id ?? 0;
    const parsedId = lastEventId === undefined ? null : Number(lastEventId);
    const known = parsedId !== null && Number.isFinite(parsedId);
    const resync = known && parsedId < oldest;
    reply.raw.write(': connected\n\n');
    if (known && !resync) {
      for (const event of this.retained) {
        if (event.id <= parsedId) continue;
        try {
          reply.raw.write(`id: ${event.id}\ndata: ${event.payload}\n\n`);
        } catch {
          break;
        }
      }
    }
    return { clientId: id, resync };
  }

  remove(clientId: number): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);
    try {
      client.reply.raw.end();
    } catch {
      // already gone
    }
  }

  broadcast(type: string, data: Record<string, unknown>): void {
    const id = this.nextId++;
    const payload = JSON.stringify({ type, id, ...data });
    this.retained.push({ id, payload });
    if (this.retained.length > this.retention) this.retained.shift();

    for (const client of this.clients.values()) {
      try {
        const ok = client.reply.raw.write(`id: ${id}\ndata: ${payload}\n\n`);
        if (!ok) this.remove(client.id);
      } catch {
        this.remove(client.id);
      }
    }
  }

  healthPing(): void {
    for (const client of this.clients.values()) {
      try {
        client.reply.raw.write(': ping\n\n');
      } catch {
        this.remove(client.id);
      }
    }
  }

  closeAll(): void {
    for (const id of [...this.clients.keys()]) this.remove(id);
  }
}
