/**
 * admin-nav-links.e2e.ts — the left-nav surfaces every top-level admin section
 *
 * Regression guard for the 2026-06-03 nav-wiring pass: five real, mounted admin
 * sections (Marketplace, Log Explorer, Enterprise, Trust Center, Stripe App) were
 * reachable only by typing the URL — no nav entry, no card, no palette link. This
 * spec asserts each now renders as a clickable left-nav item AND that clicking it
 * lands on the section (real-user navigation, no `page.goto` after the first load).
 *
 * Seeds `ps_session` from `E2E_API_KEY` (a real `psk_test_` key row in prod D1) so
 * the admin shell authenticates without a backdoor — same pattern as
 * admin-a11y.e2e.ts / admin-reflow.e2e.ts. Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test --config=playwright.prod.config.ts admin-nav-links
 */

import { test, expect } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

/** label (visible nav text) → the route it must navigate to */
const NAV_LINKS: ReadonlyArray<{ label: RegExp; path: string }> = [
  { label: /^Marketplace$/, path: '/admin/marketplace' },
  { label: /^Log Explorer$/, path: '/admin/logs' },
  { label: /^Enterprise$/, path: '/admin/enterprise' },
  { label: /^Trust Center$/, path: '/admin/trust' },
  { label: /^Stripe App$/, path: '/admin/stripe-app-status' },
];

test.describe('admin left-nav surfaces every top-level section', () => {
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

  test('the 5 previously-orphaned sections each have a clickable nav item that navigates', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/admin');

    const nav = page.locator('nav[aria-label="Admin sections"]');
    await expect(nav).toBeVisible({ timeout: 15_000 });

    for (const { label, path } of NAV_LINKS) {
      // 1. The nav item exists + is visible (discoverable, not URL-only).
      const link = nav.getByRole('link', { name: label }).first();
      await expect(link, `nav item "${label}" should be present`).toBeVisible();

      // 2. Real-user navigation: click it, assert the URL lands on the section.
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${path.replace(/[/]/g, '\\/')}$`), { timeout: 10_000 });

      // 3. The section shell rendered (the nav is still there → SPA nav, no reload).
      await expect(nav).toBeVisible();
    }

    // Hard-gate real failures (JS exceptions, CSP, Trusted Types) — but tolerate
    // resource-load 404s: flag-gated section reads return 404 BY DESIGN per the
    // feature-flag doctrine (404 not 403, so feature existence never leaks), and
    // each section renders a graceful empty/disabled state for them. The contract
    // this spec guards is nav discoverability + SPA navigation, not data presence.
    const fatal = consoleErrors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('net::ERR_BLOCKED') &&
        !/Failed to load resource: the server responded with a status of 404/.test(e),
    );
    expect(fatal, `unexpected console errors:\n${fatal.join('\n')}`).toHaveLength(0);
  });
});
