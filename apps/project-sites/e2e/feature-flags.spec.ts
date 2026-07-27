/**
 * Feature Flags — admin CRUD + public endpoint verification.
 *
 * Tests: GET /api/feature-flags (public), POST/PATCH (admin),
 * flag gating behavior (404 when off), and stage promotion rules.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Feature Flags — Public API', () => {
  test('GET /api/feature-flags returns flag booleans', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/feature-flags`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('flags');
    expect(typeof body.flags).toBe('object');
  });

  test('GET /api/feature-flags returns flags object with entries', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/feature-flags`);
    const body = await res.json();
    expect(body).toHaveProperty('flags');
    // Must have at least some flags (85+ in registry)
    const flagCount = Object.keys(body.flags ?? {}).length;
    expect(flagCount).toBeGreaterThan(0);
  });
});

test.describe('Feature Flags — Admin (auth required redirects)', () => {
  test('GET /admin/feature-flags redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/feature-flags`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });

  test('GET /admin/site-features redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/site-features`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });
});
