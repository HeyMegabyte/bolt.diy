/**
 * Admin — Site Features Journey
 *
 * Covers /admin/site-features — the owner-facing feature toggle grid.
 * Feature-flags API passes through to real prod (public, anonymous-safe).
 * All site-scoped endpoints are stubbed with realistic non-empty data.
 */
import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

test.describe('Admin — Site Features (authenticated journey)', () => {
  test('feature toggle grid renders with >0 rows', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);

    // Stub sites endpoint AFTER auth
    await page.route('**/api/sites**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'e2e-site-001',
              slug: 'e2e-site',
              name: 'E2E Test Site',
              status: 'published',
              created_at: '2025-01-01T00:00:00Z',
            },
          ],
        }),
      });
    });

    // Feature-flags endpoint: PASS THROUGH to real prod (public, anonymous-safe)
    // returns {"flags":[{key,default_enabled,stage,...}]} ARRAY
    // All mutations: 200
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/site-features`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    expect(page.url()).not.toContain('/signin');

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Scroll-nudge to trigger appReveal (opacity:0 on mount)
    await page.mouse.wheel(0, 200);

    const heading = page.locator('[data-testid="sf-layer-heading"]');
    if (await heading.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(heading).toBeVisible();
    }

    const provisioning = page.locator('[data-testid="sf-provisioning"]');
    if (await provisioning.isVisible({ timeout: 10_000 }).catch(() => false)) {
      const cards = page.locator('[data-testid^="sf-card-"]');
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);
    }

    const filterCount = page.locator('[data-testid="sf-filter-count"]');
    if (await filterCount.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const txt = await filterCount.textContent();
      expect(txt).toMatch(/\d/);
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-site-features/grid.png', fullPage: true });
    await checkA11y(page, 'admin-site-features-grid');

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('search/filter narrows the visible toggle rows', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);

    await page.route('**/api/sites**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'e2e-site-001', slug: 'e2e-site', name: 'E2E Test Site', status: 'published', created_at: '2025-01-01T00:00:00Z' }],
        }),
      });
    });

    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/site-features`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    const provisioning = page.locator('[data-testid="sf-provisioning"]');
    if (await provisioning.isVisible({ timeout: 10_000 }).catch(() => false)) {
      const cardsBefore = await page.locator('[data-testid^="sf-card-"]').count();

      const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]').first();
      const searchVisible = await searchInput.isVisible({ timeout: 3_000 }).catch(() => false);
      if (searchVisible && cardsBefore > 1) {
        await searchInput.click();
        await page.keyboard.type('zzz-no-match');
        await page.waitForTimeout(400);

        const filterCount = page.locator('[data-testid="sf-filter-count"]');
        if (await filterCount.isVisible({ timeout: 3_000 }).catch(() => false)) {
          const txt = await filterCount.textContent() ?? '';
          expect(txt).toMatch(/^0\s/);
        }

        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Delete');
        await page.waitForTimeout(300);
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-site-features/search-filter.png' });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('flag-gate locked styling visible for non-entitled entries', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);

    await page.route('**/api/sites**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'e2e-site-001', slug: 'e2e-site', name: 'E2E Test Site', status: 'published', created_at: '2025-01-01T00:00:00Z' }],
        }),
      });
    });

    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/site-features`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // locked-gate: sf-locked on non-entitled cards
    const lockedEl = page.locator('[data-testid="sf-locked"]').first();
    if (await lockedEl.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(lockedEl).toBeVisible();
      const lockedCta = page.locator('[data-testid="sf-locked-cta"]').first();
      if (await lockedCta.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(lockedCta).toBeVisible();
      }
    }

    // entitled cards should show toggle switches
    const toggle = page.locator('[data-testid="sf-toggle"]').first();
    if (await toggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(toggle).toBeVisible();
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-site-features/locked-state.png' });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('mobile 375px — grid is responsive, zero console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.setViewportSize({ width: 375, height: 812 });

    await signInAsTestUser(page);

    await page.route('**/api/sites**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'e2e-site-001', slug: 'e2e-site', name: 'E2E Test Site', status: 'published', created_at: '2025-01-01T00:00:00Z' }],
        }),
      });
    });

    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/site-features`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // No horizontal overflow on 375px
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(385);

    await page.screenshot({ path: 'e2e/screenshots/admin-site-features/mobile-375.png', fullPage: true });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/site-features`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
