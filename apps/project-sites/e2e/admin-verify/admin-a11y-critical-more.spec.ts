/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — extends the axe-CRITICAL a11y sweep
 * (admin-a11y-critical.spec.ts) to more org-level sections: audit log, AI-agents,
 * log explorer, billing, user settings. Zero `impact==='critical'` axe violations
 * (WCAG A/AA) — the mandate's "axe critical clean" applied section-by-section.
 *
 * Per directive #2 (a11y advisory EXCEPT critical) — serious/moderate/minor are NOT
 * gated. NON-MUTATING: axe reads the DOM; no /api write, no user action.
 *
 * @see {@link ./admin-a11y-critical.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import AxeBuilder from '@axe-core/playwright';

// Org-level sections (no site selection needed to render the section chrome).
const SECTIONS = ['/admin/audit', '/admin/ai-endpoints', '/admin/logs', '/admin/billing', '/admin/user'];

test.describe('Admin · critical a11y (more sections) — zero axe critical violations (P0-ADMIN)', () => {
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
      await page.waitForTimeout(1200);

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const critical = results.violations.filter((v) => v.impact === 'critical');
      const summary = critical.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none';
      expect(critical, `${path} CRITICAL a11y violations: ${summary}`).toEqual([]);
    });
  }
});
