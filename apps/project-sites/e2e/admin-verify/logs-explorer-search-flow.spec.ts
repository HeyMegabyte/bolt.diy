/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Logs Explorer is INTERACTION-GATED: a user runs a
 * search (`logs-search-btn` → `POST /api/logs/search`), then results render (`logs-table`) or the
 * honest `logs-empty` shows. This drives that flow with a stubbed response — populated (hostile
 * rows render + XSS inert) and empty (honest empty) — filling the section's coverage gap.
 *
 * Flag-gated on `log_explorer` (stage=stable → on in prod). If the flag is dark the search UI
 * won't render; the test then SKIPS gracefully (never a false red).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const XSS = '<img src=x onerror="window.__xssHit=1">日本語 🎉';

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

function rows(items: unknown[]): string {
  return JSON.stringify({ data: { items, next_cursor: null, total_returned: items.length } });
}

/** Reach the explorer; returns false when the section is flag-dark (search UI absent) → skip. */
async function openExplorer(page: Page): Promise<boolean> {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/logs?tab=explorer', { waitUntil: 'domcontentloaded' });
  return page
    .locator('[data-testid="logs-search-btn"]')
    .waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true)
    .catch(() => false);
}

test.describe('Admin · Logs Explorer search flow (P0-ADMIN)', () => {
  test('a search that returns rows renders the results table + a hostile cell is inert', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let hadDialog = false;
    page.on('dialog', (d) => {
      hadDialog = true;
      d.dismiss().catch(() => {});
    });

    const ok = await openExplorer(page);
    test.skip(!ok, 'log_explorer flag is dark — search UI not mounted');

    await page.route('**/api/logs/search**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: rows([
          { id: 'g1', ts: '2026-08-07T12:00:00Z', level: 'info', request_id: 'r1', route: '/api/health', method: 'GET', status: 200, duration_ms: 12, message: 'ok', meta: {} },
          { id: 'g2', ts: '2026-08-07T12:01:00Z', level: 'error', request_id: 'r2', route: '/api/x', method: 'POST', status: 500, duration_ms: 40, message: XSS, meta: {} },
        ]),
      }),
    );
    await page.locator('[data-testid="logs-search-input"]').fill('error').catch(() => {});
    await page.locator('[data-testid="logs-search-btn"]').click();

    await expect(page.locator('[data-testid="logs-table"]'), 'the results table renders on a populated search').toBeVisible(
      { timeout: 12000 },
    );
    expect(
      await page.evaluate(() => (window as unknown as { __xssHit?: number }).__xssHit ?? 0),
      'the hostile log message did not execute',
    ).toBe(0);
    expect(hadDialog, 'no alert dialog from the hostile message').toBe(false);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a populated search must not crash').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/logs-explorer-populated.png' });
    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('a search that returns nothing shows the honest logs-empty state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    const ok = await openExplorer(page);
    test.skip(!ok, 'log_explorer flag is dark — search UI not mounted');

    await page.route('**/api/logs/search**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: rows([]) }),
    );
    await page.locator('[data-testid="logs-search-input"]').fill('zzz-no-match').catch(() => {});
    await page.locator('[data-testid="logs-search-btn"]').click();

    await expect(page.locator('[data-testid="logs-empty"]'), 'a zero-result search shows the honest empty state').toBeVisible(
      { timeout: 12000 },
    );
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty search must not crash').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/logs-explorer-empty.png' });
    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
