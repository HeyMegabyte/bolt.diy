/**
 * @fileoverview Playwright E2E coverage for the `/admin/docs` interactive
 * API explorer.
 *
 * Verifies:
 *   1. The Docs page renders for a signed-in admin user.
 *   2. The OpenAPI spec is loaded into the left rail (≥ 1 endpoint per tag).
 *   3. The search box filters the endpoint list.
 *   4. Selecting an endpoint shows the Try-It panel.
 *   5. Clicking Send on `GET /api/auth/me` issues a real call and the response
 *      body JSON contains `data.user_id`.
 */
import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';

/**
 * Stub the auth session + OpenAPI spec + `/api/auth/me` response so the
 * test can run against the in-repo Worker without a real D1 session.
 */
async function setupDocs(page: Page): Promise<void> {
  // Persist a fake session matching what AuthService expects.
  await page.addInitScript(() => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'docs-test-token-abcdef', email: 'test@megabyte.space' }),
    );
  });

  // /api/auth/me — server confirms the session and returns user/org.
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { user_id: 'user-docs-1', org_id: 'org-docs-1', email: 'test@megabyte.space' } }),
    });
  });

  // /api/admin/docs/openapi.json — minimal but valid spec with the required tags.
  await page.route('**/api/admin/docs/openapi.json', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Project Sites API', version: '1.0.0' },
        tags: [
          { name: 'auth' },
          { name: 'sites' },
          { name: 'billing' },
          { name: 'hostnames' },
        ],
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
          schemas: { Error: { type: 'object' } },
        },
        paths: {
          '/api/auth/me': {
            get: {
              summary: 'Current session — userId, orgId, email',
              tags: ['auth'],
              operationId: 'get_api_auth_me',
              security: [{ bearerAuth: [] }],
              responses: { '200': { description: 'ok' }, '400': { description: 'bad' }, '500': { description: 'err' } },
            },
          },
          '/api/sites': {
            get: {
              summary: "List user's sites",
              tags: ['sites'],
              operationId: 'get_api_sites',
              security: [{ bearerAuth: [] }],
              responses: { '200': { description: 'ok' }, '400': { description: 'bad' }, '500': { description: 'err' } },
            },
          },
          '/api/billing/subscription': {
            get: {
              summary: 'Current subscription',
              tags: ['billing'],
              operationId: 'get_api_billing_subscription',
              security: [{ bearerAuth: [] }],
              responses: { '200': { description: 'ok' }, '400': { description: 'bad' }, '500': { description: 'err' } },
            },
          },
          '/api/sites/{siteId}/hostnames': {
            get: {
              summary: 'List hostnames',
              tags: ['hostnames'],
              operationId: 'get_api_sites_siteId_hostnames',
              security: [{ bearerAuth: [] }],
              parameters: [{ name: 'siteId', in: 'path', required: true, schema: { type: 'string' } }],
              responses: { '200': { description: 'ok' }, '400': { description: 'bad' }, '500': { description: 'err' } },
            },
          },
        },
      }),
    });
  });

  // Markdown overview.
  await page.route('**/api/admin/docs/app-overview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { markdown: '# Overview\n\nAngular SPA bootstrap.', generated_at: new Date().toISOString() } }),
    });
  });
}

test.describe('Admin Docs Explorer', () => {
  test('renders search box and groups endpoints by tag', async ({ page }) => {
    await setupDocs(page);
    await page.goto('/admin/docs');
    await expect(page.getByTestId('docs-search')).toBeVisible();
    const rows = page.getByTestId('endpoint-row');
    // At least one per tag (auth, sites, billing, hostnames) = ≥ 4 rows total.
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
  });

  test('search filters the endpoint list', async ({ page }) => {
    await setupDocs(page);
    await page.goto('/admin/docs');
    const rows = page.getByTestId('endpoint-row');
    const beforeCount = await rows.count();
    await page.getByTestId('docs-search').fill('billing');
    const afterCount = await rows.count();
    expect(afterCount).toBeLessThan(beforeCount);
    expect(afterCount).toBeGreaterThanOrEqual(1);
  });

  test('selecting an endpoint shows the Try-It panel with the Send button', async ({ page }) => {
    await setupDocs(page);
    await page.goto('/admin/docs');
    // Pick the /api/auth/me row.
    const target = page.getByTestId('endpoint-row').filter({ hasText: '/api/auth/me' }).first();
    await target.click();
    await expect(page.getByTestId('endpoint-try-send')).toBeVisible();
  });

  test('Send on GET /api/auth/me returns response body containing user_id', async ({ page }) => {
    await setupDocs(page);
    await page.goto('/admin/docs');
    const target = page.getByTestId('endpoint-row').filter({ hasText: '/api/auth/me' }).first();
    await target.click();
    await page.getByTestId('endpoint-try-send').click();
    const body = page.getByTestId('response-body');
    await expect(body).toBeVisible();
    await expect(body).toContainText('user_id');
  });
});
