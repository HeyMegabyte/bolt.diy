import { resilientGet } from './helpers/api-request.js';
import { test, expect } from '@playwright/test';

/**
 * Health + API contract checks. Request-level only — API assertions run
 * against the config baseURL (local mock `scripts/e2e_server.cjs` or prod);
 * the SPA-shell check targets PROD_URL because the vanilla
 * `public/index.html` was deleted and the Angular shell is served by the
 * worker from R2 (only observable on a deployed origin).
 */
const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Health Check', () => {
  test('returns healthy status', async ({ request }) => {
    const res = await resilientGet(request, '/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(body.status);
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('environment');
    expect(body).toHaveProperty('timestamp');
  });

  test('includes dependency checks', async ({ request }) => {
    const res = await resilientGet(request, '/health');
    const body = await res.json();
    expect(body).toHaveProperty('checks');
  });

  test('returns valid ISO timestamp', async ({ request }) => {
    const res = await resilientGet(request, '/health');
    const body = await res.json();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  test('responds within 5 seconds', async ({ request }) => {
    const start = Date.now();
    await resilientGet(request, '/health');
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

test.describe('Marketing Site', () => {
  test('serves the Angular SPA shell at /', async ({ request }) => {
    // Modernized 2026-07-31: the vanilla homepage (`.logo` / "Project" copy in
    // public/index.html) was deleted — `/` now serves the Angular shell from
    // R2 via the worker. Request-level on purpose; absolute URL because the
    // local e2e mock server has no SPA shell to serve.
    const res = await resilientGet(request, `${PROD_URL}/`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<app-root');
    expect(html).toContain('<title>ProjectSites');
  });
});

test.describe('API Auth Gates', () => {
  test('returns 401/403 for unauthenticated /api/sites', async ({ request }) => {
    const res = await resilientGet(request, '/api/sites');
    expect([401, 403]).toContain(res.status());
  });

  test('returns 401/403 for unauthenticated /api/billing/subscription', async ({ request }) => {
    const res = await resilientGet(request, '/api/billing/subscription');
    expect([401, 403]).toContain(res.status());
  });

  test('returns 404 JSON for bare /api/hostnames (route lives under /api/sites/:siteId/hostnames)', async ({
    request,
  }) => {
    // There is no bare /api/hostnames route — hostname CRUD is site-scoped.
    // The API soft-404 guard must answer with machine-readable JSON, never
    // the SPA shell (which this asserted-as-401 test silently tolerated for
    // as long as the suite was skipped).
    const res = await resilientGet(request, '/api/hostnames');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type'] ?? '').toContain('application/json');
  });

  test('returns 401/403 for unauthenticated /api/audit-logs', async ({ request }) => {
    const res = await resilientGet(request, '/api/audit-logs');
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('Request Tracing', () => {
  test('returns x-request-id header', async ({ request }) => {
    const res = await resilientGet(request, '/health');
    expect(res.headers()).toHaveProperty('x-request-id');
  });

  test('propagates provided x-request-id', async ({ request }) => {
    const testId = `e2e-test-${Date.now()}`;
    const res = await resilientGet(request, '/health', {
      headers: { 'x-request-id': testId },
    });
    expect(res.headers()['x-request-id']).toBe(testId);
  });
});

test.describe('CORS', () => {
  test('includes request-id for allowed origin', async ({ request }) => {
    const res = await resilientGet(request, '/health', {
      headers: { Origin: 'https://projectsites.dev' },
    });
    expect(res.headers()).toHaveProperty('x-request-id');
  });
});

test.describe('Error Handling', () => {
  test('returns JSON 404 for unknown API routes', async ({ request }) => {
    // Soft-404 guard (worker commit 76249c96): every unmatched /api/* path is
    // a machine-readable JSON 404 — never the SPA shell, never a bare 401.
    // The local mock server implements the same contract.
    const res = await resilientGet(request, '/api/nonexistent-route-xyz');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type'] ?? '').toContain('application/json');
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  test('returns 413 for oversized payloads (403 when the CF challenge intercepts)', async ({
    request,
  }) => {
    // The worker's payloadLimitMiddleware rejects >256KB bodies with a 413
    // PAYLOAD_TOO_LARGE envelope (src/middleware/payload_limit.ts), and the
    // local mock mirrors it. On prod, however, Cloudflare Bot Fight Mode
    // challenges request-context POSTs BEFORE the worker runs — a 403
    // text/html challenge page (reproduced 2026-07-31 via curl). Both are
    // the honest observable contract; the old `[413, 400]` set was not
    // (400 was never produced by the size path).
    const largeBody = 'x'.repeat(300_000);
    const res = await request.post('/api/auth/magic-link', {
      data: largeBody,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(largeBody.length),
      },
    });
    expect([413, 403]).toContain(res.status());
    if (res.status() === 413) {
      const body = await res.json();
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    }
  });
});

test.describe('Deep Health + Public Status', () => {
  // /health/deep is the monitoring backbone — the /status page, status.projectsites.dev,
  // and external uptime monitors all read it — yet it had NO running regression guard
  // (health.spec covered only the shallow /health). A 500, a silently-dropped dependency
  // check, or a response-shape drift would ship uncaught. Absolute PROD_URL: /health/deep
  // and /status are worker-rendered on the deployed origin only (the local mock serves
  // neither), matching the SPA-shell test's precedent above.
  test('/health/deep returns the full dependency contract (kv+r2+d1+ai)', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/health/deep`);
    // 200 operational OR an honest 503 degraded are BOTH valid — a real dependency outage
    // must not falsely fail this guard (robust-invariant discipline, per the integration
    // -health arc: guard the CONTRACT, not "always healthy").
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(['operational', 'degraded']).toContain(body.status);
    for (const k of ['version', 'environment', 'timestamp', 'region', 'latency_ms', 'checks']) {
      expect(body).toHaveProperty(k);
    }
    // All four dependency probes present + each a valid ok/error signal — guards against a
    // binding check being silently dropped from the sweep.
    for (const dep of ['kv', 'r2', 'd1', 'ai']) {
      expect(body.checks).toHaveProperty(dep);
      expect(['ok', 'error']).toContain(body.checks[dep].status);
    }
  });

  test('/health/deep status code tracks its body (200 operational, 503 degraded)', async ({
    request,
  }) => {
    const res = await resilientGet(request, `${PROD_URL}/health/deep`);
    const body = await res.json();
    // The HTTP status MUST match the body so CF Load Balancer + uptime monitors route correctly.
    if (body.status === 'operational') expect(res.status()).toBe(200);
    if (body.status === 'degraded') expect(res.status()).toBe(503);
  });

  test('/status renders the public status page wired to /health/deep', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/status`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    const html = await res.text();
    // Dependency pills + a 30s refresh from /health/deep — the live wiring, not a static page.
    expect(html).toContain('overall-headline');
    expect(html).toContain('/health/deep');
    expect(html).toMatch(/d1-pill|status-pill/);
  });
});
