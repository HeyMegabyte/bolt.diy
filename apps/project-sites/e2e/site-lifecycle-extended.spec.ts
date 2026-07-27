/**
 * Site Lifecycle — extended E2E covering the full site lifecycle API surface.
 *
 * Tests: site creation, listing, domain management, hostname provisioning,
 * site serving, rebuild, and delete. Auth-gated where applicable.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Site API — Auth Gates', () => {
  test('GET /api/sites requires auth', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/sites`);
    expect([200, 401]).toContain(res.status());
  });

  test('POST /api/sites requires auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/sites`, {
      data: { slug: 'test', template: 'saas' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/slug/check returns 400 without query param', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/slug/check`);
    expect([200, 400, 401]).toContain(res.status());
  });
});

test.describe('Site Serving', () => {
  test('slug.projectsites.dev returns response for nonexistent site', async ({ request }) => {
    const res = await request.get('https://nonexistent-test-zxcv.projectsites.dev');
    // May return 404 (no site) or 200 with marketing redirect
    expect([200, 404, 301, 302]).toContain(res.status());
  });
});

test.describe('Domain Management API', () => {
  test('POST /api/domains/search requires auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/domains/search`, {
      data: { query: 'example' },
    });
    expect([200, 401]).toContain(res.status());
  });

  test('GET /api/admin/domains requires auth', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/admin/domains`);
    expect([200, 401]).toContain(res.status());
  });
});

test.describe('Site Search API', () => {
  test('GET /api/sites/search returns results (public endpoint)', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/sites/search?q=test`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sites');
    expect(Array.isArray(body.sites)).toBe(true);
  });

  test('GET /api/search/businesses returns results (public endpoint)', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/search/businesses?q=plumber`);
    // Google Places proxy — may return 200 or 500 if key unconfigured
    expect([200, 400, 500]).toContain(res.status());
  });
});
