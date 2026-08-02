/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Network Overview card shows REAL
 * platform-wide traffic in a REAL browser.
 *
 * Brian's account's sites are all zero-traffic demo subdomains, so the per-site
 * analytics panel legitimately renders empty — an operator never SEES analytics
 * working. The Network Overview card (zone-level `httpRequests1dGroups` for the
 * whole projectsites.dev zone) fixes that: it's always visible above the
 * per-site panel and shows the real platform totals (millions of requests, tens
 * of thousands of page views). This asserts, against LIVE prod:
 *  - the `network-overview` card renders,
 *  - `net-requests` shows a real, non-zero count (the platform has real traffic),
 *  - the envelope's `any_real_data` is true when hit directly,
 *  - zero console errors while it loads.
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

test.describe('Admin · Analytics — Network Overview shows real platform traffic (P0-ADMIN)', () => {
  test('the network-overview card renders real, non-zero platform requests', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) {
        consoleErrors.push(m.text());
      }
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));

    // Let BOTH the per-site analytics call and the zone-level network call hit
    // real prod (authed → real data); stub everything else.
    await setupRealDataPage(page, { passthrough: /\/api\/(network-analytics|sites)/ });
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="network-overview"]');
    await card.waitFor({ state: 'visible', timeout: 20_000 });

    // The requests stat must resolve to a real, non-zero count. Poll until the
    // async fetch populates it (starts at "0" before the network call returns).
    await expect
      .poll(async () => parseCount(await page.locator('[data-testid="net-requests"] .net-num').innerText()), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await page.screenshot({
      path: 'e2e/screenshots/admin-verify/network-overview.png',
      fullPage: true,
    });

    const requests = parseCount(await page.locator('[data-testid="net-requests"] .net-num').innerText());
    expect(requests, 'Network Overview must show real platform requests (>0)').toBeGreaterThan(0);

    // The empty state must NOT be showing when there's real traffic.
    expect(await page.locator('.net-empty').count(), 'no "no traffic" empty state with real data').toBe(0);

    expect(consoleErrors, `Network Overview must load with 0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('the /api/analytics/network endpoint returns a real-data envelope', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const result = await page.evaluate(async (bearer) => {
      const res = await fetch('/api/network-analytics?range=7d', {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, token);

    expect(result.status, 'network analytics endpoint must be 200').toBe(200);
    const env = (result.body as { data?: Record<string, unknown> } | null)?.data;
    expect(env, 'envelope present').toBeTruthy();
    expect(typeof env!['total_requests'], 'total_requests is a number').toBe('number');
    expect(env!['zone'], 'zone is projectsites.dev').toBe('projectsites.dev');
    // The platform has real traffic → any_real_data must be true + requests > 0.
    expect(env!['any_real_data'], 'platform has real traffic').toBe(true);
    expect(env!['total_requests'] as number, 'real request count').toBeGreaterThan(0);
  });
});
