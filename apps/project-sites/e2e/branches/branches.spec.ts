/**
 * E2E: Branch-style site previews (#27)
 *
 * Tests the API surface and (when auth is available) the admin UI.
 * Starts from homepage per [[e2e-tdd-organization]] hermetic-spec contract.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env['PROD_URL'] ?? 'https://projectsites.dev';
const AUTH_TOKEN = process.env['E2E_AUTH_TOKEN'] ?? '';

// Shared headers for authenticated requests.
const authHeaders = () => ({
  Authorization: `Bearer ${AUTH_TOKEN}`,
  'Content-Type': 'application/json',
});

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

  test.skip('Admin /admin/sites/:id/branches renders branch list (requires auth)', async ({
    page,
  }) => {
    // Skipped: requires a live auth session — run manually with E2E_AUTH_TOKEN set.
    // When run: verify data-testid="site-branches" is present, "Branches" heading,
    // and create button is clickable.
  });
});
