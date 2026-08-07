/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the copilot-sessions
 * fetch degrades to a calm inline error row + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/sites/:id/copilot` (a site-detail subroute).
 *
 * `site-copilot.component.ts`: on error → a table row `<td data-testid="copilot-load-error">`
 * with a `<button data-testid="copilot-retry" (click)="loadSessions()">`. `ngOnInit` calls
 * `loadSessions()` (`GET /api/sites/:id/copilot/sessions`) → AUTO-LOAD. IMPORTANT: a 404 is
 * treated as a flag-disabled state, so this forces a 500 (the real error path). Site-scoped.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./site-branches-error-state.spec.ts}
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

test.describe('Admin · Site Copilot error-state resilience (P0-ADMIN)', () => {
  test('a 500 on copilot sessions shows a calm error row + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/copilot\/sessions(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const siteId = await firstSiteId(page);
    test.skip(!siteId, 'org has no site to drill into');

    await page.route('**/api/sites/*/copilot/sessions**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto(`/admin/sites/${siteId}/copilot`, { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="copilot-load-error"]');
    await expect(card, 'the copilot error row renders on a sessions load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await page.locator('[data-testid="copilot-retry"]').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the copilot sessions request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-copilot-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
