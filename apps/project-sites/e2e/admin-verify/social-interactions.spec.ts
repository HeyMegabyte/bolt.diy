/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Social section (`/admin/social`).
 * Org-agnostic: the E2E_API_KEY org may have 0 connected accounts. Assert
 * one-of-state + the tab/composer structure; NEVER connect an account or publish
 * a post (see [[admin-verify-e2e-authoring-gotchas]] #5). Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/social', { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 150, { timeout: 15000 })
    .catch(() => {});
};

test.describe('Admin · Social interactions (P0-ADMIN)', () => {
  test('renders with a connected-accounts state (counter / error / 0-connected), not 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/social');
    await expect(page.getByText(/connected/i).first(), 'the connected-accounts summary renders').toBeVisible({
      timeout: 8000,
    });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
    // Never a hard error surface on a healthy load beyond the honest accounts-error note.
  });

  test('the section is interactive (compose/connect controls) and not error-crashed', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    // The full composer/tab surface is account/flag-gated (the e2e-org has 0 connected
    // accounts + social_publishing may be off), so assert the org-agnostic invariant:
    // the section renders actionable controls and never a hard crash.
    const buttons = page.locator('main button, main a[role="button"], main [role="tab"]');
    expect(await buttons.count(), 'the social section exposes interactive controls').toBeGreaterThan(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const phrase of ['something went wrong', 'application error', 'internal server error']) {
      expect(body.includes(phrase), `social must not be crashed: "${phrase}"`).toBe(false);
    }
  });
});
