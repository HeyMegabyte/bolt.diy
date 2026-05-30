/**
 * Route-LAYER tests for the visitor_events_core PUBLIC ingest (Hono app.request
 * + harness). Closes the last untested route. Covers: 400 missing slug, 404
 * unknown site, 404 flag-off, 404 disallowed origin, 202 accept (no-origin +
 * flag-on + valid body). Rate-limit middleware runs against the harness KV
 * (rl:* keys → null → under limit), so it passes through.
 */

import { visitorEvents } from '../handlers.js';
import { authApp, harnessEnv } from '../../../../src/__tests__/helpers/route_harness.js';

/** D1 double: site-by-slug lookup (configurable) + empty hostnames; INSERT noop. */
function db(
  site: { id: string; org_id: string; slug: string } | null = {
    id: 'site1',
    org_id: 'org1',
    slug: 'vitos',
  },
) {
  function prepare(sql: string) {
    const api = {
      bind: () => api,
      first: async () => null,
      run: async () => ({ meta: { changes: 1 } }),
      all: async <T>(): Promise<{ results: T[] }> => {
        if (sql.includes('FROM sites WHERE slug')) {
          return { results: (site ? [site] : []) as unknown as T[] };
        }
        if (sql.includes('FROM hostnames')) return { results: [] };
        return { results: [] };
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

const EVENTS = '/api/v1/events';
function post(headers: Record<string, string>, body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}
const VALID = { sessionId: 'sess-abcd1234', eventType: 'pageview', path: '/' };

describe('visitor_events_core ingest (route layer)', () => {
  it('400 when X-Site-Slug is missing', async () => {
    const app = authApp(visitorEvents);
    const res = await app.request(EVENTS, post({}, VALID), harnessEnv(db(), true));
    expect(res.status).toBe(400);
  });

  it('404 when the site is unknown', async () => {
    const app = authApp(visitorEvents);
    const res = await app.request(
      EVENTS,
      post({ 'X-Site-Slug': 'ghost' }, VALID),
      harnessEnv(db(null), true),
    );
    expect(res.status).toBe(404);
  });

  it('404 when the flag is off', async () => {
    const app = authApp(visitorEvents);
    const res = await app.request(
      EVENTS,
      post({ 'X-Site-Slug': 'vitos' }, VALID),
      harnessEnv(db(), false),
    );
    expect(res.status).toBe(404);
  });

  it('404 when the Origin is not allow-listed', async () => {
    const app = authApp(visitorEvents);
    const res = await app.request(
      EVENTS,
      post({ 'X-Site-Slug': 'vitos', Origin: 'https://evil.example.com' }, VALID),
      harnessEnv(db(), true),
    );
    expect(res.status).toBe(404);
  });

  it('202 accepts a valid event (no Origin, flag on)', async () => {
    const app = authApp(visitorEvents);
    const res = await app.request(
      EVENTS,
      post({ 'X-Site-Slug': 'vitos' }, VALID),
      harnessEnv(db(), true),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
  });

  it('400 on an invalid event body (sessionId too short)', async () => {
    const app = authApp(visitorEvents);
    const res = await app.request(
      EVENTS,
      post({ 'X-Site-Slug': 'vitos' }, { sessionId: 'x' }),
      harnessEnv(db(), true),
    );
    expect(res.status).toBe(400);
  });
});
