/**
 * ADMIN-DASH — /admin/dashboard immersive AI dashboard renders
 *
 * The `/admin/dashboard` path redirects to the admin index (`/admin`), which
 * loads {@link AdminDashboardComponent} — the Perplexity-like surface with a
 * hero prompt, a Features Hub / Feature Flags discovery banner, quick-feature
 * pills, and a bottom-center "Ask anything" search dock.
 *
 * Per [[e2e-tdd-organization]]: goto('/') (via authedPage fixture) → navigate
 * to the sub-route → assert the dashboard shell + key surfaces render.
 *
 * Deterministic (locator waits only), parallel-safe (isolated authed context),
 * stable selectors (aria-label / role / visible text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-DASH — /admin/dashboard immersive AI dashboard renders', () => {
  test('dashboard shell, hero prompt, and ask dock are visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // /admin/dashboard redirects to the admin index which mounts the dashboard.
    await page.goto(`${BASE}/admin/dashboard`);

    // Dashboard section shell (aria-label="Dashboard").
    await expect(page.locator('section.dash[aria-label="Dashboard"]')).toBeVisible({ timeout: 15_000 });

    // Hero prompt heading on the empty (default) state.
    await expect(
      page.locator('h1').filter({ hasText: /Ask anything about your sites/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Bottom-center "Ask anything" search dock input.
    await expect(page.getByRole('combobox', { name: /Ask the dashboard AI/i })).toBeVisible({
      timeout: 10_000,
    });

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });

  test('Features Hub and Feature Flags discovery banner links are present', async ({
    authedPage: page,
  }) => {
    await page.goto(`${BASE}/admin/dashboard`);

    const banner = page.locator('section.features-banner[aria-label="Newly shipped features"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // Two discovery cards: Features Hub + Feature Flags.
    await expect(banner.getByRole('link', { name: /Features Hub/i })).toBeVisible({ timeout: 10_000 });
    await expect(banner.getByRole('link', { name: /Feature Flags/i })).toBeVisible({ timeout: 10_000 });
  });
});
