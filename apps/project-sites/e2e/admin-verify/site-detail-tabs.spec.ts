/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/sites/:id "site detail" TAB
 * strip works: navigating to a real OWNED site's detail page renders the tablist, the
 * four tabs (Logs / Snapshots / SQL / Integrations) switch with aria-selected and
 * their role=tabpanel swaps in, and the `?tab=` deep-link opens a tab directly. A real
 * per-site section verification — the site id is resolved from the org's own sites.
 *
 * NON-MUTATING: only switches tabs + deep-links — NEVER clicks a rollback / connect /
 * Run-SQL action inside a panel. Panels unmount when inactive (`@if (tab() === …)`).
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { resolveFirstSiteId } from '../helpers/site-context.js';

const token = process.env.E2E_API_KEY || '';

const gotoSiteDetail = async (page: import('@playwright/test').Page, query = ''): Promise<string | null> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  const siteId = await resolveFirstSiteId(page, token);
  if (!siteId) return null;
  await page.goto(`/admin/sites/${siteId}${query}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="sd-tab-strip"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  return siteId;
};

test.describe('Admin · site-detail tab strip (P0-ADMIN)', () => {
  test('the detail page opens on the Logs tab by default', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await gotoSiteDetail(page)), 'org has no site to open detail for');

    await expect(page.locator('[data-testid="sd-tab-strip"]'), 'the tablist renders').toBeVisible();
    await expect(page.locator('[data-testid="sd-tab-logs"]'), 'Logs is selected by default').toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-testid="site-logs-panel"]'), 'the Logs panel renders').toBeVisible({ timeout: 8000 });
  });

  test('switching tabs flips aria-selected and swaps the panel (non-mutating)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await gotoSiteDetail(page)), 'org has no site to open detail for');

    await page.locator('[data-testid="sd-tab-sql"]').click();
    await expect(page.locator('[data-testid="sd-tab-sql"]'), 'SQL becomes selected').toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="sd-tab-logs"]'), 'Logs deselects').toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('[data-testid="site-sql-panel"]'), 'the SQL panel swaps in').toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="site-logs-panel"]'), 'the Logs panel unmounts').toHaveCount(0);

    await page.locator('[data-testid="sd-tab-snapshots"]').click();
    await expect(page.locator('[data-testid="sd-tab-snapshots"]'), 'Snapshots becomes selected').toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-testid="site-snapshots-panel"]'), 'the Snapshots panel renders').toBeVisible({
      timeout: 6000,
    });

    await page.locator('[data-testid="sd-tab-integrations"]').click();
    await expect(page.locator('[data-testid="sd-tab-integrations"]'), 'Integrations becomes selected').toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('[data-testid="site-integrations-panel"]'), 'the Integrations panel renders').toBeVisible({
      timeout: 6000,
    });
  });

  test('the ?tab=sql deep-link opens the SQL tab directly', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await gotoSiteDetail(page, '?tab=sql')), 'org has no site to open detail for');

    await expect(page.locator('[data-testid="sd-tab-sql"]'), '?tab=sql selects the SQL tab').toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 8000 },
    );
    await expect(page.locator('[data-testid="site-sql-panel"]'), 'the SQL panel is shown directly').toBeVisible({
      timeout: 6000,
    });
  });
});
