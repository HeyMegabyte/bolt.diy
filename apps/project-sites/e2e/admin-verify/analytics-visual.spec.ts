/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Analytics VISUAL, real data, real browser.
 *
 * Renders /admin/analytics against LIVE prod and asserts the section shows REAL,
 * populated analytics with no errors. The robust proof is the always-visible
 * **Network Overview** card: zone-level platform traffic that is NOT flag-gated
 * and NOT site-scoped, so it shows real numbers regardless of which site is
 * selected or whether the per-site `site_analytics` flag is on.
 *
 * NOTE on the per-site panel: `GET /api/sites/:id/analytics` is served by the
 * flag-gated `site_analytics` feature (libs/features/site_analytics), which
 * returns 404 → the "aren't available for this site yet" notice when that flag
 * is OFF for the org. That is CORRECT flag-off behavior (feature-flags doctrine:
 * 404 when off, never 403), not a bug — so this spec does NOT assert its
 * absence (that made the test brittle to the flag's rollout state, and the old
 * multi_url_analytics path it guarded is shadowed by site_analytics anyway).
 * The Network Overview card is the stable, always-on analytics surface to verify.
 *
 * @see {@link ../../src/services/network_analytics.ts}
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Parse a formatted count ("3.0M", "78.5K", "1,234") back to a number. */
function parseCount(text: string): number {
  const t = text.trim().replace(/,/g, '');
  const m = /^([\d.]+)\s*([KMB])?$/i.exec(t);
  if (!m) return Number.isFinite(Number(t)) ? Number(t) : 0;
  const n = Number(m[1]);
  const mult = m[2]?.toUpperCase() === 'B' ? 1e9 : m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'K' ? 1e3 : 1;
  return n * mult;
}

test.describe('Admin · Analytics — visual real-data (P0-ADMIN)', () => {
  test('renders real, populated analytics (Network Overview), no console errors', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) {
        consoleErrors.push(m.text());
      }
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    // Both the zone-level network call and the per-site call hit real prod.
    await setupRealDataPage(page, { passthrough: /\/api\/(network-analytics|sites)/ });
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    // The always-on Network Overview card is the stable real-analytics surface.
    const card = page.locator('[data-testid="network-overview"]');
    await card.waitFor({ state: 'visible', timeout: 20_000 });

    // Its requests stat must resolve to a real, non-zero platform count (poll —
    // the async fetch populates it after mount, starting from "0").
    await expect
      .poll(async () => parseCount(await page.locator('[data-testid="net-requests"] .net-num').innerText()), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await page.screenshot({
      path: 'e2e/screenshots/admin-verify/analytics.png',
      fullPage: true,
    });

    const requests = parseCount(await page.locator('[data-testid="net-requests"] .net-num').innerText());
    expect(requests, 'Analytics must show real, populated platform traffic').toBeGreaterThan(0);

    expect(consoleErrors, `analytics must load with 0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
