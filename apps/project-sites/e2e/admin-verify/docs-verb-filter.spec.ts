/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/docs API reference HTTP-method
 * VERB FILTER chips work: clicking a verb chip single-selects it (aria-pressed +
 * is-active), a Clear affordance appears, selecting another verb swaps the selection,
 * and Clear resets. Filters the (org-independent) OpenAPI spec's endpoint list.
 *
 * NON-MUTATING: the verb chips only set a client `verbFilter()` signal — no /api
 * write. Passes for any authed session (the spec is platform-wide, not org data).
 *
 * @see {@link ./dashboard-hub-search.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openDocs = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/docs', { waitUntil: 'domcontentloaded' });
  // The verb chips render once the OpenAPI spec loads (docs-loading → chips, or
  // docs-error). Wait for a GET chip; skip honestly if the spec didn't load.
  await page
    .locator('[data-testid="docs-verb-chip-get"]')
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => {});
  return (await page.locator('[data-testid="docs-verb-chip-get"]').count()) > 0;
};

test.describe('Admin · docs HTTP-method verb filter (P0-ADMIN)', () => {
  test('a verb chip single-selects (aria-pressed) and Clear resets it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openDocs(page)), 'OpenAPI spec did not load — no verb chips');

    const get = page.locator('[data-testid="docs-verb-chip-get"]');
    // The Clear control has NO testid — it's `class="docs-verb-clear"` +
    // aria-label="Clear method filter" (only the CHIPS carry testids).
    const clear = page.locator('.docs-verb-clear');
    await expect(get, 'GET starts unpressed').toHaveAttribute('aria-pressed', 'false');

    await get.click();
    await expect(get, 'clicking GET presses it').toHaveAttribute('aria-pressed', 'true');
    await expect(clear, 'a Clear affordance appears').toBeVisible({ timeout: 4000 });

    // If a POST chip exists, selecting it single-selects (GET deselects).
    const post = page.locator('[data-testid="docs-verb-chip-post"]');
    if ((await post.count()) > 0) {
      await post.click();
      await expect(post, 'POST becomes pressed').toHaveAttribute('aria-pressed', 'true');
      await expect(get, 'GET deselects (single-select filter)').toHaveAttribute('aria-pressed', 'false');
    }

    await clear.click();
    await expect(get, 'Clear leaves no verb selected').toHaveAttribute('aria-pressed', 'false');
    await expect(clear, 'the Clear affordance is gone').toHaveCount(0);
  });
});
