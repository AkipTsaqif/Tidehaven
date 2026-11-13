import { expect, test, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * End-to-end checks against a real server with the offline fixture decision source.
 * Covers: startup, live day progress, dashboard navigation, resident causality, controls, inert
 * rendering of hostile generated text, and that closing the browser does not stop the runner.
 *
 * The assertions are deliberately strict: a stalled runner must fail the progress check, an event page
 * with no actor links must fail the causality check, and the hostile-text check renders a real payload
 * with a detectable execution side effect rather than looking for a React property name in HTML.
 */

const DATA_DIR = 'D:/Projects/Tidehaven/data/e2e';
const DATABASE = join(DATA_DIR, 'tidehaven.sqlite');

interface StatusBody {
  world: { day: number } | null;
  pause: { reason: string } | null;
  running: boolean;
}

async function readStatus(request: APIRequestContext): Promise<StatusBody> {
  const response = await request.get('/api/status');
  expect(response.ok()).toBe(true);
  return (await response.json()) as StatusBody;
}

/**
 * A known, hostile fixture written straight into the town database.
 *
 * This is the payload the dashboard must render inertly: an event title and a newspaper body that
 * would execute script or fire an image error handler if it were ever assigned as HTML.
 */
async function injectHostileFixture(): Promise<{ title: string; sentinel: string }> {
  const sentinel = 'window.__tidehavenXss = true';
  const title = `<img src=x onerror="${sentinel}"> Hijacked headline <script>${sentinel}</script>`;
  const marker = 'xss-fixture-title';
  const deadline = Date.now() + 20_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    if (existsSync(DATABASE)) {
      let db: DatabaseSync | null = null;
      try {
        db = new DatabaseSync(DATABASE);
        db.exec('pragma busy_timeout = 5000');
        const world = db.prepare('select id from worlds order by id limit 1').get() as { id?: number } | undefined;
        if (world?.id !== undefined) {
          const day = (db.prepare('select max(current_day) as day from worlds where id = ?').get(world.id) as {
            day?: number;
          })?.day ?? 0;
          db.prepare(
            `insert into events (world_id, day, phase, kind, actor_id, target_id, location_id, visibility,
                                 importance, title, detail_json, cause_ids_json, effect_ids_json, created_at)
             values (?, ?, 'fixture', 'hostile_fixture', null, null, null, 'public', 99, ?, '{}', '[]', '[]', ?)`,
          ).run(world.id, day, title, new Date().toISOString());
          db.prepare(
            `insert into articles (world_id, day, headline, body, event_ids_json, generated_by, created_at)
             values (?, ?, ?, ?, '[]', 'fixture', ?)
             on conflict(world_id, day) do update set headline = excluded.headline, body = excluded.body`,
          ).run(world.id, day, title, `${title}\n${marker}`, new Date().toISOString());
          return { title, sentinel };
        }
      } catch (err) {
        lastError = err;
      } finally {
        db?.close();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`could not inject the hostile fixture: ${String(lastError)}`);
}

test.describe('Tidehaven dashboard', () => {
  test('starts, advances simulated time, and shows the overview', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByText('Tidehaven').first()).toBeVisible();
    await expect(page.locator('.state-chip')).toContainText(/running|paused/);

    const before = await readStatus(request);
    expect(before.world?.day ?? 0).toBeGreaterThan(0);

    // Strict progress: the committed day must actually move while the browser is open.
    await expect
      .poll(async () => (await readStatus(request)).world?.day ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(before.world?.day ?? 0);
  });

  test('navigates town, residents, drama, history and controls', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Town' }).click();
    await expect(page.getByText('Businesses').first()).toBeVisible();

    await page.getByRole('button', { name: 'Residents' }).click();
    await expect(page.getByRole('textbox', { name: 'Search residents' })).toBeVisible();
    const firstResident = page.locator('tbody tr.clickable').first();
    await expect(firstResident).toBeVisible();
    await firstResident.click();
    await expect(page.getByText('Identity').first()).toBeVisible();
    await expect(page.getByText('Ancestors').first()).toBeVisible();
    await page.getByRole('button', { name: '← All residents' }).click();

    await page.getByRole('button', { name: 'Drama' }).click();
    await expect(page.getByText('Cases and justice').first()).toBeVisible();

    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText('Latest events').first()).toBeVisible();

    await page.getByRole('button', { name: 'Controls' }).click();
    await expect(page.getByText('Population target (soft)').first()).toBeVisible();
  });

  test('shows a causal chain from a known event back to a resident', async ({ request }) => {
    // The fixture town always records actor-attributed events (employment, births, deaths). Require one
    // rather than skipping the substantive assertions when none is found.
    const response = await request.get('/api/events?limit=40');
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { items: { id: number; actorId: number | null }[] };
    expect(body.items.length).toBeGreaterThan(0);
    const withActor = body.items.find((item) => item.actorId !== null);
    expect(withActor, 'the fixture town must record at least one actor-attributed event').toBeDefined();
    const actorId = withActor!.actorId!;

    const resident = await request.get(`/api/residents/${actorId}`);
    expect(resident.ok()).toBe(true);
    const detail = (await resident.json()) as { id: number; events: { id: number }[] };
    expect(detail.id).toBe(actorId);
    expect(detail.events.some((event) => event.id === withActor!.id)).toBe(true);

    const eventDetail = await request.get(`/api/events/${withActor!.id}`);
    expect(eventDetail.ok()).toBe(true);
    const event = (await eventDetail.json()) as { event: { id: number; actorId: number | null } };
    expect(event.event.actorId).toBe(actorId);
  });

  test('renders hostile generated text inertly', async ({ page }) => {
    const fixture = await injectHostileFixture();
    await page.goto('/');
    // A real payload is loaded through the normal API and rendered by React.
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText('xss-fixture-title').first()).toBeVisible({ timeout: 20_000 });

    // The escaped text is present, but no element executes: no injected <img>/<script>, no handler ran.
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    const executed = await page.evaluate(() => (window as unknown as { __tidehavenXss?: boolean }).__tidehavenXss);
    expect(executed).toBeUndefined();
    const html = await page.content();
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>window.__tidehavenXss');
    void fixture;
  });

  test('queues a soft population target change and rejects a bad request', async ({ request }) => {
    const session = (await (await request.get('/api/session')).json()) as { csrfToken: string };
    const ok = await request.post('/api/controls/target', {
      data: { value: 90 },
      headers: { 'x-tidehaven-csrf': session.csrfToken, origin: 'http://127.0.0.1:4519' },
    });
    expect(ok.status()).toBe(202);

    const rejected = await request.post('/api/controls/target', {
      data: { value: -5 },
      headers: { 'x-tidehaven-csrf': session.csrfToken, origin: 'http://127.0.0.1:4519' },
    });
    expect(rejected.status()).toBeGreaterThanOrEqual(400);

    const noToken = await request.post('/api/controls/target', {
      data: { value: 90 },
      headers: { origin: 'http://127.0.0.1:4519' },
    });
    expect(noToken.status()).toBe(403);
  });

  test('pauses, resumes, and applies a target change at the next boundary', async ({ request }) => {
    const session = (await (await request.get('/api/session')).json()) as { csrfToken: string };
    const headers = { 'x-tidehaven-csrf': session.csrfToken, origin: 'http://127.0.0.1:4519' };

    expect((await request.post('/api/controls/pause', { data: {}, headers })).status()).toBe(202);
    await expect
      .poll(async () => (await readStatus(request)).pause?.reason ?? null, { timeout: 10_000 })
      .toBe('operator');

    expect((await request.post('/api/controls/resume', { data: {}, headers })).status()).toBe(202);
    await expect
      .poll(async () => {
        const status = await readStatus(request);
        return status.pause === null && status.running;
      }, { timeout: 10_000 })
      .toBe(true);

    expect((await request.post('/api/controls/target', { data: { value: 77 }, headers })).status()).toBe(202);
    await expect
      .poll(async () => {
        const status = (await (await request.get('/api/status')).json()) as {
          world: { populationTarget: number } | null;
        };
        return status.world?.populationTarget ?? null;
      }, { timeout: 20_000 })
      .toBe(77);
  });

  test('leaves the runner healthy when the browser closes', async ({ page, request }) => {
    await page.goto('/');
    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const status = await readStatus(request);
    expect(status.running).toBe(true);
  });
});
