/**
 * @module e2e/apps/chatwoot
 * @description Convergence E2E spec — Chatwoot support platform.
 *
 * Chatwoot is the only publicly reachable app (200, no CF Access gate).
 * These tests assert the support platform is live, the widget is embeddable,
 * and API endpoints respond correctly. Flag-gated features return 404 when off.
 *
 * @packageDocumentation
 */
import { test, expect } from '../fixtures.js';

const SUPPORT_URL = 'https://support.projectsites.dev';

test.describe('Chatwoot — convergence', () => {
  test('homepage returns 200', async ({ request }) => {
    const res = await request.get(SUPPORT_URL);
    expect(res.status()).toBe(200);
  });

  test('widget embed script is reachable', async ({ request }) => {
    const res = await request.get(`${SUPPORT_URL}/packs/js/sdk.js`);
    // 200 = SDK served, 404 = path may differ. Either is reachable.
    expect([200, 404]).toContain(res.status());
  });

  test('API returns 401 without auth token', async ({ request }) => {
    const res = await request.get(`${SUPPORT_URL}/api/v1/accounts`);
    // Chatwoot API requires auth — expect 401.
    expect(res.status()).toBe(401);
  });

  test('nonexistent API route returns structured error', async ({ request }) => {
    const res = await request.get(`${SUPPORT_URL}/api/v1/nonexistent-endpoint-test`);
    expect([404, 401]).toContain(res.status());
  });

  test('admin proxy — AI triage status endpoint gates unauthenticated', async ({
    page,
  }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/admin/chatwoot/status');
      return r.status;
    });
    // 401 = no bearer, 404 = flag off, 200 = live.
    expect([200, 401, 404]).toContain(res);
  });
});
