/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — LOADING-STATE honesty: every admin list section shows
 * its skeleton (`aria-busy` / a `*-loading`/`*-skeleton` testid) WHILE its data fetch is in
 * flight — never a blank screen, never a premature "empty" flash before the data arrives.
 * CLAUDE.md mandates ≥1 E2E per loading state; this completes the data-state matrix (loading →
 * empty → error → populated) each section is already covered on for the other three states.
 *
 * Technique: HOLD the section's data endpoint open (~9s, then a late 200) so `loading()` stays
 * true and the skeleton stays visible; assert it within the window, then the test ends and the
 * pending request aborts on context close. The response body never matters — the assertion fires
 * during the load, before it arrives. Data-driven so new sections are a one-line addition.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./forms-empty-state.spec.ts} · {@link ./forms-error-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

interface SkeletonCase {
  readonly name: string;
  readonly route: string;
  readonly glob: string; // the data endpoint to hold open
  readonly testid: string; // the skeleton/loading testid gated by @if (loading())
}

/** Each section: hold its load endpoint → assert its skeleton renders. Auto-load, no flag gate. */
const CASES: readonly SkeletonCase[] = [
  { name: 'forms', route: '/admin/forms', glob: '**/api/sites/*/form-submissions**', testid: 'forms-loading' },
  { name: 'domains', route: '/admin/domains', glob: '**/api/sites/*/hostnames**', testid: 'hostnames-loading' },
  { name: 'auth-security', route: '/admin/auth-security', glob: '**/api/audit-logs**', testid: 'auth-security-loading' },
  { name: 'ai-logs', route: '/admin/ai-logs', glob: '**/api/sites/*/ai-logs**', testid: 'ai-logs-skeleton' },
  // Better-Auth org call is not under a literal `/api/get-full-organization` path — use the broad
  // glob that the team-empty-state spec proved matches (same as its `get-full-organization` stub).
  { name: 'team', route: '/admin/team', glob: '**/get-full-organization**', testid: 'team-loading' },
  {
    name: 'snapshots-diff',
    route: '/admin/snapshots/diff?from=e2e-a&to=e2e-b',
    glob: '**/api/sites/*/snapshots/diff**',
    testid: 'snapshots-diff-loading',
  },
  { name: 'api-tokens', route: '/admin/api-tokens', glob: '**/api/v1-tokens**', testid: 'api-tokens-skeleton' },
  { name: 'docs', route: '/admin/docs', glob: '**/api/admin/docs/openapi.json**', testid: 'docs-loading' },
  { name: 'analytics-live', route: '/admin/analytics?tab=live', glob: '**/api/analytics-data**', testid: 'al-loading' },
  {
    name: 'activation-funnel',
    route: '/admin/analytics?tab=funnel',
    glob: '**/api/admin/activation-funnel**',
    testid: 'funnel-loading',
  },
];

test.describe('Admin · loading-skeleton honesty (P0-ADMIN)', () => {
  for (const c of CASES) {
    test(`${c.name}: the skeleton renders while its data is loading (no blank, no empty flash)`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.route(c.glob, async (route) => {
        await new Promise((r) => setTimeout(r, 9000));
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }).catch(() => {});
      });
      await page.goto(c.route, { waitUntil: 'domcontentloaded' });

      await expect(
        page.locator(`[data-testid="${c.testid}"]`),
        `${c.name}: the loading skeleton renders while its fetch is in flight`,
      ).toBeVisible({ timeout: 8000 });
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(body.includes('ran into a problem'), `${c.name}: a pending fetch must not crash the boundary`).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/admin-verify/loading-${c.name}.png` });
    });
  }
});
