/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the site-detail SQL console (`?tab=sql`,
 * `sql-editor`) enforces its READ-ONLY contract across TDD Contract #10 value-domains.
 * `site-detail-tabs.spec.ts` covers tab navigation only; THIS exercises the injection /
 * write-DDL / malformed value-domains against the real per-site D1 console.
 *
 * Key contract (site-detail.component.ts `runSql()`): a leading write/DDL keyword is
 * BLOCKED CLIENT-SIDE — `sql-error` shows "This console is read-only …" and NO
 * `/sites/:id/sql/exec` POST is made. So the write/DDL sweep is fully deterministic (no
 * network). A SELECT/WITH/EXPLAIN posts to the read-only-enforced endpoint → a calm
 * result or a calm error, never a crash.
 *
 * Site-scoped: discovers the org's first site (skips if none). Read-only — the write
 * queries are rejected before execution; the SELECTs are non-mutating.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./site-detail-tabs.spec.ts}
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

const editor = (page: Page) => page.locator('[data-testid="sql-editor"]');
const sqlError = (page: Page) => page.locator('[data-testid="sql-error"]');
const runBtn = (page: Page) => page.getByRole('button', { name: /^run$|running/i }).first();

/** Open the SQL tab for the org's first site; returns the siteId (or null → skip). */
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
  await editor(page)
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});
  return siteId;
}

test.describe('Admin · site SQL console read-only value-domains (P0-ADMIN)', () => {
  test('the SQL console renders with its read-only pill + safe-note (0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    const siteId = await openSql(page);
    test.skip(!siteId, 'org has no site to drill into');

    await expect(editor(page), 'the SQL editor renders').toBeVisible({ timeout: 12000 });
    await expect(page.locator('[data-testid="sql-readonly-pill"]'), 'the read-only pill renders').toBeVisible();
    await expect(page.locator('[data-testid="sql-safe-note"]'), 'the read-only safe-note renders').toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-sql-console.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('write / DDL queries are blocked CLIENT-SIDE (read-only error, no /sql/exec POST)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    let execPosts = 0;
    page.on('request', (r) => {
      if (/\/sql\/exec/.test(r.url()) && r.method() === 'POST') execPosts++;
    });
    const siteId = await openSql(page);
    test.skip(!siteId, 'org has no site to drill into');
    await expect(editor(page)).toBeVisible({ timeout: 12000 });

    const writes = [
      'DROP TABLE sites',
      'DELETE FROM form_submissions',
      "UPDATE sites SET name='x'",
      "INSERT INTO sites (id) VALUES ('x')",
    ];
    for (const q of writes) {
      execPosts = 0;
      await editor(page).fill(q);
      await runBtn(page).click();
      await expect(sqlError(page), `${q} → the read-only guard fires`).toBeVisible({ timeout: 6000 });
      await expect(sqlError(page), `${q} → error names the read-only contract`).toContainText(/read-only/i);
      expect(execPosts, `${q} must NOT reach the server (blocked client-side) — saw ${execPosts} POST(s)`).toBe(0);
    }
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-sql-readonly-block.png' });
  });

  test('a SELECT runs (read-only endpoint) and injection-shaped input is handled calmly — never crashes', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss().catch(() => {});
    });
    const siteId = await openSql(page);
    test.skip(!siteId, 'org has no site to drill into');
    await expect(editor(page)).toBeVisible({ timeout: 12000 });

    // Each query settles to a calm state: a result table OR the sql-error card — never a
    // crash, a dialog, or a console error. (SELECT is read-only; the injection-shaped ones
    // are rejected by the client guard or errored by the read-only endpoint.)
    const queries = [
      "SELECT name FROM sqlite_master WHERE type='table'",
      `'; DROP TABLE sites;--`,
      `SELECT * FROM users WHERE 1=1 OR 'a'='a'`,
      `${'SELECT 1 -- '.repeat(60)}`,
    ];
    for (const q of queries) {
      await editor(page).fill(q);
      await runBtn(page).click();
      await page.waitForTimeout(1200); // let the run settle (client-block or server round-trip)
      const settled = await page.evaluate(
        () =>
          !!document.querySelector(
            '[data-testid="sql-error"], [data-testid="sql-result-cap"], [data-testid="sql-result-cell"]',
          ),
      );
      expect(settled, `${JSON.stringify(q.slice(0, 30))} settles to a result-or-error, never a hang/crash`).toBe(true);
      await expect(editor(page), 'the SQL console survives the query').toBeVisible();
    }
    expect(dialogFired, 'no query fired a dialog (no script executed)').toBe(false);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-sql-injection.png' });
    expect(errors, `0 console errors across the query sweep — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
