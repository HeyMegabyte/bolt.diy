/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the snapshot-diff
 * fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/snapshots/diff` (the diff viewer).
 *
 * `snapshots-diff.component.ts`: reads `?from=A&to=B` from the URL → `GET
 * /api/sites/:siteId/snapshots/diff?from=A&to=B` (siteId from the selected site). Without
 * from/to it shows a neutral "pick two" prompt (not the error card), so the spec supplies dummy
 * from/to — the forced 500 fires regardless of ID validity. On failure → `<app-error-card
 * data-testid="snapshots-diff-error" (retry)="load()">`. Site-scoped, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./snapshots-error-state.spec.ts} — the snapshots LIST error-state sibling.
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

test.describe('Admin · Snapshots Diff error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the diff fetch shows a calm error card + Retry (no crash), and Retry re-fetches', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/snapshots\/diff(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/snapshots/diff**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    // Supply dummy from/to so the diff fetch fires (the 500 is injected regardless of ID validity).
    await page.goto('/admin/snapshots/diff?from=e2e-a&to=e2e-b', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="snapshots-diff-error"]');
    await expect(card, 'the diff error card renders on a diff load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the diff request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/snapshots-diff-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
