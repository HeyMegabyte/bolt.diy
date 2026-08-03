/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — data-rich sections are POPULATED with
 * real data (not just "renders").
 *
 * Some admin sections MUST show real content for ANY account (they're driven by
 * platform data, not the account's traffic): feature-flags (~90 seeded flags),
 * system-services (the service registry), apps (the 85-app catalog), docs (the
 * API endpoint reference), sites (the account's sites), and the dashboard
 * (site-count + live status strip). This asserts each renders MULTIPLE real
 * content items — catching the "renders but empty when it should have data" gap
 * that analytics had. Real session + full `/api` passthrough → live data.
 *
 * (Sections that are legitimately empty for a low-activity account — audit,
 * inbox, payouts, per-site traffic — are covered by the render-clean sweep, not
 * asserted populated here.)
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Selectors that represent a repeated real-data content item within a section. */
const ITEM = 'main li, main tr, main [class*="card"], main [class*="-row"], main [class*="-item"], main [class*="-tile"], main [class*="flag"], main [class*="svc"], main [class*="endpoint"]';

/** section → [min real items expected, a stable text token that must appear]. */
const POPULATED: Array<{ section: string; minItems: number; token: RegExp }> = [
  { section: 'feature-flags', minItems: 10, token: /flag|experimental|stable|rollout/i },
  { section: 'system-services', minItems: 3, token: /service|status|healthy|operational|degraded|redis|d1|r2|worker/i },
  { section: 'apps', minItems: 8, token: /app|install|catalog|live|coming soon/i },
  { section: 'docs', minItems: 5, token: /\/api\/|endpoint|GET|POST|method/i },
  { section: 'sites', minItems: 1, token: /projectsites\.dev|site|slug|published|draft/i },
  // P0.56 — verified request-shape CLEAN + LIVE-populated (Browserbase, brian).
  { section: 'domains', minItems: 2, token: /projectsites\.dev|domain|subdomain|active|cname|connect/i },
  { section: 'billing', minItems: 3, token: /free|pro|plan|subscription|entitlement|upgrade|credit/i },
  { section: 'user', minItems: 2, token: /api key|session|display name|profile|notification|sign out|revoke/i },
  // P0.58 — LIVE-verified populated (analytics Network Overview shows real all-network
  // traffic even for a zero-traffic account; logs = the real audit trail; auth-security
  // = live sessions/health). Per-site analytics is legitimately "no data yet" for a
  // zero-traffic demo site — the network overview + tab shell is what must render.
  { section: 'analytics', minItems: 3, token: /analytics|traffic|requests|page views|visitors|network overview|no data yet/i },
  { section: 'logs', minItems: 3, token: /audit|event|log|workflow|action|trace|forensics/i },
  { section: 'auth-security', minItems: 2, token: /session|auth|security|health|device|sign|password|mfa/i },
];

test.describe('Admin · data-rich sections are POPULATED (P0-ADMIN)', () => {
  for (const { section, minItems, token } of POPULATED) {
    test(`/admin/${section} — shows ≥${minItems} real items`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.goto(`/admin/${section}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      // Give the section's data fetch + render a beat to resolve.
      await page.waitForTimeout(1500);

      await page.screenshot({ path: `e2e/screenshots/admin-verify/populated-${section}.png`, fullPage: true });

      const items = await page.locator(ITEM).count();
      expect(items, `/admin/${section} must render ≥${minItems} real content items — got ${items}`).toBeGreaterThanOrEqual(minItems);

      const body = (await page.locator('body').innerText());
      expect(token.test(body), `/admin/${section} must contain real data matching ${token}`).toBe(true);
    });
  }

  test('/admin dashboard — shows the account site count + live status strip', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/populated-dashboard.png', fullPage: true });

    const body = (await page.locator('body').innerText()).toLowerCase();
    // The Getting Started hub renders section-guide cards + a live "Site status"
    // strip + a site-count counter — all real, from the account.
    expect(/site status|jump back in|getting started|sites? in your account|pinned/.test(body), 'dashboard must render its real hub content').toBe(true);
    const cards = await page.locator('main li, main [class*="card"], main [class*="tile"]').count();
    expect(cards, `dashboard must render its guide/status content — got ${cards}`).toBeGreaterThanOrEqual(6);
  });
});
