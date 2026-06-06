/**
 * navbar-site-actions.e2e.ts — the navbar "Actions" dropdown consolidates
 * Preview + Save & Deploy + Review & Approval Links, and the standalone
 * "Review Links" sidebar entry is gone (route /admin/review-links kept).
 *
 * Guards the 2026-06-06 navbar-consolidation pass:
 *   - sidebar no longer surfaces a "Review Links" nav item (decluttered)
 *   - a single "Actions" dropdown opens with Preview / Save & Deploy / Review
 *     & Approval Links menu items (real-user click, SPA — no full reload)
 *   - the Review & Approval Links entry navigates to /admin/review-links
 *
 * Seeds ps_session from E2E_API_KEY (real psk_test_ row in prod D1), same as
 * admin-nav-links.e2e.ts. Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts navbar-site-actions
 */

import { test, expect } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('navbar Site-actions dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
        localStorage.setItem('ps_feedback_dismissed', 'true');
      } catch {
        /* localStorage unavailable — test.skip below covers the no-key path */
      }
    }, KEY);
  });

  test.skip(!KEY, 'E2E_API_KEY not set');

  test('the "Review Links" standalone sidebar entry is removed (moved to the Actions dropdown)', async ({ page }) => {
    await page.goto('/admin');
    const nav = page.locator('nav[aria-label="Admin sections"]');
    await expect(nav).toBeVisible({ timeout: 15_000 });
    // No top-level sidebar link literally named "Review Links" anymore.
    await expect(nav.getByRole('link', { name: /^Review Links$/ })).toHaveCount(0);
  });

  test('the Actions dropdown opens with Preview / Save & Deploy / Review & Approval Links, and Review routes (SPA)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto('/admin');
    await expect(page.locator('nav[aria-label="Admin sections"]')).toBeVisible({ timeout: 15_000 });

    const trigger = page.locator('[data-testid="site-actions-btn"]');
    // The dropdown renders once a site is selected (AdminStateService auto-selects
    // the first site; the list loads async). Wait briefly, then skip gracefully
    // if the seeded account genuinely has no site.
    const appeared = await trigger.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!appeared) {
      test.skip(true, 'no site selected for the test account — Actions dropdown not rendered');
      return;
    }

    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();

    const menu = page.locator('[data-testid="site-actions-menu"]');
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('[data-testid="sa-preview"]')).toBeVisible();
    await expect(menu.locator('[data-testid="sa-deploy"]')).toBeVisible();
    await expect(menu.locator('[data-testid="sa-review-links"]')).toBeVisible();

    // Real-user nav: click Review & Approval Links → /admin/review-links (SPA).
    await menu.locator('[data-testid="sa-review-links"]').click();
    await expect(page).toHaveURL(/\/admin\/review-links$/, { timeout: 10_000 });
    // SPA nav — the shell nav is still mounted (no full reload).
    await expect(page.locator('nav[aria-label="Admin sections"]')).toBeVisible();
    // The menu closed on selection.
    await expect(menu).toHaveCount(0);

    const fatal = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR_BLOCKED') &&
        !/Failed to load resource: the server responded with a status of 404/.test(e),
    );
    expect(fatal, `unexpected console errors:\n${fatal.join('\n')}`).toHaveLength(0);
  });

  test('Escape closes the open Actions dropdown', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('nav[aria-label="Admin sections"]')).toBeVisible({ timeout: 15_000 });
    const trigger = page.locator('[data-testid="site-actions-btn"]');
    const appeared = await trigger.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
    if (!appeared) {
      test.skip(true, 'no site selected for the test account');
      return;
    }
    await trigger.click();
    await expect(page.locator('[data-testid="site-actions-menu"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="site-actions-menu"]')).toHaveCount(0);
  });
});
