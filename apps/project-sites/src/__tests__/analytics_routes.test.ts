/**
 * @module __tests__/analytics_routes
 *
 * Jest unit tests for the `analyticsRoutes` Hono sub-app.
 * Uses `app.request()` — no real network, no real DO bindings.
 *
 * The executionCtx guard in the source (`try { c.executionCtx.waitUntil(p) } catch { void p }`)
 * prevents the Hono test harness (which throws on executionCtx access) from crashing
 * these tests. No mocking of executionCtx is needed.
 */

import { analyticsRoutes } from '../routes/analytics.js';

/** Minimal Env stub — all optional/unknown bindings absent */
const mockEnv = {} as unknown as import('../types/env.js').Env;

describe('POST /api/events', () => {
  it('returns 202 + {status:"queued"} for a valid event', async () => {
    const validEvent = {
      eventId: '123e4567-e89b-42d3-a456-426614174000',
      siteId: 's1',
      eventType: 'pageview',
      timestamp: 1700000000000,
    };

    const res = await analyticsRoutes.request(
      '/api/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validEvent),
      },
      mockEnv,
    );

    expect(res.status).toBe(202);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('queued');
  });

  it('returns 400 + error:"invalid_event" when eventId is not a UUID', async () => {
    const badEvent = {
      eventId: 'not-a-uuid',
      siteId: 's1',
      eventType: 'pageview',
      timestamp: 1700000000000,
    };

    const res = await analyticsRoutes.request(
      '/api/events',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(badEvent),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_event');
  });
});

describe('GET /api/analytics-debug', () => {
  it('returns 400 when siteId query param is absent', async () => {
    const res = await analyticsRoutes.request(
      '/api/analytics-debug',
      { method: 'GET' },
      mockEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('missing_param');
  });

  it('returns 200 + note:"dispatcher_unavailable" when EVENT_DISPATCHER binding absent', async () => {
    const res = await analyticsRoutes.request(
      '/api/analytics-debug?siteId=s1',
      { method: 'GET' },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { events: unknown[]; note: string };
    expect(body.note).toBe('dispatcher_unavailable');
    expect(Array.isArray(body.events)).toBe(true);
  });
});
