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
    // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls through
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

    // Heading + search toolbar are unconditional template — hard assertions.
    const heading = page.locator('[data-testid="sf-layer-heading"]');
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[aria-label="Search site features"]')).toBeVisible();

    // The grid always renders >0 rows: the live /api/site-features catalog, or
    // the component's static read-only fallback when the route isn't serving
    // JSON (enterFallbackMode). sf-provisioning is the degraded-only banner —
    // deliberately not asserted either way.
    const cards = page.locator('[data-testid^="sf-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    expect(await cards.count()).toBeGreaterThan(0);

    // sf-filter-count renders only while a search query is active
    // (@if isFiltering()) — with no query typed it must be absent.
    await expect(page.locator('[data-testid="sf-filter-count"]')).toBeHidden();

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

    // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls through
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

    // Grid renders before filtering (live catalog or static fallback).
    const cards = page.locator('[data-testid^="sf-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // Target the section's own search box by its aria-label — a bare
    // input[type=search] .first() can grab the sidebar site-switcher search.
    const searchInput = page.locator('input[aria-label="Search site features"]');
    await expect(searchInput).toBeVisible();
    await searchInput.click();
    await page.keyboard.type('zzz-no-match');

    // isFiltering() flips true → the "0 of N" count chip must render.
    const filterCount = page.locator('[data-testid="sf-filter-count"]');
    await expect(filterCount).toBeVisible({ timeout: 5_000 });
    expect((await filterCount.textContent()) ?? '').toMatch(/^0\s/);

    // Clearing the query hides the chip again (deterministic wait, no sleeps).
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press('Delete');
    await expect(filterCount).toBeHidden({ timeout: 5_000 });

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

    // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls through
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

    // Cards render, and every card shows EITHER a toggle (entitled) or the
    // locked gate — the template @if/@else is exhaustive, so the union is a
    // hard assertion even though which side wins is entitlement data.
    const cards = page.locator('[data-testid^="sf-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid="sf-toggle"], [data-testid="sf-locked"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Branch checks stay conditional (plan-dependent), but each branch's inner
    // structure is asserted hard once that branch renders.
    const lockedEl = page.locator('[data-testid="sf-locked"]').first();
    if (await lockedEl.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // sf-locked-cta is unconditional inside the locked block.
      await expect(page.locator('[data-testid="sf-locked-cta"]').first()).toBeVisible();
    }
    const toggle = page.locator('[data-testid="sf-toggle"]').first();
    if (await toggle.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(toggle).toHaveAttribute('role', 'switch');
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

    // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* falls through
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

    // Page must actually render before the overflow check means anything.
    await expect(page.locator('[data-testid="sf-layer-heading"]')).toBeVisible({ timeout: 15_000 });

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
