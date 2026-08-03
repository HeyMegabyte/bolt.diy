/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Email Deliverability wizard (#12)
 * renders, works, and returns REAL data in a REAL browser.
 *
 * The `/admin/deliverability` route was missing from `app.routes.ts` (admin-404)
 * despite the component + worker route + flag all existing; the route is now
 * wired + nav-linked. This asserts, against LIVE prod (authed real session):
 *  - the section renders (heading + form), not an admin-404, 0 console errors,
 *  - the "empty domain" value-domain (Check with no domain, brian's site has no
 *    custom sending domain) shows the CALM NEUTRAL prompt (not a red error) and
 *    logs NO failed request — the worker returns 200 `{ needsDomain: true }`,
 *  - the "valid domain" value-domain (`?domain=megabyte.space`) returns a real,
 *    fully-populated SPF/DKIM/DMARC report (score + per-record presence).
 *
 * @see {@link ../../src/routes/email_deliverability.ts}
 * @see {@link ../../frontend/src/app/pages/admin/sections/deliverability.component.ts}
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · Email Deliverability wizard renders + returns real data (P0-ADMIN)', () => {
  test('the section renders + the empty-domain check shows the calm neutral prompt (no red error, no console 400)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

    const consoleErrors: string[] = [];
    const failed: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('response', (res) => {
      if (res.status() >= 400 && /\/api\/sites\/[^/]+\/deliverability/.test(res.url())) {
        failed.push(`${res.status()} ${res.url()}`);
      }
    });

    await setupRealDataPage(page, { passthrough: /\/api\/(sites|feature-flags)/ });
    await page.goto('/admin/deliverability', { waitUntil: 'domcontentloaded' });

    // Not an admin-404, and the section heading renders.
    await expect(page.locator('[data-testid="deliv-heading"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/doesn.t exist/i)).toHaveCount(0);

    // brian's site auto-selects → the form renders (not the "select a site" empty state).
    const checkBtn = page.locator('[data-testid="deliverability-check-btn"]');
    await checkBtn.waitFor({ state: 'visible', timeout: 15_000 });

    // The empty-domain value-domain: Check with no domain (site has no custom
    // sending domain) → the CALM neutral prompt, never a red error card.
    await checkBtn.click();
    await expect(page.locator('[data-testid="deliverability-no-domain"]')).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('[data-testid="deliverability-error"]').count(), 'no red error card on the no-domain path').toBe(0);
    expect(await page.locator('[data-testid="deliverability-result"]').count(), 'no result without a domain').toBe(0);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/deliverability.png', fullPage: true });

    // The no-domain path returns a clean 200 → no failed request is logged.
    expect(failed, `no-domain check must NOT log a failed request — saw ${failed.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `deliverability must load with 0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('the deliverability endpoint covers both value-domains: 200 needsDomain (empty) + 200 real report (valid)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async (bearer) => {
      const H = { Authorization: `Bearer ${bearer}` };
      const sitesRes = await fetch('/api/sites', { headers: H });
      const sitesJson = (await sitesRes.json().catch(() => ({}))) as Record<string, unknown>;
      const list = (sitesJson.data || sitesJson.sites || sitesJson.items || []) as Array<{ id?: string }>;
      const siteId = list[0]?.id ?? null;
      if (!siteId) return { siteId: null };

      const noDom = await fetch(`/api/sites/${siteId}/deliverability`, { headers: H });
      const noDomBody = (await noDom.json().catch(() => ({}))) as Record<string, unknown>;
      const withDom = await fetch(`/api/sites/${siteId}/deliverability?domain=megabyte.space`, { headers: H });
      const withDomBody = (await withDom.json().catch(() => ({}))) as { report?: Record<string, unknown> };
      return {
        siteId,
        noDom_status: noDom.status,
        noDom_needsDomain: noDomBody['needsDomain'] === true,
        noDom_report: noDomBody['report'],
        withDom_status: withDom.status,
        withDom_hasReport: !!withDomBody.report,
        withDom_domain: withDomBody.report?.['domain'] ?? null,
        withDom_score: withDomBody.report?.['score'] ?? null,
      };
    }, token);

    expect(result.siteId, 'brian has at least one site').toBeTruthy();

    // Empty-domain value-domain: a clean 200 with { report: null, needsDomain: true } — NEVER a 4xx.
    expect(result.noDom_status, 'no-domain check is a clean 200 (not a 4xx)').toBe(200);
    expect(result.noDom_needsDomain, 'no-domain check flags needsDomain').toBe(true);
    expect(result.noDom_report, 'no-domain check has a null report').toBeNull();

    // Valid-domain value-domain: a real, populated SPF/DKIM/DMARC report.
    expect(result.withDom_status, 'valid-domain check is 200').toBe(200);
    expect(result.withDom_hasReport, 'valid-domain check returns a populated report').toBe(true);
    expect(result.withDom_domain, 'report is for the requested domain').toBe('megabyte.space');
    expect(typeof result.withDom_score, 'report carries a numeric score').toBe('number');
  });
});
