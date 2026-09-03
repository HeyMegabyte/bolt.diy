/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — critical-a11y coverage for the admin
 * sections the existing `admin-a11y-critical*.spec.ts` suite does NOT reach.
 *
 * The critical suite covers the org-level "reliably-rendered" sections (admin root,
 * apps, docs, api-tokens, billing, settings, forms, domains, logs, audit, social,
 * site-features, snapshots, user). These TEN routes existed with ZERO a11y coverage —
 * a critical regression on any of them (missing button/link name, unlabeled form
 * control, ARIA-required attr) would ship unguarded. Validated axe-critical-clean +
 * console-error-free against live prod before enrolling (loop, 2026-09-03).
 *
 * Same contract as {@link ./admin-a11y-critical.spec.ts}: asserts ONLY
 * `impact === 'critical'` = 0 (per directive #2 — functional completeness > axe
 * strictness; serious/moderate/minor are advisory, not gated). NON-MUTATING: axe
 * injects its analyzer + reads the DOM; no /api write, no user action.
 *
 * @see {@link ./admin-a11y-critical.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import AxeBuilder from '@axe-core/playwright';

// Admin sections with NO prior a11y coverage (super-admin/system-services excluded —
// they need a sysAdmin session the E2E_API_KEY org does not have).
const UNCOVERED_SECTIONS = [
  // analytics is data-heavy AND carries a lying-empty incident history (a real site
  // once showed "never had traffic" for 109 real pageviews) — yet it had zero axe
  // coverage. Verified axe-critical-clean live before enrolling (loop, 2026-09-03).
  '/admin/analytics',
  '/admin/leads',
  '/admin/voice',
  '/admin/deliverability',
  '/admin/traces',
  '/admin/seo',
  '/admin/mcp',
  '/admin/ai-chat',
  '/admin/webhooks',
  '/admin/ai-logs',
];

test.describe('Admin · critical a11y — previously-uncovered sections (P0-ADMIN)', () => {
  for (const path of UNCOVERED_SECTIONS) {
    test(`${path} has zero CRITICAL axe violations (WCAG A/AA)`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // If a flag gates the section off it may redirect within /admin — either way the
      // admin shell must stay critical-clean; never bounce to /signin (auth failure).
      expect(page.url(), 'authed admin must not redirect to /signin').not.toContain('/signin');
      await page
        .waitForFunction(
          () => (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length > 40,
          undefined,
          { timeout: 20000 },
        )
        .catch(() => {});
      await page.waitForTimeout(1200); // let the section settle before scanning

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const critical = results.violations.filter((v) => v.impact === 'critical');
      const summary = critical.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none';
      expect(critical, `${path} CRITICAL a11y violations: ${summary}`).toEqual([]);
    });
  }
});
