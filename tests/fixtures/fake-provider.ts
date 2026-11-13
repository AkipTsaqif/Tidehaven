import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Scriptable OpenAI-compatible fake provider for tests. No network egress: it listens on loopback only.
 *
 * Each queued response can be a normal completion, an HTTP error, malformed JSON, a truncation, a
 * refusal, a delay, or an oversized body. Requests are recorded so tests can assert on dispatch counts,
 * headers, and payloads.
 */

export interface RecordedRequest {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  at: number;
}

export type ScriptedResponse =
  | { kind: 'completion'; content: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; finishReason?: string }
  | { kind: 'http_error'; status: number; body?: string; headers?: Record<string, string> }
  | { kind: 'raw'; body: string; status?: number }
  | { kind: 'refusal'; refusal: string }
  | { kind: 'truncated'; content: string }
  | { kind: 'empty' }
  /** A reasoning model that spent its whole allowance thinking and returned no content. */
  | { kind: 'reasoning_only'; reasoning: string; completionTokens: number }
  | { kind: 'delay'; ms: number; then?: ScriptedResponse }
  /** Streams `bytes` bytes in chunks until the client stops reading (or the body is complete). */
  | { kind: 'oversized'; bytes: number; chunkBytes?: number };

export interface FakeProvider {
  url: string;
  requests: RecordedRequest[];
  /** Bytes the provider managed to write for `oversized` responses (client-side cancellation proof). */
  bytesWritten: number;
  enqueue(...responses: ScriptedResponse[]): void;
  close(): Promise<void>;
  /** Number of requests received so far. */
  count(): number;
}

export async function startFakeProvider(initial: ScriptedResponse[] = []): Promise<FakeProvider> {
  const queue: ScriptedResponse[] = [...initial];
  const requests: RecordedRequest[] = [];
  const state = { bytesWritten: 0 };

  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    try {
      body = raw === '' ? null : (JSON.parse(raw) as unknown);
    } catch {
      body = raw;
    }
    requests.push({
      path: request.url ?? '',
      method: request.method ?? 'GET',
      headers: request.headers,
      body,
      at: Date.now(),
    });

    const scripted = queue.shift() ?? {
      kind: 'completion' as const,
      content: JSON.stringify({ primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: 'default' }),
    };
    await respond(scripted, response, state);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    get bytesWritten() {
      return state.bytesWritten;
    },
    enqueue: (...responses) => {
      queue.push(...responses);
    },
    count: () => requests.length,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function respond(
  scripted: ScriptedResponse,
  response: ServerResponse,
  counters: { bytesWritten: number } = { bytesWritten: 0 },
): Promise<void> {
  switch (scripted.kind) {
    case 'oversized': {
      // Stream a body far larger than the client's bound. The client must stop reading (and abort),
      // which closes this response: the byte counter proves how far the stream actually got.
      response.writeHead(200, { 'content-type': 'application/json' });
      const chunkBytes = Math.max(1024, scripted.chunkBytes ?? 8192);
      const chunk = 'x'.repeat(chunkBytes);
      let remaining = Math.max(0, scripted.bytes);
      let closed = false;
      // One close listener for the whole stream (adding one per chunk leaks listeners).
      response.on('close', () => {
        closed = true;
      });
      while (remaining > 0 && !closed) {
        const size = Math.min(chunkBytes, remaining);
        counters.bytesWritten += size;
        remaining -= size;
        const writable = response.write(chunk.slice(0, size));
        if (!writable) {
          await new Promise<void>((resolve) => {
            const done = (): void => {
              response.off('drain', done);
              response.off('close', done);
              resolve();
            };
            response.on('drain', done);
            response.on('close', done);
          });
        }
      }
      if (!closed) {
        try {
          response.end();
        } catch {
          // client already gone
        }
      }
      return;
    }
    case 'delay':
      await new Promise((resolve) => setTimeout(resolve, scripted.ms));
      await respond(
        scripted.then ?? {
          kind: 'completion',
          content: JSON.stringify({ primary: { kind: 'work' }, social: null, orders: [], intents: [], summary: 'delayed' }),
        },
        response,
        counters,
      );
      return;
    case 'http_error':
      response.writeHead(scripted.status, {
        'content-type': 'application/json',
        ...(scripted.headers ?? {}),
      });
      response.end(scripted.body ?? JSON.stringify({ error: { message: `scripted ${scripted.status}`, type: 'scripted' } }));
      return;
    case 'raw':
      response.writeHead(scripted.status ?? 200, { 'content-type': 'application/json' });
      response.end(scripted.body);
      return;
    case 'refusal':
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: null, refusal: scripted.refusal }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
      );
      return;
    case 'truncated':
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: scripted.content }, finish_reason: 'length' }],
          usage: { prompt_tokens: 10, completion_tokens: 800 },
        }),
      );
      return;
    case 'empty':
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }));
      return;
    case 'reasoning_only':
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '', reasoning_content: scripted.reasoning }, finish_reason: 'length' }],
          usage: { prompt_tokens: 10, completion_tokens: scripted.completionTokens },
        }),
      );
      return;
    case 'completion':
    default:
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'fake-1',
          choices: [{ message: { content: scripted.content }, finish_reason: scripted.finishReason ?? 'stop' }],
          usage: scripted.usage ?? { prompt_tokens: 120, completion_tokens: 60 },
        }),
      );
  }
}
