/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — every admin section renders REAL data
 * in a REAL browser with no errors and no broken state.
 *
 * Real session (E2E_API_KEY → the SPA sends a real bearer, so ALL `/api` calls
 * authenticate against live prod) + full passthrough → each section renders live
 * data. Per section asserts:
 *  - NOT bounced to /signin (a 401 on any load-bearing call → session-clear),
 *  - the SPA shell actually rendered substantial content (not a blank/white page),
 *  - no "broken" copy (server error / something went wrong / failed to load),
 *  - zero console errors + zero pageerrors while it loads,
 *  - a full-page screenshot to e2e/screenshots/admin-verify/ for the visual record.
 *
 * This is the homepage-of-admin sweep toward the 400-E2E mandate; a11y-critical +
 * populated-data per-section deep checks layer on in dedicated specs.
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Admin sections (primary nav + key sub-surfaces). '' = the dashboard hub. */
const SECTIONS = [
  '',
  'sites',
  'apps',
  'forms',
  'social',
  'logs',
  'audit',
  'billing',
  'domains',
  'feature-flags',
  'mcp',
  'seo',
  'system-services',
  'docs',
  'settings',
  'user',
  'auth-security',
  'api-tokens',
  'voice',
  'snapshots',
  'site-features',
] as const;

/** Copy that indicates a genuinely broken surface (not an honest empty state). */
const BROKEN = [
  'something went wrong',
  'internal server error',
  'failed to load the admin',
  'application error',
  '500',
];

/**
 * Harness-only console/page noise that NEVER fires in a real browser (0 in the
 * Browserbase sweep) — see [[admin-verify-e2e-authoring-gotchas]]:
 *  - fixtures.ts BLOCKS external CDN/Stripe/GA → net::ERR_FAILED / "Failed to load resource"
 *  - cross-origin iframes (bolt.diy editor / send-to-bolt on /admin/editor) read
 *    localStorage in the partitioned fixture context → "Access is denied" SecurityError
 *  - GA/PostHog analytics beacons fail in automation by design
 */
const isHarnessNoise = (t: string): boolean =>
  /Failed to load resource|net::ERR|Access is denied for this document|Failed to read the 'localStorage'|google-analytics|\/g\/collect|posthog/i.test(
    t,
  );

test.describe('Admin · every section renders real, no errors (P0-ADMIN)', () => {
  for (const section of SECTIONS) {
    const label = section || '(dashboard)';
    test(`/admin/${section} — renders, authed, 0 console errors`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !isHarnessNoise(m.text())) errors.push(m.text());
      });
      page.on('pageerror', (e) => {
        const t = e?.message ?? String(e);
        if (!isHarnessNoise(t)) errors.push(t);
      });

      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.goto(`/admin/${section}`, { waitUntil: 'domcontentloaded' });
      // Never `waitForLoadState('networkidle')` — analytics/logs poll on an interval
      // so it never settles (burns ~30s/section). Wait for content to render instead.
      await page
        .waitForFunction(
          () => (document.querySelector('main')?.innerText ?? document.body.innerText).trim().length > 400,
          { timeout: 15000 },
        )
        .catch(() => {});
      await page.waitForTimeout(500);

      // 1. Not bounced to /signin (a load-bearing 401 would redirect there).
      expect(page.url(), `${label} must stay in /admin (not bounce to /signin)`).toContain('/admin');

      // 2. The SPA rendered real content (never a blank/white page).
      const rootLen = await page.evaluate(
        () => document.getElementById('root')?.innerHTML.length ?? document.body.innerHTML.length,
      );
      expect(rootLen, `${label} must render substantial content — got ${rootLen} chars`).toBeGreaterThan(500);

      await page.screenshot({
        path: `e2e/screenshots/admin-verify/section-${section || 'dashboard'}.png`,
        fullPage: true,
      });

      // 3. No genuinely-broken copy on the page.
      const body = (await page.locator('body').innerText()).toLowerCase();
      for (const phrase of BROKEN) {
        expect(body.includes(phrase), `${label} shows broken copy: "${phrase}"`).toBe(false);
      }

      // 4. Zero console errors / pageerrors.
      expect(errors, `${label} must load with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
    });
  }
});
