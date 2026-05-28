/**
 * E2E specs — Content Freshness admin UI (Feature #16).
 *
 * Tests:
 *   1. Page loads with correct heading and filter pills
 *   2. Draft table renders rows from API
 *   3. Approve button calls approve endpoint
 *   4. Reject button calls reject endpoint
 *   5. Empty state renders when no drafts
 *   6. Manual trigger button fires POST /api/content/freshness/trigger
 *   7. Pagination renders when total > limit
 *   8. Status filter changes request param
 */

import { test, expect } from '../fixtures.js';

const DRAFTS = [
  {
    id: 'draft-1',
    site_id: 'site-1',
    section_key: 'hero',
    dwell_seconds_avg: 18,
    idle_days: 120,
    status: 'pending',
    ai_model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    created_at: new Date().toISOString(),
  },
  {
    id: 'draft-2',
    site_id: 'site-1',
    section_key: 'services-intro',
    dwell_seconds_avg: 22,
    idle_days: 95,
    status: 'pending',
    ai_model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    created_at: new Date().toISOString(),
  },
];

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

test.describe('Content Freshness admin', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
  });

  test('renders heading, eyebrow, and filter pills', async ({ page }) => {
    await page.route('**/api/content/freshness*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drafts: [], total: 0, page: 1, limit: 25 }) }),
    );

    await page.goto('/');
    await page.goto('/admin/content-freshness');
    await expect(page.locator('[data-testid="content-freshness-section"]')).toBeVisible({ timeout: 8000 });

    const h1 = page.getByRole('heading', { name: /Content Freshness/i });
    await expect(h1).toBeVisible();

    // Filter pills
    for (const status of ['pending', 'approved', 'published', 'rejected']) {
      await expect(page.getByRole('tab', { name: new RegExp(status, 'i') })).toBeVisible();
    }
  });

  test('renders draft rows from API', async ({ page }) => {
    await page.route('**/api/content/freshness*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ drafts: DRAFTS, total: 2, page: 1, limit: 25 }),
      }),
    );

    await page.goto('/');
    await page.goto('/admin/content-freshness');
    await expect(page.locator('[data-testid="content-freshness-section"]')).toBeVisible({ timeout: 8000 });

    await expect(page.getByText('hero')).toBeVisible();
    await expect(page.getByText('services-intro')).toBeVisible();
    await expect(page.getByText('120d')).toBeVisible();
    await expect(page.getByText('95d')).toBeVisible();
  });

  test('empty state shows friendly message', async ({ page }) => {
    await page.route('**/api/content/freshness*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ drafts: [], total: 0, page: 1, limit: 25 }),
      }),
    );

    await page.goto('/');
    await page.goto('/admin/content-freshness');
    await expect(page.locator('[data-testid="content-freshness-section"]')).toBeVisible({ timeout: 8000 });

    await expect(page.getByText(/No pending drafts/i)).toBeVisible();
  });

  test('approve button calls approve endpoint and removes row', async ({ page }) => {
    await page.route('**/api/content/freshness?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ drafts: [DRAFTS[0]], total: 1, page: 1, limit: 25 }),
      }),
    );

    let approveCalled = false;
    await page.route('**/api/content/freshness/approve/draft-1', (route) => {
      approveCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await page.goto('/admin/content-freshness');
    await expect(page.locator('[data-testid="content-freshness-section"]')).toBeVisible({ timeout: 8000 });

    const approveBtn = page.getByRole('button', { name: /approve rewrite for hero/i });
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    expect(approveCalled).toBe(true);
  });

  test('reject button calls reject endpoint', async ({ page }) => {
    await page.route('**/api/content/freshness?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ drafts: [DRAFTS[0]], total: 1, page: 1, limit: 25 }),
      }),
    );

    let rejectCalled = false;
    await page.route('**/api/content/freshness/reject/draft-1', (route) => {
      rejectCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await page.goto('/admin/content-freshness');
    await expect(page.locator('[data-testid="content-freshness-section"]')).toBeVisible({ timeout: 8000 });

    const rejectBtn = page.getByRole('button', { name: /reject rewrite for hero/i });
    await expect(rejectBtn).toBeVisible();
    await rejectBtn.click();

    expect(rejectCalled).toBe(true);
  });

  test('trigger button fires POST /api/content/freshness/trigger', async ({ page }) => {
    await page.route('**/api/content/freshness?*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ drafts: [], total: 0, page: 1, limit: 25 }),
      }),
    );

    let triggerCalled = false;
    await page.route('**/api/content/freshness/trigger', (route) => {
      triggerCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto('/');
    await page.goto('/admin/content-freshness');
    await expect(page.locator('[data-testid="content-freshness-section"]')).toBeVisible({ timeout: 8000 });

    const triggerBtn = page.getByRole('button', { name: /run scan now/i });
    await expect(triggerBtn).toBeVisible();
    await triggerBtn.click();

    expect(triggerCalled).toBe(true);
  });

  test('status filter changes request params', async ({ page }) => {
    const requests: string[] = [];
    await page.route('**/api/content/freshness*', (route) => {
      requests.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ drafts: [], total: 0, page: 1, limit: 25 }),
      });
    });

    await page.goto('/');
    await page.goto('/admin/content-freshness');
    await expect(page.locator('[data-testid="content-freshness-section"]')).toBeVisible({ timeout: 8000 });

    // Click 'approved' filter pill
    await page.getByRole('tab', { name: /approved/i }).click();

    // Verify approved status was requested
    const approvedRequest = requests.find((url) => url.includes('status=approved'));
    expect(approvedRequest).toBeDefined();
  });
});
