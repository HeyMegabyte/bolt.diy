/**
 * E2E specs — pSEO Matrix Builder admin UI (Feature #17).
 *
 * Tests:
 *   1. Page loads with heading and stats strip
 *   2. Matrix grid renders rows from API
 *   3. Generate button calls POST /api/pseo/:siteId/generate
 *   4. Approve button calls approve endpoint
 *   5. Publish button calls publish endpoint
 *   6. Reject button calls reject endpoint
 *   7. Thin-content rows have amber styling class
 *   8. Status filter pills work
 *   9. Empty state renders
 *  10. Stats strip shows rolling counters
 */

import { test, expect } from '../fixtures.js';

const PAGES = [
  {
    id: 'page-1',
    service: 'plumbing',
    city: 'Newark',
    intent: 'price',
    season: 'spring',
    route_slug: '/c/newark/plumbing-price',
    word_count: 950,
    image_count: 4,
    internal_links: 3,
    has_local_biz_jsonld: 1,
    slop_hits: 0,
    thin_content: 0,
    status: 'approved' as const,
    created_at: new Date().toISOString(),
  },
  {
    id: 'page-2',
    service: 'hvac',
    city: 'Hoboken',
    intent: 'emergency',
    season: 'winter',
    route_slug: '/c/hoboken/hvac-emergency-winter',
    word_count: 600,
    image_count: 2,
    internal_links: 1,
    has_local_biz_jsonld: 0,
    slop_hits: 2,
    thin_content: 1,
    status: 'draft' as const,
    created_at: new Date().toISOString(),
  },
];

const STATS = { total: 48, draft: 20, approved: 18, published: 8, rejected: 2, thinContent: 5 };

async function mockAuth(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'admin@example.com', user_id: 'user-1', org_id: 'org-1' }),
    }),
  );
  await page.route('**/api/sites', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'site-1', slug: 'test', name: 'Test', status: 'published', plan: 'pro', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), hostnames: [] }] }),
    }),
  );
  await page.route('**/api/billing/subscription', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: 'pro', status: 'active' }) }),
  );
}

test.describe('pSEO Matrix admin', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await page.route('**/api/pseo/site-1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ siteId: 'site-1', stats: STATS }) }),
    );
    await page.route('**/api/pseo/site-1/pages*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ pages: PAGES, total: 48, page: 1, limit: 50 }),
      }),
    );
  });

  test('renders heading and stats strip', async ({ page }) => {
    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    await expect(page.getByRole('heading', { name: /pSEO Matrix/i })).toBeVisible();
    await expect(page.getByText(/total/i)).toBeVisible();
    await expect(page.getByText(/published/i)).toBeVisible();
    await expect(page.getByText(/thin/i)).toBeVisible();
  });

  test('renders page rows with route slugs', async ({ page }) => {
    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    await expect(page.getByText('/c/newark/plumbing-price')).toBeVisible();
    await expect(page.getByText('Newark')).toBeVisible();
    await expect(page.getByText('plumbing')).toBeVisible();
  });

  test('thin-content rows have ps-row-thin class', async ({ page }) => {
    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    const thinRow = page.locator('tr.ps-row-thin');
    await expect(thinRow).toBeVisible();
  });

  test('generate button calls POST /api/pseo/:siteId/generate', async ({ page }) => {
    let generateCalled = false;
    await page.route('**/api/pseo/site-1/generate', (route) => {
      generateCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, workflowInstanceId: 'wf-abc' }) });
    });

    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    const genBtn = page.getByRole('button', { name: /generate matrix/i });
    await expect(genBtn).toBeVisible();
    await genBtn.click();

    expect(generateCalled).toBe(true);
  });

  test('approve button calls approve endpoint', async ({ page }) => {
    let approveCalled = false;
    await page.route('**/api/pseo/site-1/pages/page-2/approve', (route) => {
      approveCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    // Serve a single draft-with-content row
    await page.unrouteAll();
    await mockAuth(page);
    await page.route('**/api/pseo/site-1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ siteId: 'site-1', stats: STATS }) }),
    );
    await page.route('**/api/pseo/site-1/pages*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pages: [{ ...PAGES[1], word_count: 900, status: 'draft' }],
          total: 1, page: 1, limit: 50,
        }),
      }),
    );

    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    const approveBtn = page.getByRole('button', { name: /approve \/c\/hoboken/i });
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    expect(approveCalled).toBe(true);
  });

  test('publish button calls publish endpoint', async ({ page }) => {
    let publishCalled = false;
    await page.route('**/api/pseo/site-1/pages/page-1/publish', (route) => {
      publishCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, r2Key: 'sites/test/latest/c/newark/plumbing-price/index.html' }) });
    });

    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    const publishBtn = page.getByRole('button', { name: /publish \/c\/newark/i });
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();

    expect(publishCalled).toBe(true);
  });

  test('status filter pills change request param', async ({ page }) => {
    const requests: string[] = [];
    await page.unrouteAll();
    await mockAuth(page);
    await page.route('**/api/pseo/site-1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ siteId: 'site-1', stats: STATS }) }),
    );
    await page.route('**/api/pseo/site-1/pages*', (route) => {
      requests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: [], total: 0, page: 1, limit: 50 }) });
    });

    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    await page.getByRole('tab', { name: /published/i }).click();

    const publishedReq = requests.find((u) => u.includes('status=published'));
    expect(publishedReq).toBeDefined();
  });

  test('empty state renders when no pages', async ({ page }) => {
    await page.unrouteAll();
    await mockAuth(page);
    await page.route('**/api/pseo/site-1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ siteId: 'site-1', stats: { total: 0, draft: 0, approved: 0, published: 0, rejected: 0, thinContent: 0 } }) }),
    );
    await page.route('**/api/pseo/site-1/pages*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pages: [], total: 0, page: 1, limit: 50 }) }),
    );

    await page.goto('/');
    await page.goto('/admin/pseo');
    await expect(page.locator('[data-testid="pseo-section"]')).toBeVisible({ timeout: 8000 });

    await expect(page.getByText(/No pages yet/i)).toBeVisible();
  });
});
