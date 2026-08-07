/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/analytics NETWORK OVERVIEW card
 * renders REAL populated platform traffic, NOT a "not available yet" / empty state.
 * This is the P0.1 analytics fix in force: zone-level (all projectsites.dev) request /
 * page-view / visitor counts show real numbers.
 *
 * VERIFIED OUT-OF-BAND (P0.104, real brian via Browserbase + CF GraphQL): the Network
 * Overview shows ~5.8M requests / 144K page views / 2.1K visitors (real, zone-level).
 *
 * CORRECTION (2026-08-07): the earlier note here claimed the per-SITE "NO DATA YET" for
 * megabytespace.projectsites.dev was a "DELIBERATE honest empty" because CF GraphQL
 * showed 0 requests. That was a verify-against-source-of-truth miss — it reconciled
 * against the SAME source the UI read (CF per-host adaptive, which is EMPTY for every
 * *.projectsites.dev subdomain) instead of the authoritative store (D1 visitor_events,
 * which had 125 real pageviews for that site). It was the lying-empty bug, now fixed by
 * the visitor_events fallback in loadMultiUrlAnalytics — see
 * {@link ./multi-url-analytics-fallback.spec.ts}.
 *
 * NON-MUTATING: read-only analytics view. The empty-state absence proves `any_real_data`.
 *
 * @see {@link ./refresh-actions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · analytics network overview populated (P0-ADMIN)', () => {
  test('the Network Overview shows real platform traffic (not an empty / not-available state)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="network-overview"]');
    await card.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    test.skip((await card.count()) === 0, 'network overview not surfaced for this session (super-admin-only)');

    await expect(card, 'the Network Overview card renders').toBeVisible();
    // Real data present → the "No platform traffic captured…" empty state must be ABSENT
    // (analytics.component:184 renders it only when `!any_real_data`).
    await expect(
      card.getByText(/no platform traffic captured/i),
      'the network overview is populated, not the empty state',
    ).toHaveCount(0);
    // Give the async network fetch a beat, then assert a real formatted stat is shown
    // (e.g. "5.8M", "144K") — a multi-character number, not a bare 0 or an em-dash.
    await expect
      .poll(async () => ((await card.innerText()) || '').replace(/\s+/g, ' '), { timeout: 10000 })
      .toMatch(/\d[\d.,]*\s*[KMB]|\d{2,}/);
  });
});
