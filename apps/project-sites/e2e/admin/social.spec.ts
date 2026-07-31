/**
 * ADMIN-27 — /admin/social/analytics aggregate social dashboards
 *
 * MODERNIZED 2026-07-31 (residual-admin triage). The old spec targeted the
 * RETIRED route `/admin/social-analytics`; the live route is
 * `social/analytics` ({@link SocialAnalyticsComponent}). The `/admin/social`
 * composer itself is covered by admin-social-journey.spec.ts +
 * admin-social.spec.ts — the ANALYTICS surface had no executing coverage, so
 * this spec owns it: aggregate fetch, time-window switching, empty state, and
 * the error → retry loop.
 *
 * Data contract: GET `/api/social/analytics/aggregate?days=N` →
 * `{ window_days, generated_at, platform_totals[], best_posts[], best_times }`.
 *
 * Contracts under test (hard asserts — stubs make every state deterministic):
 *  1. Aggregate renders: section testid + h1 + per-platform table rows.
 *  2. Window buttons (7d/30d/90d) refetch with the selected `days` param and
 *     move the active state.
 *  3. Empty totals → "No published posts in window." + Compose-one link
 *     SPA-navigates to /admin/social.
 *  4. 500 → error card with error-retry → click retries into the table.
 *
 * House pattern: authedPage fixture; test-body stubs registered AFTER the
 * helper (reverse-registration wins); `?**` glob twins on every route. The
 * time-window nav is buttons (no free-text inputs) → the value-domain
 * contract is exercised via the enumerated window set.
 */

import { test, expect } from '../fixtures.js';
import type { Page, Route } from '@playwright/test';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';

const AGGREGATE = {
  window_days: 30,
  generated_at: '2026-07-30T00:00:00Z',
  platform_totals: [
    { platform: 'x', posts: 12, impressions: 4200, reach: 3100, engagement: 260 },
    { platform: 'linkedin', posts: 5, impressions: 1900, reach: 1500, engagement: 140 },
  ],
  best_posts: [],
  best_times: { platform: 'x', slots: [] },
};

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('posthog') &&
      !e.includes('sentry') &&
      !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource') &&
      !e.includes('Http failure') &&
      !e.includes('ChunkLoadError') &&
      !e.includes('Loading chunk'),
  );
}

/** Stubs the aggregate endpoint. Registered in the test body → beats the helper. */
async function stubAggregate(page: Page, respond: (route: Route) => Promise<void>): Promise<void> {
  await page.route('**/api/social/analytics/aggregate', respond);
  await page.route('**/api/social/analytics/aggregate?**', respond);
}

test.describe('ADMIN-27 — /admin/social/analytics aggregate dashboards', () => {
  test('aggregate renders the section, heading, and per-platform rows', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubAggregate(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AGGREGATE),
      });
    });

    await page.goto(`${BASE}/admin/social/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const section = page.locator('[data-testid="social-analytics-section"]');
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.locator('h1').filter({ hasText: /^Social analytics$/ })).toBeVisible({
      timeout: 10_000,
    });

    // All-platforms table with one row per stubbed platform.
    await expect(section.locator('h2').filter({ hasText: /All platforms/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(section.locator('th[scope="row"]').filter({ hasText: /^x$/ })).toBeVisible();
    await expect(
      section.locator('th[scope="row"]').filter({ hasText: /^linkedin$/ }),
    ).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-social/01-aggregate.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('window buttons refetch with the selected days param', async ({ authedPage: page }) => {
    const errors = collectConsoleErrors(page);
    const seenDays: string[] = [];
    await stubAggregate(page, async (route) => {
      const url = new URL(route.request().url());
      seenDays.push(url.searchParams.get('days') ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AGGREGATE),
      });
    });

    await page.goto(`${BASE}/admin/social/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const windows = page.getByRole('navigation', { name: /Time window/i });
    await expect(windows).toBeVisible({ timeout: 20_000 });

    const btn90 = windows.getByRole('button', { name: /^90d$/ });
    const refetch = page.waitForRequest(
      (req) => req.url().includes('/api/social/analytics/aggregate') && req.url().includes('days=90'),
      { timeout: 10_000 },
    );
    await btn90.click();
    await refetch;

    // Active state moved to the 90d window.
    await expect(btn90).toHaveClass(/active/, { timeout: 5_000 });
    expect(seenDays).toContain('90');

    // Sweep the full enumerated window domain — every option refetches clean.
    await windows.getByRole('button', { name: /^7d$/ }).click();
    await expect(windows.getByRole('button', { name: /^7d$/ })).toHaveClass(/active/, {
      timeout: 5_000,
    });
    await windows.getByRole('button', { name: /^30d$/ }).click();
    await expect(windows.getByRole('button', { name: /^30d$/ })).toHaveClass(/active/, {
      timeout: 5_000,
    });

    await page.screenshot({ path: 'e2e/screenshots/admin-social/02-windows.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('empty totals show the no-posts row whose Compose link goes to /admin/social', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubAggregate(page, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...AGGREGATE, platform_totals: [] }),
      });
    });

    await page.goto(`${BASE}/admin/social/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const empty = page.getByText(/No published posts in window/i);
    await expect(empty).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-social/03-empty.png' });

    // Empty state carries the create-first-result action (Compose one →).
    await page.getByRole('link', { name: /Compose one/i }).click();
    await page.waitForURL(/\/admin\/social(\?|$)/, { timeout: 10_000 });

    expect(realErrors(errors)).toHaveLength(0);
  });

  test('500 shows the error card; retry refetches into the table', async ({
    authedPage: page,
  }) => {
    // TDD-RED (component bug, board Pass-16): a 500 on the aggregate endpoint
    // CRASHES social-analytics into the section error boundary (page snapshot
    // shows the boundary fallback, never the calm "Could not load" card at
    // component.ts:212). errors-as-UX contract violated. Remove when fixed.
    test.fail(true, '500 crashes social-analytics into the section boundary');
    const errors = collectConsoleErrors(page);
    let calls = 0;
    await stubAggregate(page, async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AGGREGATE),
      });
    });

    await page.goto(`${BASE}/admin/social/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Errors-as-UX: the shared error card renders with a Retry affordance.
    await expect(page.getByText(/Could not load/i)).toBeVisible({
      timeout: 20_000,
    });
    const retry = page.locator('[data-testid="error-retry"]').first();
    await expect(retry).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin-social/04-error.png' });

    await retry.click();

    // Second fetch succeeds → the table replaces the error card.
    await expect(
      page.locator('th[scope="row"]').filter({ hasText: /^x$/ }),
    ).toBeVisible({ timeout: 15_000 });
    expect(calls).toBeGreaterThanOrEqual(2);

    await page.screenshot({ path: 'e2e/screenshots/admin-social/05-retried.png' });

    expect(realErrors(errors)).toHaveLength(0);
  });
});
