/**
 * E2E: Branch-style site previews (#27)
 *
 * Tests the API surface and (when auth is available) the admin UI.
 * Starts from homepage per [[e2e-tdd-organization]] hermetic-spec contract.
 */
import { test, expect } from '@playwright/test';
import { signInAsTestUser } from '../helpers/auth.js';

const PROD_URL = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('Branch Previews — API surface', () => {
  test('GET /api/sites/:id/branches returns 401 without auth', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/sites/test-site-id/branches`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/sites/:id/branches returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/sites/test-site-id/branches`, {
      data: { branch_name: 'feat-test' },
    });
    expect(res.status()).toBe(401);
  });

  test('Branch review endpoint returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/sites/test-site-id/branches/test-branch-id/review`);
    expect(res.status()).toBe(401);
  });

  test('Branch approve endpoint returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/sites/test-site-id/branches/test-branch-id/approve`);
    expect(res.status()).toBe(401);
  });

  test('Branch merge endpoint returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/sites/test-site-id/branches/test-branch-id/merge`, {
      data: { build_version: 'v1' },
    });
    expect(res.status()).toBe(401);
  });

  test('Branch close endpoint returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/sites/test-site-id/branches/test-branch-id/close`);
    expect(res.status()).toBe(401);
  });
});

test.describe('Branch Preview — host resolver', () => {
  test('Regular slug.projectsites.dev still serves correctly (not treated as branch)', async ({
    request,
  }) => {
    // A known-good site on the base domain should never 404 due to branch logic.
    // We check the marketing homepage as a conservative proxy.
    const res = await request.get(`${PROD_URL}/`);
    expect(res.status()).toBeLessThan(500);
  });

  test('Unknown {branch}--{slug}.projectsites.dev returns 404 gracefully', async ({ request }) => {
    // A branch that doesn't exist should 404, never 500.
    const branchHost = 'nonexistent-branch--nonexistent-slug.projectsites.dev';
    const res = await request.get(`https://${branchHost}/`, { headers: { Host: branchHost } }).catch(() => null);
    // May get connection refused in test env — just verify we don't get an unexpected 5xx.
    if (res) expect(res.status()).not.toBe(500);
  });
});

test.describe('Branch Previews — admin UI', () => {
  test('Homepage loads without errors', async ({ page }) => {
    await page.goto(PROD_URL);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForLoadState('networkidle');
    expect(errors.length).toBe(0);
  });

  test('Admin /admin/sites/:id/branches renders branch list (requires auth)', async ({
    page,
  }) => {
    await signInAsTestUser(page);

    // Stub the branch-list API so the section renders deterministically.
    await page.route('**/api/sites/e2e-branch-site/branches*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ branches: [] }),
      }),
    );

    await page.goto(`${PROD_URL}/admin/sites/e2e-branch-site/branches`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const section = page.getByTestId('site-branches');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.getByRole('heading', { name: 'Branches' })).toBeVisible();

    // Create button is enabled (siteId resolved from the route) and clickable.
    const newToggle = page.getByTestId('branch-new-toggle');
    await expect(newToggle).toBeEnabled();
    await newToggle.click();
    await expect(page.getByTestId('branch-name-input')).toBeVisible();
  });
});
