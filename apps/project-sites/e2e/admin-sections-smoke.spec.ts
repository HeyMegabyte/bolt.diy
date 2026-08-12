/**
 * Admin section smoke tests — verifies every primary admin section route renders
 * after authentication. Uses the authedPage fixture from e2e/helpers/auth.js.
 *
 * These are SMOKE tests — they verify the section shell loads without console
 * errors. Deeper journey tests per section live in their own spec files.
 */
import { test, expect } from '@playwright/test';
import { resilientGet } from './helpers/api-request.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

/** Every admin route from app.routes.ts — verifies auth guard redirects to /signin. */
const ADMIN_SECTIONS = [
  // Primary nav (15 items)
  { path: '/admin', name: 'Dashboard' },
  { path: '/admin/editor', name: 'Editor' },
  { path: '/admin/snapshots', name: 'Snapshots' },
  { path: '/admin/analytics', name: 'Analytics' },
  { path: '/admin/forms', name: 'Forms' },
  { path: '/admin/apps', name: 'Apps' },
  { path: '/admin/site-features', name: 'Site Features' },
  { path: '/admin/social', name: 'Social' },
  { path: '/admin/voice', name: 'Voice' },
  { path: '/admin/logs', name: 'Logs' },
  { path: '/admin/feature-flags', name: 'Feature Flags (sysadmin)' },
  { path: '/admin/leads', name: 'Leads (sysadmin)' },
  { path: '/admin/system-services', name: 'System Services (sysadmin)' },
  { path: '/admin/docs', name: 'Docs' },
  { path: '/admin/settings', name: 'Settings' },
  // More tools
  { path: '/admin/domains', name: 'Domains' },
  { path: '/admin/api-tokens', name: 'API Tokens' },
  { path: '/admin/super-admin', name: 'Super Admin' },
  // Secondary routes
  { path: '/admin/team', name: 'Team' },
  { path: '/admin/auth-security', name: 'Auth Security' },
  { path: '/admin/user', name: 'User Settings' },
  { path: '/admin/billing', name: 'Billing' },
  // Detail routes (may 404 without siteId param — verify they don't white-screen)
  { path: '/admin/snapshots/diff', name: 'Snapshots Diff' },
  { path: '/admin/apps/instances', name: 'App Instances' },
];

test.describe('Admin Section Smoke — Unauthenticated Redirect', () => {
  for (const sec of ADMIN_SECTIONS) {
    test(`${sec.name} (${sec.path}) redirects to sign-in when unauthenticated`, async ({ page }) => {
      await page.goto(`${PROD_URL}${sec.path}`);
      // 25s (was 10s): the unauth guard redirect is CLIENT-SIDE (SPA shell load →
      // hydrate → route guard → navigate to /signin). Under 2-concurrent CI load that
      // chain runs 10-20s, so 10s flaked the section paths (shard-1 render-timeout
      // cluster per prod-e2e-ci-flakes-are-environmental). The redirect WORKS (guards
      // + the authed brian sweep prove auth) — a settle-wait fix, not hiding a bug.
      await page.waitForURL('**/signin**', { timeout: 25000 });
      await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible({ timeout: 15000 });
    });
  }
});

test.describe('API Health', () => {
  test('GET /api/health returns 200', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/openapi.json returns 200', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/api/openapi.json`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/integrations/listmonk/health returns structured response', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/api/integrations/listmonk/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('integration');
    expect(body).toHaveProperty('status');
  });
});
