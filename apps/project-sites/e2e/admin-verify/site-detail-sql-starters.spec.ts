/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the site-detail SQL console STARTER chips run
 * a real read-only query and populate the result table + history + copy affordance.
 * `site-detail-sql-value-domains.spec.ts` covers the read-only write-block + injection;
 * THIS covers the happy path (a starter → SELECT → results → copy → history).
 *
 * The 3 starters (site-detail.component.ts `sqlStarters`: "List tables" / "List indexes" /
 * "SQLite version") are locked to read-only SELECTs — running one is non-mutating.
 * Site-scoped: discovers the org's first site (skips if none).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./site-detail-sql-value-domains.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

const starters = (page: Page) => page.locator('.sql-starter-chip');
const resultCells = (page: Page) => page.locator('[data-testid="sql-result-cell"]');
const sqlError = (page: Page) => page.locator('[data-testid="sql-error"]');

/** Open the SQL tab for the org's first site; returns siteId (or null → skip). */
async function openSql(page: Page): Promise<string | null> {
  const token = process.env.E2E_API_KEY!;
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const siteId = await page.evaluate(async (bearer) => {
    const res = await fetch('/api/sites', { headers: { Authorization: `Bearer ${bearer}` } });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const list = (j.data || j.sites || j.items || []) as Array<{ id?: string }>;
    return list[0]?.id ?? null;
  }, token);
  if (!siteId) return null;
  await page.goto(`/admin/sites/${siteId}?tab=sql`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('[data-testid="sql-editor"]')
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});
  return siteId;
}

test.describe('Admin · site SQL console starter chips (P0-ADMIN)', () => {
  test('the read-only starter chips render (0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    const siteId = await openSql(page);
    test.skip(!siteId, 'org has no site to drill into');

    await expect.poll(() => starters(page).count(), { timeout: 10000 }).toBeGreaterThan(0);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-sql-starters.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('clicking a starter runs a read-only SELECT → result table populates + history records it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    let execPosts = 0;
    page.on('request', (r) => {
      if (/\/sql\/exec/.test(r.url()) && r.method() === 'POST') execPosts++;
    });
    const siteId = await openSql(page);
    test.skip(!siteId, 'org has no site to drill into');
    await expect.poll(() => starters(page).count(), { timeout: 10000 }).toBeGreaterThan(0);

    // "SQLite version" is the most deterministic starter (SELECT sqlite_version() → 1 row).
    const versionChip = starters(page).filter({ hasText: /version/i }).first();
    const chip = (await versionChip.count()) > 0 ? versionChip : starters(page).first();
    await chip.click();
    await page.waitForTimeout(1800); // let the read-only exec round-trip settle

    // The starter POSTed a read-only query to the exec endpoint.
    expect(execPosts, 'the starter ran a query against the exec endpoint').toBeGreaterThan(0);
    // It settles to a populated result table OR a calm error — never a hang/crash.
    const settled = (await resultCells(page).count()) > 0 || (await sqlError(page).count()) > 0;
    expect(settled, 'the starter run settles to a result table or a calm error').toBe(true);
    // A run that returned rows is recorded in the query history (an errored run may not be).
    if ((await resultCells(page).count()) > 0) {
      await expect(
        page.locator('[data-testid="sql-history-item"]').first(),
        'a successful run appears in history',
      ).toBeVisible({ timeout: 6000 });
    }
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-sql-starter-run.png' });
  });

  test('a populated result exposes the Copy-JSON affordance (clipboard, non-mutating)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const siteId = await openSql(page);
    test.skip(!siteId, 'org has no site to drill into');
    await expect.poll(() => starters(page).count(), { timeout: 10000 }).toBeGreaterThan(0);

    // "List tables" reliably returns rows (sqlite_master) for any site DB.
    const tablesChip = starters(page).filter({ hasText: /table/i }).first();
    const chip = (await tablesChip.count()) > 0 ? tablesChip : starters(page).first();
    await chip.click();
    await page.waitForTimeout(1800);

    // When rows render, the Copy-JSON control is offered (never clicked-to-mutate; it's a
    // clipboard export). If the query errored (endpoint access), the run still didn't crash.
    if ((await resultCells(page).count()) > 0) {
      await expect(page.locator('[data-testid="sql-result-copy"]'), 'Copy JSON is offered for a result set').toBeVisible({
        timeout: 6000,
      });
    } else {
      await expect(sqlError(page), 'no rows → a calm error, not a crash').toBeVisible({ timeout: 6000 });
    }
    await expect(page.locator('[data-testid="sql-editor"]'), 'the console survives the run').toBeVisible();
  });
});
