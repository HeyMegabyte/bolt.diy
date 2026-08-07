/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the per-SITE multi-URL analytics
 * endpoint (`GET /api/sites/:id/multi-url-analytics`, powering the analytics
 * page's per-site aggregate) surfaces REAL first-party traffic for
 * `*.projectsites.dev` subdomain sites instead of lying empty.
 *
 * THE BUG (root-caused 2026-08-07): `loadMultiUrlAnalytics` read ONLY Cloudflare
 * `httpRequestsAdaptiveGroups` filtered by `clientRequestHTTPHost`. That dataset
 * is EMPTY for `*.projectsites.dev` subdomains (every generated site shares the
 * one zone; the host filter matches nothing), so a subdomain site with real
 * pageviews in D1 `visitor_events` returned `any_real_data:false` + zeros — a
 * textbook lying-empty (verify-against-source-of-truth). A PRIOR fire even
 * mislabelled megabytespace.projectsites.dev's "NO DATA YET" as an honest empty
 * because it reconciled against the SAME source the UI reads (CF GraphQL: 0
 * requests) instead of the authoritative store (D1: 125 real pageviews).
 *
 * THE FIX: `loadMultiUrlAnalytics` now falls back to `visitor_events` (by
 * `site_id`) when CF yields no real data — mirroring the network-overview
 * fallback. See `src/services/multi_url_analytics.ts` § visitorEventsFallback +
 * `src/__tests__/multi_url_analytics_load.test.ts`.
 *
 * This prod-layer guard reconciles DISPLAY (the live endpoint) against STORE
 * (D1 visitor_events): a site with a real historical pageview must show
 * `any_real_data:true`. NON-MUTATING (read-only GET). `exclude=` is a fixed
 * cache-bust dimension so the assertion sees a freshly-computed envelope, not a
 * stale pre-fix cache. Uses e2e-site-1 (accessible to the E2E org; has 1 real
 * pageview dated 2026-06-20 — stable historical data).
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const SITE = 'e2e-site-1'; // E2E-org site with 1 real visitor_events pageview (2026-06-20)

test.describe('Admin · per-site multi-url analytics D1 fallback (P0-ADMIN)', () => {
  test('a subdomain site with visitor_events shows populated traffic, not lying-empty', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' }); // homepage-first

    // Technical reconciliation: fetch the live endpoint AS the authed session and
    // read what it returns. `exclude=` (a real query dimension) shifts the KV
    // cache key → forces a fresh fallback compute rather than a stale entry.
    const res = await page.evaluate(async (site) => {
      const sess = JSON.parse(localStorage.getItem('ps_session') || '{}') as { token?: string };
      const token = sess.token ?? '';
      const get = async (range: string) => {
        const r = await fetch(
          `/api/sites/${site}/multi-url-analytics?range=${range}&exclude=zzz-e2e-cachebust.example.com`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const body = r.ok ? await r.json() : null;
        return { status: r.status, data: body?.data ?? null };
      };
      return { d90: await get('90d') };
    }, SITE);

    // Endpoint is reachable for this session (E2E org owns e2e-site-1).
    test.skip(res.d90.status === 403 || res.d90.status === 404, 'site not owned by this session');
    expect(res.d90.status, 'multi-url-analytics returns 200').toBe(200);

    // THE REGRESSION GUARD: real visitor_events pageviews → populated, not empty.
    // Before the fix this was any_real_data:false + pageviews:0 (lying-empty).
    expect(res.d90.data, 'envelope present').not.toBeNull();
    expect(res.d90.data.any_real_data, 'fallback surfaced real first-party traffic').toBe(true);
    expect(res.d90.data.pageviews, 'real pageviews from visitor_events').toBeGreaterThanOrEqual(1);
    // The window series is gap-filled to one point per day (chart never blank).
    expect(Array.isArray(res.d90.data.series) && res.d90.data.series.length > 0).toBe(true);
  });
});
