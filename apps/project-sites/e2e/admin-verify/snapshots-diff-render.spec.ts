/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Snapshot Diff viewer
 * (`/admin/snapshots/diff`, `snapshots-diff.component`). Coverage gap closed this
 * fire (snapshots-interactions covers the list; the diff had no spec).
 *
 * Enumerated read-only (directive #1). The route renders a CLEAN honest state with
 * NO query params — `needsSelection()` shows the picker + hint (it auto-selects the
 * two most-recent snapshots when ≥2 exist). Uses `ApiService` (bearer-safe, silent).
 * Gates are org-agnostic: the section renders one honest state (hint / pickers /
 * diff / loading), 0 console errors, no error-boundary crash. Non-mutating.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./snapshots-interactions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const NOISE = /Failed to load resource|net::ERR|google-analytics|\/g\/collect|posthog/i;

test.describe('Admin · Snapshot Diff viewer (P0-ADMIN)', () => {
  test('renders the diff section (hint / pickers / diff) with 0 console errors, no crash', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text().slice(0, 140));
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 140)));

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/snapshots/diff', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="snapshots-diff-section"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2200); // let the snapshot list + any auto-selected diff resolve

    const info = await page.evaluate(() => ({
      isAdmin404: /doesn.t exist/i.test(document.body.innerText || ''),
      crashed: /ran into a problem|something went wrong/i.test(document.body.innerText || ''),
      mainLen: (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length,
    }));
    expect(info.isAdmin404, '/admin/snapshots/diff must not be an admin-404').toBe(false);
    expect(info.crashed, 'must not hit the error boundary').toBe(false);
    expect(info.mainLen, 'renders real content').toBeGreaterThan(60);
    expect(consoleErrors, `0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);

    // One honest state shows: the select-two hint, the pickers, or a rendered diff.
    const anyState =
      (await page
        .locator('[data-testid="snapshots-diff-hint"], [data-testid="diff-pickers"], [data-testid="snapshots-diff-loading"]')
        .count()) > 0 ||
      /added|removed|modified|select two/i.test(await page.locator('main').innerText().catch(() => ''));
    expect(anyState, 'the diff surface shows an honest state (hint / pickers / diff)').toBe(true);
  });

  test('the from/to snapshot pickers render (or the hint stands in when there are none)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/snapshots/diff', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="snapshots-diff-section"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2000);

    const pickFrom = page.locator('[data-testid="diff-pick-from"]');
    const hint = page.locator('[data-testid="snapshots-diff-hint"]');
    const hasPickers = (await pickFrom.count()) > 0;
    const hasHint = (await hint.count()) > 0;
    expect(hasPickers || hasHint, 'either the pickers or the select-two hint is present').toBe(true);
    if (hasPickers) {
      await expect(pickFrom.first(), 'the "from" snapshot picker renders').toBeVisible();
      await expect(page.locator('[data-testid="diff-pick-to"]').first(), 'the "to" picker renders').toBeVisible();
    }
  });
});
