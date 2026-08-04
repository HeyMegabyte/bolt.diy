/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Lead Scanner (`/admin/leads`): manual
 * scan + OSM auto-scan + leads list. Org-agnostic (e2e-org has 0 leads → empty
 * state). Includes a VALUE-DOMAIN gate test (directive #3) on the scan-query, and
 * NEVER runs a real scan (external API) or pushes a lead to a CRM (see
 * [[admin-verify-e2e-authoring-gotchas]] #5). Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/leads', { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 150, { timeout: 15000 })
    .catch(() => {});
};

test.describe('Admin · Lead Scanner interactions (P0-ADMIN)', () => {
  test('renders the Lead Scanner (leads table OR honest-empty), not the 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/leads');
    await expect(page.getByText(/lead scanner/i).first(), 'the Lead Scanner heading renders').toBeVisible({
      timeout: 8000,
    });
    // The scan controls are the org-agnostic "section rendered" proof (a leads list
    // / empty state only appears after a scan, which we never run).
    await expect(page.locator('[data-testid="leads-scan-query"]'), 'the scan surface renders').toBeVisible({
      timeout: 8000,
    });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('both scan forms (manual + OSM auto) render their controls', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    await expect(page.locator('[data-testid="leads-scan-query"]'), 'the manual scan query renders').toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('[data-testid="leads-osm-metro"]'), 'the OSM metro selector renders').toBeVisible();
    await expect(page.locator('[data-testid="leads-osm-submit"]'), 'the OSM scan button renders').toBeVisible();
  });

  test('value-domain: the manual-scan button gates on a non-empty query (directive #3)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    const query = page.locator('[data-testid="leads-scan-query"]');
    const submit = page.locator('[data-testid="leads-scan-submit"]');

    // Empty query → scan disabled (never fires an external scan).
    await query.fill('');
    await expect(submit, 'an empty query keeps scan disabled').toBeDisabled();

    // A real query → scan enabled (but we never click it — it hits an external API).
    await query.fill('barber shop newark nj');
    await expect(submit, 'a valid query enables the scan').toBeEnabled({ timeout: 6000 });
  });
});
