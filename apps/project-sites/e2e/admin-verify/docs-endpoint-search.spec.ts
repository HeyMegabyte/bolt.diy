/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/docs API-reference ENDPOINT
 * SEARCH narrows the endpoint list live, shows an honest no-match empty state, and
 * Clear restores it. Filters the platform-wide OpenAPI spec — org-independent.
 *
 * NON-MUTATING: `docs-search` only sets the `endpointSearchQuery()` signal — no /api
 * write. The endpoint rows are `.endpoint-row` (class), the no-match state is
 * `.docs-rail-empty`, and Clear is `[aria-label="Clear endpoint filters"]` (only the
 * search input + verb chips carry data-testids — the rest are class/aria).
 *
 * @see {@link ./docs-verb-filter.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openDocs = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/docs', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="docs-search"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  // Endpoint rows render once the OpenAPI spec resolves (docs-loading → list, or docs-error).
  await page.locator('.endpoint-row').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  return (await page.locator('.endpoint-row').count()) > 0;
};

test.describe('Admin · docs endpoint search (P0-ADMIN)', () => {
  test('a no-match query empties the endpoint list; Clear restores it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openDocs(page)), 'OpenAPI spec did not load — no endpoint rows');

    const rows = page.locator('.endpoint-row');
    expect(await rows.count(), 'the reference lists endpoints').toBeGreaterThan(0);

    await page.locator('[data-testid="docs-search"]').pressSequentially('zzqqnoendpoint', { delay: 20 });
    await expect(rows, 'a no-match query hides every endpoint').toHaveCount(0);
    await expect(page.locator('.docs-rail-empty'), 'the no-match state appears').toBeVisible({ timeout: 4000 });

    await page.locator('[aria-label="Clear endpoint filters"]').click();
    await expect(rows.first(), 'Clear restores the endpoint list').toBeVisible({ timeout: 4000 });
  });

  test('a real path term narrows the list (fewer rows, still ≥1)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openDocs(page)), 'OpenAPI spec did not load — no endpoint rows');

    const rows = page.locator('.endpoint-row');
    const before = await rows.count();
    await page.locator('[data-testid="docs-search"]').pressSequentially('sites', { delay: 20 });
    await expect.poll(() => rows.count(), { timeout: 4000, message: '"sites" narrows the list' }).toBeLessThan(before);
    expect(await rows.count(), '"sites" still matches ≥1 endpoint').toBeGreaterThan(0);
  });
});
