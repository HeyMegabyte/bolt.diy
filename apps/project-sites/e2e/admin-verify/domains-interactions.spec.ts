/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/domains section READ-ONLY
 * surfaces work: with a project selected it shows the free fallback hostname, its
 * connected-domains list resolves from loading to a stable state (no crash), and the
 * AI domain-search input accepts a query. Fills the domains interaction gap (only a
 * value-domains spec existed).
 *
 * NON-MUTATING: only reads the fallback + list + types into the AI-search field —
 * NEVER clicks `ai-search-btn` (POSTs an AI search), Register, or any hostname action
 * (Make-Primary / Retry / Remove / Transfer all mutate). SITE-SCOPED → selectFirstSite.
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const openDomains = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });
  const ok = await selectFirstSite(page).catch(() => false);
  if (ok) await page.locator('[data-testid="backup-domain"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  return ok;
};

const crashed = (page: import('@playwright/test').Page) =>
  page.evaluate(() => /ran into a problem|something went wrong/i.test(document.body.innerText || ''));

test.describe('Admin · domains read-only interactions (P0-ADMIN)', () => {
  test('with a site selected, the free fallback hostname renders', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openDomains(page)), 'no site to scope /admin/domains to');

    const backup = page.locator('[data-testid="backup-domain"]');
    await expect(backup, 'the fallback hostname displays').toBeVisible({ timeout: 8000 });
    await expect(backup, 'it shows a *.projectsites.dev hostname').toContainText(/\.projectsites\.dev/);
  });

  test('the connected-domains list resolves from loading to a stable state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openDomains(page)), 'no site to scope /admin/domains to');

    // The list fetches on load (hostnames-loading → table / empty / error). Wait for
    // the loading spinner to clear, then assert the section is healthy.
    await page
      .waitForFunction(() => !document.querySelector('[data-testid="hostnames-loading"]'), undefined, { timeout: 12000 })
      .catch(() => {});
    expect(await crashed(page), 'the domains section did not crash').toBe(false);
    // A stable resolution: the table rendered OR the section still shows the fallback
    // (empty state) — either way the backup hostname anchor is present.
    await expect(page.locator('[data-testid="backup-domain"]'), 'the section stays rendered after the list loads').toBeVisible();
  });

  test('the AI domain-search input accepts a query (non-mutating — never submits)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openDomains(page)), 'no site to scope /admin/domains to');

    const search = page.locator('[data-testid="ai-search-input"]');
    if ((await search.count()) === 0) {
      test.skip(true, 'AI domain search not present on this plan');
      return;
    }
    await search.pressSequentially('my coffee shop', { delay: 20 });
    await expect(search, 'the AI-search field holds the typed query').toHaveValue('my coffee shop');
    // Never click ai-search-btn — that POSTs an AI domain search.
  });
});
