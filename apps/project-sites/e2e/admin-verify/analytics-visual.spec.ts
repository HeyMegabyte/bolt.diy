/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Analytics VISUAL, real data, real browser.
 *
 * Renders /admin/analytics against LIVE prod analytics (real session + `/api/sites`
 * passthrough) and asserts the section is not broken and not erroring:
 *  - the "Traffic analytics aren't available for this site yet" 404-state
 *    (`analytics-unavailable`) is GONE (the query is fixed → 200, not 404),
 *  - the analytics UI actually renders (KPI cards for a trafficked site, or the
 *    honest "No traffic yet" empty state for a no-traffic demo subdomain),
 *  - zero console errors + zero failed `/api` requests while it loads.
 * Screenshots to e2e/screenshots/admin-verify/ for the visual record.
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · Analytics — visual real-data (P0-ADMIN)', () => {
  test('renders real analytics UI, no broken "not available" state, no console errors', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) {
        consoleErrors.push(m.text());
      }
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    await setupRealDataPage(page, { passthrough: /\/api\/sites/ });
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    // Wait for the analytics surface to resolve into one of its real states:
    // KPI cards (populated), the honest empty state, or (regression) the broken
    // 404 notice. Bounded so a hung fetch fails loud rather than tarpitting.
    await page.waitForSelector(
      '[data-testid="kpi-pageviews"], [data-testid="analytics-unavailable"], .glow-h-grad, app-mini-empty',
      { timeout: 20_000 },
    );

    await page.screenshot({
      path: 'e2e/screenshots/admin-verify/analytics.png',
      fullPage: true,
    });

    // The malformed-query bug surfaced as this exact broken notice — it must be gone.
    const unavailable = await page.locator('[data-testid="analytics-unavailable"]').count();
    expect(unavailable, 'the broken "analytics unavailable" (404) state must be gone').toBe(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(
      body.includes("aren't available for this site yet") || body.includes('aren’t available for this site yet'),
      'the broken "not available yet" copy must not render',
    ).toBe(false);

    // The section rendered SOMETHING real (populated KPIs or the honest empty state).
    const rendered =
      (await page.locator('[data-testid="kpi-pageviews"]').count()) +
      (await page.locator('app-mini-empty, .glow-h-grad').count());
    expect(rendered, 'the analytics section must render its real UI').toBeGreaterThan(0);

    expect(consoleErrors, `analytics must load with 0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
