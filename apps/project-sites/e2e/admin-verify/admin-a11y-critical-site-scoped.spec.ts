/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the SITE-SCOPED admin sections have ZERO
 * axe-CRITICAL a11y violations once a project is selected (so the section renders its
 * POPULATED content, not the "select a site" prompt). Completes the "axe critical
 * clean" sweep across the site-scoped surfaces (snapshots / forms / settings / domains
 * / site-features / social).
 *
 * Per directive #2 (a11y advisory EXCEPT critical). SITE-SCOPED → `selectFirstSite`;
 * skips honestly if no site. NON-MUTATING: axe reads the DOM; no /api write.
 *
 * @see {@link ./admin-a11y-critical.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';
import AxeBuilder from '@axe-core/playwright';

const SECTIONS = ['/admin/snapshots', '/admin/forms', '/admin/settings', '/admin/domains', '/admin/site-features', '/admin/social'];

test.describe('Admin · critical a11y (site-scoped) — zero axe critical violations (P0-ADMIN)', () => {
  for (const path of SECTIONS) {
    test(`${path} (site selected) has zero CRITICAL axe violations (WCAG A/AA)`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      test.skip(!(await selectFirstSite(page).catch(() => false)), 'no site to scope the section to');
      await page
        .waitForFunction(
          () => (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length > 60,
          undefined,
          { timeout: 15000 },
        )
        .catch(() => {});
      await page.waitForTimeout(1200);

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const critical = results.violations.filter((v) => v.impact === 'critical');
      const summary = critical.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none';
      expect(critical, `${path} CRITICAL a11y violations: ${summary}`).toEqual([]);
    });
  }
});
