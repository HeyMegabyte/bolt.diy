/**
 * ADMIN-DASH — /admin Getting Started hub renders
 *
 * The `/admin/dashboard` path redirects to the admin index (`/admin`), which
 * loads {@link AdminDashboardComponent} — the Getting Started hub that replaced
 * the former AI chat dashboard. It introduces every admin section grouped by
 * purpose, surfaces tips, and links out to the most likely next destinations.
 *
 * Per [[e2e-tdd-organization]]: goto('/') (via authedPage fixture) → navigate
 * to the sub-route → assert the hub shell + key surfaces render.
 *
 * Deterministic (locator waits only), parallel-safe (isolated authed context),
 * stable selectors (aria-label / role / visible text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-DASH — /admin Getting Started hub renders', () => {
  test('hub shell, welcome hero, and section guide are visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // /admin/dashboard redirects to the admin index which mounts the hub.
    await page.goto(`${BASE}/admin/dashboard`);

    // Hub section shell (aria-label="Getting started").
    await expect(page.locator('section.dash[aria-label="Getting started"]')).toBeVisible({
      timeout: 15_000,
    });

    // Welcome hero heading.
    await expect(
      page.locator('h1').filter({ hasText: /command center/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Section guide cards link to real admin routes (Editor is always present).
    await expect(page.getByRole('link', { name: /^Editor/ }).first()).toBeVisible({
      timeout: 10_000,
    });

    // The former AI chat surface must be gone — no "Ask anything" dock.
    await expect(page.getByRole('combobox', { name: /Ask the dashboard AI/i })).toHaveCount(0);

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });

  test('Features discovery banner link is present', async ({ authedPage: page }) => {
    await page.goto(`${BASE}/admin/dashboard`);

    const banner = page.locator('section.features-banner[aria-label="Feature control plane"]');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner.getByRole('link', { name: /Features/ }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
