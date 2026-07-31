/**
 * @fileoverview Authenticated Playwright journey spec for /admin/docs (OpenAPI explorer).
 *
 * Safety: ALL POST/PATCH/DELETE calls to /api/ paths are intercepted and stubbed.
 * No production data is mutated.
 *
 * Coverage:
 *  1. Docs section renders with the search box visible.
 *  2. Left-rail endpoint list renders ≥ 1 endpoint per tag group.
 *  3. Verb filter chips (GET, POST, DELETE) are present and clickable.
 *  4. Search box filters the endpoint rail.
 *  5. axe clean at 1280 and 375 viewports.
 *  6. Console error-free.
 */

import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });
const TEST_EMAIL = 'brian@megabyte.space';

// ---------------------------------------------------------------------------
// Realistic minimal OpenAPI spec stub
// ---------------------------------------------------------------------------
const STUB_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'ProjectSites API', version: '1.0.0' },
  tags: [
    { name: 'auth', description: 'Authentication endpoints' },
    { name: 'sites', description: 'Site management' },
    { name: 'billing', description: 'Billing and subscriptions' },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: { Error: { type: 'object', properties: { error: { type: 'string' } } } },
  },
  paths: {
    '/api/auth/me': {
      get: {
        summary: 'Current session — userId, orgId, email',
        description: 'Returns the authenticated user and org from the Bearer token.',
        tags: ['auth'],
        operationId: 'get_api_auth_me',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'OK' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/api/auth/magic-link': {
      post: {
        summary: 'Send magic-link email',
        description: 'Sends a one-time login link to the given email address.',
        tags: ['auth'],
        operationId: 'post_api_auth_magic_link',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { email: { type: 'string', format: 'email' } },
                required: ['email'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'OK — always returns 200 to prevent enumeration' },
        },
      },
    },
    '/api/sites': {
      get: {
        summary: "List user's sites",
        description: 'Returns all sites owned by the authenticated org.',
        tags: ['sites'],
        operationId: 'get_api_sites',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'OK' },
        },
      },
      post: {
        summary: 'Create a site',
        description: 'Creates a new site row; kicks off the AI generation workflow.',
        tags: ['sites'],
        operationId: 'post_api_sites',
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  name: { type: 'string' },
                },
                required: ['slug', 'name'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '409': { description: 'Slug already taken' },
        },
      },
    },
    '/api/sites/{id}': {
      delete: {
        summary: 'Delete a site',
        description: 'Permanently removes the site and all associated data.',
        tags: ['sites'],
        operationId: 'delete_api_sites_id',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Deleted' },
          '404': { description: 'Not found' },
        },
      },
    },
    '/api/billing/subscription': {
      get: {
        summary: 'Current subscription',
        description: 'Returns the active Stripe subscription state.',
        tags: ['billing'],
        operationId: 'get_api_billing_subscription',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'OK' },
        },
      },
    },
  },
};

const STUB_DOCS_STATS = {
  total_endpoints: 6,
  by_method: { GET: 3, POST: 2, DELETE: 1 },
  last_updated: new Date().toISOString(),
};

async function signInAsAdmin(page: any): Promise<void> {
  // LAST-RESORT /api catch-all — registered FIRST = matched LAST (reverse
  // registration order). Unstubbed /api requests (audit/rows, inbox/tasks, …)
  // must NEVER reach prod: with a fake bearer they 401 and ApiService clears
  // the session -> /signin bounce mid-test.
  await page.route('**/api/**', async (route: any) => {
    const m = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: m === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });

  await page.context().addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: 'e2e-docs-token', id: TEST_EMAIL },
  );

  await page.route('**/api/auth/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user_id: 'e2e-docs',
          email: TEST_EMAIL,
          name: 'E2E Docs User',
          org_id: 'e2e-org',
          is_super_admin: true,
        },
      }),
    });
  });

  // OpenAPI spec endpoint
  await page.route('**/api/admin/docs/openapi.json', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(STUB_OPENAPI),
    });
  });

  // Docs stats endpoint
  await page.route('**/api/admin/docs/stats', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: STUB_DOCS_STATS }),
    });
  });

  // Overview markdown (if fetched)
  await page.route('**/api/admin/docs/app-overview', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          markdown: '# ProjectSites API\n\nFull-stack SaaS website builder.',
          generated_at: new Date().toISOString(),
        },
      }),
    });
  });

  // Standard stubs
  await page.route('**/api/sites**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    });
  });
  await page.route('**/api/billing/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // feature-flags is PUBLIC anonymous-safe — hit REAL prod so gated sections
  // render true prod state (hardcoded flags:{} fakes "not enabled" notices).
  await page.route('**/api/feature-flags**', (route: any) => route.continue());
  await page.route('**/api/admin/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/analytics/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Safety: stub ALL POST/PATCH/DELETE mutations
  await page.route('**', async (route: any) => {
    if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
      const url: string = route.request().url();
      if (url.includes('/api/')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
    }
    await route.fallback();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function goToDocs(page: any): Promise<void> {
  await page.goto(`${PROD_URL}/admin/docs`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test.describe('Admin — Docs (OpenAPI Explorer) journey', () => {
  test('1 — docs section renders with search box visible', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToDocs(page);

    // Search box must be visible once spec loads
    const searchBox = page.getByTestId('docs-search');
    await expect(searchBox).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-docs/01-docs-search.png',
      fullPage: false,
    });
  });

  test('2 — endpoint nav rail renders endpoints from stub spec', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToDocs(page);

    await expect(page.getByTestId('docs-search')).toBeVisible({ timeout: 15_000 });

    // At least one nav endpoint link should appear
    const navEndpoints = page.locator('[data-testid^="docs-nav-endpoint-"]');
    await expect(navEndpoints.first()).toBeVisible({ timeout: 10_000 });
    const count = await navEndpoints.count();
    expect(count, 'should render ≥ 4 endpoint nav items').toBeGreaterThanOrEqual(4);

    await page.screenshot({
      path: 'e2e/screenshots/admin-docs/02-endpoint-nav.png',
      fullPage: false,
    });
  });

  test('3 — verb filter chips GET/POST/DELETE are visible and interactive', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToDocs(page);

    await expect(page.getByTestId('docs-search')).toBeVisible({ timeout: 15_000 });

    // Verb filter chips based on component pattern [attr.data-testid]="'docs-verb-chip-' + v.toLowerCase()"
    const getChip = page.getByTestId('docs-verb-chip-get');
    const postChip = page.getByTestId('docs-verb-chip-post');
    const deleteChip = page.getByTestId('docs-verb-chip-delete');

    await expect(getChip).toBeVisible({ timeout: 10_000 });
    await expect(postChip).toBeVisible({ timeout: 5_000 });
    await expect(deleteChip).toBeVisible({ timeout: 5_000 });

    // Click POST filter — list should narrow
    const navEndpointsBefore = await page.locator('[data-testid^="docs-nav-endpoint-"]').count();
    await postChip.click();
    // After clicking POST, only POST endpoints should show
    await page.waitForTimeout(500); // wait for filter to apply
    const navEndpointsAfter = await page.locator('[data-testid^="docs-nav-endpoint-"]').count();
    // POST endpoints are fewer than all endpoints
    expect(navEndpointsAfter, 'POST filter should narrow the list').toBeLessThan(navEndpointsBefore);

    await page.screenshot({
      path: 'e2e/screenshots/admin-docs/03-verb-filter.png',
      fullPage: false,
    });
  });

  test('4 — search box filters the endpoint rail', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToDocs(page);

    const searchBox = page.getByTestId('docs-search');
    await expect(searchBox).toBeVisible({ timeout: 15_000 });

    const navEndpoints = page.locator('[data-testid^="docs-nav-endpoint-"]');
    const beforeCount = await navEndpoints.count();
    expect(beforeCount, 'should have endpoints before filtering').toBeGreaterThanOrEqual(1);

    // Search for "billing" — narrows to billing endpoints
    await searchBox.fill('billing');
    await page.waitForTimeout(400); // debounce
    const afterCount = await navEndpoints.count();
    expect(afterCount, 'search filter should narrow results').toBeLessThan(beforeCount);
    expect(afterCount, 'at least 1 billing endpoint').toBeGreaterThanOrEqual(1);

    // Clear search — list restores
    await searchBox.clear();
    await page.waitForTimeout(400);
    const clearedCount = await navEndpoints.count();
    expect(clearedCount, 'clearing search restores full list').toBeGreaterThanOrEqual(beforeCount);

    await page.screenshot({
      path: 'e2e/screenshots/admin-docs/04-search-filter.png',
      fullPage: false,
    });
  });

  test('5 — overview link is visible', async ({ page }) => {
    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToDocs(page);

    await expect(page.getByTestId('docs-search')).toBeVisible({ timeout: 15_000 });

    const overviewLink = page.getByTestId('docs-overview-link');
    await expect(overviewLink).toBeVisible({ timeout: 10_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-docs/05-overview-link.png',
      fullPage: false,
    });
  });

  test('6 — axe clean at 1280 and 375 viewports', async ({ page }) => {
    await signInAsAdmin(page);

    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 812 });
      await goToDocs(page);
      await expect(page.getByTestId('docs-search')).toBeVisible({ timeout: 15_000 });

      await checkA11y(page, `docs-${width}px`);

      await page.screenshot({
        path: `e2e/screenshots/admin-docs/06-a11y-${width}.png`,
        fullPage: false,
      });
    }
  });

  test('7 — console is error-free', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsAdmin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${PROD_URL}/admin/docs`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('docs-search')).toBeVisible({ timeout: 15_000 });

    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('posthog') &&
        !e.includes('sentry'),
    );
    expect(realErrors, `Console errors:\n${realErrors.join('\n')}`).toEqual([]);
  });
});
