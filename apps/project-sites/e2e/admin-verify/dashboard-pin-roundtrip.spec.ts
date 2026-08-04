/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin dashboard hub PIN / favorite
 * toggle, a shell-level, org-data-INDEPENDENT, client-only surface (localStorage
 * `ps_dash_favs`, NO /api write): pinning a section card adds it to the "Pinned"
 * group, the pin button's aria-pressed + aria-label reflect state, and unpinning
 * removes it. A reversible round-trip that restores the initial state.
 *
 * NON-MUTATING (server): pin state is client-only localStorage — each Playwright
 * context is fresh so nothing leaks; the round-trip also unpins. The pin button is
 * `opacity:0` until hover, which Playwright reveals (its click auto-hovers first).
 *
 * @see {@link ./dashboard-hub-search.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const PIN = '[data-testid="dash-pin-code"]'; // the Editor card (glyph 'code'), always in the hub
const pinnedGroup = (page: import('@playwright/test').Page) => page.locator('section[aria-labelledby="grp-pinned"]');

const openHub = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="dash-search"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator(PIN).first().waitFor({ state: 'visible', timeout: 10000 });
};

test.describe('Admin · dashboard hub pin round-trip (P0-ADMIN)', () => {
  test('pinning a card adds it to the Pinned group; unpinning removes it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openHub(page);

    const pin = page.locator(PIN).first();
    // Fresh context → nothing pinned yet.
    await expect(pinnedGroup(page), 'no Pinned group before pinning').toHaveCount(0);
    await expect(pin, 'the pin starts unpressed').toHaveAttribute('aria-pressed', 'false');

    await pin.click();
    await expect(pinnedGroup(page), 'the Pinned group appears after pinning').toBeVisible({ timeout: 4000 });
    await expect(
      pinnedGroup(page).locator('[data-testid="dash-sec-code"]'),
      'the pinned card shows inside the Pinned group',
    ).toBeVisible();
    await expect(page.locator(PIN).first(), 'the pin is now pressed').toHaveAttribute('aria-pressed', 'true');

    // Unpin — round-trip restores the initial state.
    await page.locator(PIN).first().click();
    await expect(pinnedGroup(page), 'the Pinned group is gone after unpinning').toHaveCount(0);
    await expect(page.locator(PIN).first(), 'the pin is unpressed again').toHaveAttribute('aria-pressed', 'false');
  });

  test('the pin button aria-label toggles Pin ⇄ Unpin (a11y state)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openHub(page);

    const pin = page.locator(PIN).first();
    await expect(pin, 'unpinned → aria-label starts with "Pin"').toHaveAttribute('aria-label', /^Pin /);

    await pin.click();
    await expect(page.locator(PIN).first(), 'pinned → aria-label starts with "Unpin"').toHaveAttribute(
      'aria-label',
      /^Unpin /,
    );
    await page.locator(PIN).first().click(); // restore state
  });
});
