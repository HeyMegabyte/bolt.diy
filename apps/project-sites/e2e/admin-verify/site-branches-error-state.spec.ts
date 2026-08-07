/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the site-branches
 * fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/sites/:id/branches` (a site-detail subroute).
 *
 * `site-branches.component.ts`: `@if (error())` → `<app-error-card data-testid="branches-error"
 * title="Couldn't load branches" (retry)="loadBranches()">`. `ngOnInit` calls `loadBranches()`
 * (`GET /api/sites/:id/branches`) with no tab/interaction gate → AUTO-LOAD. Site-scoped: the
 * spec resolves the org's first site via `/api/sites` (skips if none). No flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./domains-error-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|status of 500|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

async function firstSiteId(page: Page): Promise<string | null> {
  return page.evaluate(async (bearer) => {
    const res = await fetch('/api/sites', { headers: { Authorization: `Bearer ${bearer}` } });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const list = (j.data || j.sites || j.items || []) as Array<{ id?: string }>;
    return list[0]?.id ?? null;
  }, process.env.E2E_API_KEY!);
}

test.describe('Admin · Site Branches error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the branches fetch shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/branches(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const siteId = await firstSiteId(page);
    test.skip(!siteId, 'org has no site to drill into');

    await page.route('**/api/sites/*/branches**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto(`/admin/sites/${siteId}/branches`, { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="branches-error"]');
    await expect(card, 'the branches error card renders on a load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the branches request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-branches-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
