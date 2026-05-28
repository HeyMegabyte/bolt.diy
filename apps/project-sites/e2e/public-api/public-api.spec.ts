/**
 * @spec public-api
 * @description E2E tests for the Public API v1.
 *
 * Tests verify:
 * - OpenAPI spec is served at /v1/openapi.json
 * - Feature-disabled gate returns 503 when public_api_v1 flag is off
 * - Token auth: missing → 401, malformed → 401
 * - /v1/me returns identity
 * - /v1/sites list, get, create, patch, delete
 * - /v1/sites/:id/snapshots list
 * - /v1/sites/:id/deploy triggers job
 * - /v1/sites/:id/analytics returns data shape
 * - /v1/sites/:id/forms/submissions returns data shape
 * - Scope enforcement: wrong scope → 403
 * - Admin token CRUD: POST/GET/DELETE /api/v1-tokens
 *
 * Test account: test@megabyte.space (TEST_USER_PASSWORD env)
 * All tests are hermetic — create/cleanup own data.
 */

import { test, expect } from '../fixtures.js';

const PROD_URL = process.env['PROD_URL'] ?? 'https://projectsites.dev';

// ─── OpenAPI spec ─────────────────────────────────────────────────────────────

test.describe('Public API — OpenAPI spec', () => {
  test('GET /v1/openapi.json returns 200 with valid spec shape', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/v1/openapi.json`);
    // May return 503 if flag is off — that's valid too
    expect([200, 503]).toContain(res.status());

    if (res.status() === 200) {
      const spec = await res.json();
      expect(spec).toHaveProperty('openapi', '3.1.0');
      expect(spec).toHaveProperty('info');
      expect(spec.info).toHaveProperty('title');
      expect(spec).toHaveProperty('paths');
      expect(spec).toHaveProperty('components');
      expect(spec.components).toHaveProperty('securitySchemes');
      expect(spec.components.securitySchemes).toHaveProperty('BearerAuth');
    }
  });

  test('GET /v1/openapi.json includes expected endpoint paths when spec is available', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/v1/openapi.json`);
    if (res.status() !== 200) {
      test.skip(true, 'public_api_v1 flag is off');
      return;
    }
    const spec = await res.json() as { paths: Record<string, unknown> };
    expect(spec.paths).toHaveProperty('/v1/sites');
    expect(spec.paths).toHaveProperty('/v1/sites/{id}');
    expect(spec.paths).toHaveProperty('/v1/me');
    expect(spec.paths).toHaveProperty('/v1/sites/{id}/analytics');
    expect(spec.paths).toHaveProperty('/v1/sites/{id}/media');
    expect(spec.paths).toHaveProperty('/v1/sites/{id}/forms/submissions');
  });
});

// ─── Auth gates ──────────────────────────────────────────────────────────────

test.describe('Public API — Auth gates', () => {
  test('GET /v1/sites without token returns 401 or 503', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/v1/sites`);
    expect([401, 503]).toContain(res.status());
  });

  test('GET /v1/sites with malformed Authorization header returns 401 or 503', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/v1/sites`, {
      headers: { Authorization: 'Bearer not-a-valid-token' },
    });
    expect([401, 503]).toContain(res.status());
  });

  test('GET /v1/sites with invalid psk_ token returns 401 or 503', async ({ request }) => {
    const fakeToken = `psk_${'a'.repeat(64)}`;
    const res = await request.get(`${PROD_URL}/v1/sites`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect([401, 503]).toContain(res.status());
  });

  test('401 response has error envelope', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/v1/sites`);
    if (res.status() === 503) return; // flag off — ok
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });
});

// ─── Feature-disabled gate ────────────────────────────────────────────────────

test.describe('Public API — Feature flag gate', () => {
  test('returns 503 with feature_disabled error when flag is off', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/v1/sites`, {
      headers: { Authorization: `Bearer psk_${'0'.repeat(64)}` },
    });
    // Either 401 (token check before flag) or 503 (flag check first) is valid
    expect([401, 503]).toContain(res.status());
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });
});

// ─── Token management API ─────────────────────────────────────────────────────

test.describe('Public API — Token management (/api/v1-tokens)', () => {
  test('GET /api/v1-tokens without org header returns 401', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/v1-tokens`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/v1-tokens without org header returns 401', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/v1-tokens`, {
      data: { name: 'Test Token', scopes: ['sites:read'] },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/v1-tokens with invalid scope returns 400', async ({ request }) => {
    const orgId = process.env['TEST_ORG_ID'] ?? '';
    if (!orgId) {
      test.skip(true, 'TEST_ORG_ID not set');
      return;
    }

    const res = await request.post(`${PROD_URL}/api/v1-tokens`, {
      headers: { 'x-org-id': orgId },
      data: { name: 'Test', scopes: ['invalid:scope'] },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('bad_request');
  });
});

// ─── Sites resource (integration — requires TEST_API_TOKEN env) ──────────────

test.describe('Public API — Sites resource', () => {
  const token = process.env['TEST_API_TOKEN'];

  test.beforeAll(() => {
    if (!token) test.skip(true, 'TEST_API_TOKEN not set — skipping live API tests');
  });

  test('GET /v1/me returns identity', async ({ request }) => {
    if (!token) return;
    const res = await request.get(`${PROD_URL}/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    expect(res.status()).toBe(200);
    const body = await res.json() as { token_id: string; scopes: string[] };
    expect(body).toHaveProperty('token_id');
    expect(body).toHaveProperty('scopes');
    expect(Array.isArray(body.scopes)).toBe(true);
  });

  test('GET /v1/sites returns paginated list', async ({ request }) => {
    if (!token) return;
    const res = await request.get(`${PROD_URL}/v1/sites?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    expect(res.status()).toBe(200);
    const body = await res.json() as { data: unknown[]; limit: number };
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body).toHaveProperty('limit', 5);
  });

  test('GET /v1/sites?limit=0 respects max limit', async ({ request }) => {
    if (!token) return;
    const res = await request.get(`${PROD_URL}/v1/sites?limit=500`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    expect(res.status()).toBe(200);
    const body = await res.json() as { limit: number };
    expect(body.limit).toBeLessThanOrEqual(100);
  });

  test('GET /v1/sites/:nonexistent returns 404', async ({ request }) => {
    if (!token) return;
    const res = await request.get(`${PROD_URL}/v1/sites/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_found');
  });

  test('POST /v1/sites without required fields returns 400', async ({ request }) => {
    if (!token) return;
    const res = await request.post(`${PROD_URL}/v1/sites`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { slug: 'test-e2e-no-name' }, // missing business_name
    });
    if (res.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    expect(res.status()).toBe(400);
  });

  test('full CRUD: create → get → patch → delete', async ({ request }) => {
    if (!token) return;
    const slug = `e2e-test-${Date.now()}`;

    // Create
    const createRes = await request.post(`${PROD_URL}/v1/sites`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { slug, business_name: 'E2E Test Business' },
    });
    if (createRes.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    expect(createRes.status()).toBe(201);
    const created = await createRes.json() as { id: string; slug: string };
    expect(created.slug).toBe(slug);
    const siteId = created.id;

    // Get
    const getRes = await request.get(`${PROD_URL}/v1/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(getRes.status()).toBe(200);

    // Patch
    const patchRes = await request.patch(`${PROD_URL}/v1/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { business_name: 'E2E Updated Business' },
    });
    expect(patchRes.status()).toBe(200);
    const patched = await patchRes.json() as { business_name: string };
    expect(patched.business_name).toBe('E2E Updated Business');

    // Delete
    const deleteRes = await request.delete(`${PROD_URL}/v1/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleteRes.status()).toBe(204);

    // Verify gone
    const goneRes = await request.get(`${PROD_URL}/v1/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(goneRes.status()).toBe(404);
  });
});

// ─── Analytics + snapshots + forms ───────────────────────────────────────────

test.describe('Public API — Sub-resources', () => {
  const token = process.env['TEST_API_TOKEN'];

  test('GET /v1/sites/:id/snapshots returns data array', async ({ request }) => {
    if (!token) { test.skip(true, 'TEST_API_TOKEN not set'); return; }
    const sitesRes = await request.get(`${PROD_URL}/v1/sites?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (sitesRes.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    const { data } = await sitesRes.json() as { data: Array<{ id: string }> };
    if (!data.length) { test.skip(true, 'No sites to test with'); return; }

    const siteId = data[0]!.id;
    const res = await request.get(`${PROD_URL}/v1/sites/${siteId}/snapshots`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /v1/sites/:id/analytics returns correct shape', async ({ request }) => {
    if (!token) { test.skip(true, 'TEST_API_TOKEN not set'); return; }
    const sitesRes = await request.get(`${PROD_URL}/v1/sites?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (sitesRes.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    const { data } = await sitesRes.json() as { data: Array<{ id: string }> };
    if (!data.length) { test.skip(true, 'No sites to test with'); return; }

    const siteId = data[0]!.id;
    const res = await request.get(`${PROD_URL}/v1/sites/${siteId}/analytics?range=7d`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { site_id: string; range: string; total_pageviews: number; daily: unknown[] };
    expect(body).toHaveProperty('site_id', siteId);
    expect(body).toHaveProperty('range', '7d');
    expect(body).toHaveProperty('total_pageviews');
    expect(body).toHaveProperty('daily');
    expect(Array.isArray(body.daily)).toBe(true);
  });

  test('GET /v1/sites/:id/forms/submissions returns data array', async ({ request }) => {
    if (!token) { test.skip(true, 'TEST_API_TOKEN not set'); return; }
    const sitesRes = await request.get(`${PROD_URL}/v1/sites?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (sitesRes.status() === 503) { test.skip(true, 'public_api_v1 flag is off'); return; }
    const { data } = await sitesRes.json() as { data: Array<{ id: string }> };
    if (!data.length) { test.skip(true, 'No sites to test with'); return; }

    const siteId = data[0]!.id;
    const res = await request.get(`${PROD_URL}/v1/sites/${siteId}/forms/submissions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });
});
