/**
 * Admin section smoke tests — verifies every primary admin section route renders
 * after authentication. Uses the authedPage fixture from e2e/helpers/auth.js.
 *
 * These are SMOKE tests — they verify the section shell loads without console
 * errors. Deeper journey tests per section live in their own spec files.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

/** Admin sections that should render their component shell after auth. */
const ADMIN_SECTIONS = [
  { path: '/admin', name: 'Dashboard', testid: 'app-admin' },
  { path: '/admin/editor', name: 'Editor', testid: 'app-admin' },
  { path: '/admin/snapshots', name: 'Snapshots', testid: 'app-admin' },
  { path: '/admin/analytics', name: 'Analytics', testid: 'app-admin' },
  { path: '/admin/forms', name: 'Forms', testid: 'app-admin' },
  { path: '/admin/apps', name: 'Apps', testid: 'app-admin' },
  { path: '/admin/social', name: 'Social', testid: 'app-admin' },
  { path: '/admin/voice', name: 'Voice', testid: 'app-admin' },
  { path: '/admin/logs', name: 'Logs', testid: 'app-admin' },
  { path: '/admin/docs', name: 'Docs', testid: 'app-admin' },
  { path: '/admin/settings', name: 'Settings', testid: 'app-admin' },
  { path: '/admin/billing', name: 'Billing', testid: 'app-admin' },
  { path: '/admin/domains', name: 'Domains', testid: 'app-admin' },
  { path: '/admin/api-tokens', name: 'API Tokens', testid: 'app-admin' },
  { path: '/admin/user', name: 'User Settings', testid: 'app-admin' },
];

test.describe('Admin Section Smoke — Unauthenticated Redirect', () => {
  for (const sec of ADMIN_SECTIONS) {
    test(`${sec.name} (${sec.path}) redirects to sign-in when unauthenticated`, async ({ page }) => {
      await page.goto(`${PROD_URL}${sec.path}`);
      await page.waitForURL('**/signin**', { timeout: 10000 });
      await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
    });
  }
});

test.describe('API Health', () => {
  test('GET /api/health returns 200', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/openapi.json returns 200', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/openapi.json`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/integrations/listmonk/health returns structured response', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/integrations/listmonk/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('integration');
    expect(body).toHaveProperty('status');
  });
});
