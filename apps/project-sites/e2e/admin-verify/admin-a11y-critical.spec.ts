/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — key admin sections have ZERO axe-core
 * CRITICAL a11y violations (the mandate's "axe critical clean"). Per directive #2
 * (functional completeness > axe strictness; a11y advisory EXCEPT critical), this
 * asserts ONLY `impact === 'critical'` violations = 0 — the true blockers (missing
 * button/link names, form labels, ARIA-required attrs, duplicate active ids). Serious
 * / moderate / minor are advisory and NOT gated here.
 *
 * NON-MUTATING: axe injects its bundled analyzer + reads the DOM — no /api write, no
 * user action. The first admin-verify specs to run axe (the interaction/value-domain
 * specs never did).
 *
 * @see {@link ./responsive-admin.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import AxeBuilder from '@axe-core/playwright';

// Org-level, reliably-rendered sections.
const SECTIONS = ['/admin', '/admin/apps', '/admin/docs', '/admin/api-tokens'];

test.describe('Admin · critical a11y — zero axe critical violations (P0-ADMIN)', () => {
  for (const path of SECTIONS) {
    test(`${path} has zero CRITICAL axe violations (WCAG A/AA)`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.goto(path, { waitUntil: 'domcontentloaded' });
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
