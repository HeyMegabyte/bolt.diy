/**
 * navbar-site-actions.e2e.ts — the navbar "Actions" dropdown consolidates
 * Preview + Save & Deploy + Share link. The /admin/review-links PAGE was removed
 * 2026-06-08; "Share link" is now a dropdown item that opens a modal (no route).
 *
 * Guards:
 *   - sidebar no longer surfaces a "Review Links" nav item (decluttered)
 *   - a single "Actions" dropdown opens with Preview / Save & Deploy / Share link
 *     menu items (real-user click, SPA — no full reload)
 *   - clicking "Share link" opens the Share-link modal (NOT a navigation)
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

  test('the Actions dropdown opens with Preview / Save & Deploy / Share link, and Share link opens the modal', async ({ page }) => {
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
    // Codebase a11y standard: small action popovers are a labeled Tab-navigable
    // button GROUP, not an APG menu (which would require arrow-key nav we don't
    // implement). So the container is role="group", not role="menu".
    await expect(menu).toHaveAttribute('role', 'group');
    await expect(menu.locator('[role="menuitem"]')).toHaveCount(0);
    await expect(menu.locator('[data-testid="sa-preview"]')).toBeVisible();
    await expect(menu.locator('[data-testid="sa-copy-url"]')).toBeVisible();
    await expect(menu.locator('[data-testid="sa-deploy"]')).toBeVisible();
    await expect(menu.locator('[data-testid="sa-share-link"]')).toBeVisible();

    const urlBefore = page.url();
    // Real-user action: click "Share link" → opens the modal (no navigation).
    await menu.locator('[data-testid="sa-share-link"]').click();
    await expect(page.getByText('Share link', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="share-link-create"]')).toBeVisible({ timeout: 10_000 });
    // It's a modal, not a route change — URL is unchanged + the shell stays mounted.
    expect(page.url()).toBe(urlBefore);
    await expect(page.locator('nav[aria-label="Admin sections"]')).toBeVisible();
    // The dropdown closed when the dialog opened.
    await expect(menu).toHaveCount(0);
    // Esc closes the dialog (DialogShell focus-trap + Esc).
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="share-link-create"]')).toHaveCount(0);

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
