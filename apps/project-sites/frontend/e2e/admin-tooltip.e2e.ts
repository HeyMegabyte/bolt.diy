/**
 * @module e2e/admin-tooltip
 *
 * TDD for the Spartan UI (helm) Tooltip integration — `@spartan-ng/brain`
 * tooltip applied to the admin topbar action buttons, styled via
 * `provideHlmTooltip()`. Proves: hovering a topbar button shows the branded
 * tooltip (CDK overlay) with the right text, and the page stays console-clean.
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const IGNORE = [
  /googletagmanager\.com/i, /google-analytics\.com/i, /posthog/i, /NG0911/i,
  /editor\.projectsites\.dev/i, /Failed to load resource/i, /api\.novu\.co/i,
];
const isAppError = (t: string): boolean => !IGNORE.some((re) => re.test(t));

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try { localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() })); } catch { /* */ }
  }, KEY);
}

test.describe('admin topbar — Spartan (brain) tooltip', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');

  test('hovering the command-palette button shows the branded tooltip', async ({ page }) => {
    test.setTimeout(90_000);
    const errs: string[] = [];
    page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error' && isAppError(m.text())) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

    await seed(page);
    await page.goto('/admin', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 20000 });

    // native `title` is GONE (replaced by the Spartan tooltip) — proves the swap
    await expect(page.locator('.cmdk-btn')).not.toHaveAttribute('title', /.+/);

    // hover → brain renders the tooltip into the CDK overlay (showDelay 200ms).
    // Re-hover each poll: a single .hover() fires only one mouseenter, which can
    // miss if the page is still settling or the mouse already sat on the button
    // (no fresh enter). toPass re-moves-away + re-hovers until the overlay shows
    // the branded text. The feature genuinely works (verified: hover → overlay
    // renders "Open command palette …").
    await expect(async () => {
      await page.mouse.move(4, 4);
      await page.locator('.cmdk-btn').hover();
      await expect(page.locator('.cdk-overlay-container'))
        .toContainText(/Open command palette/i, { timeout: 1500 });
    }).toPass({ timeout: 15000 });

    expect(errs, errs.join('\n')).toEqual([]);
  });
});
