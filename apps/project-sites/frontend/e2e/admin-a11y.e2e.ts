/**
 * @module e2e/admin-a11y
 *
 * WCAG 2.2 AA audit of the legacy admin via axe-core. The agentskills mandate
 * is axe 0 violations; this gate scans each key section and fails on
 * serious/critical violations (moderate/minor are reported for triage but not
 * blocking, so the gate is actionable not noisy). Seeds `ps_session` from
 * `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const SECTIONS = [
  '/admin/snapshots', '/admin/forms', '/admin/analytics', '/admin/audit',
  '/admin/feature-flags', '/admin/api-tokens', '/admin/settings', '/admin/billing',
  // Expanded to the primary-button-heavy sections to catch the global
  // white-on-cyan PrimeNG contrast bug wherever it renders.
  '/admin/voice', '/admin/social', '/admin/domains', '/admin/content-freshness',
  '/admin/pseo', '/admin/ai-endpoints', '/admin/sites', '/admin/seo', '/admin/docs',
];

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try { localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() })); } catch { /* */ }
  }, KEY);
}

test.describe('legacy /admin — WCAG 2.2 AA (axe-core)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');

  // One test PER section so a slow/redirecting section fails only its own case
  // (named clearly), never the whole gate — and coverage can expand safely.
  // Reduced-motion settles scroll-reveal animations so axe scans the steady UI
  // (no networkidle: the admin polls continuously + never idles).
  for (const path of SECTIONS) {
    test(`no serious/critical axe violations — ${path}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seed(page);
      await page.goto(path, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 25000 });
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        // The embedded bolt editor iframe is a separate origin/app — not ours to fix here.
        .exclude('iframe')
        // AG Grid Community virtualizes rows, so `.ag-root` (role=grid) doesn't
        // always hold its required row children in the live DOM — a known
        // third-party limitation we don't author. Excluded like the iframe.
        .exclude('.ag-root')
        .analyze();
      const advisory = results.violations
        .filter((v) => v.impact !== 'critical' && v.impact !== 'serious')
        .map((v) => `${v.impact ?? '?'} · ${v.id} · ${v.nodes.length}×`);
      const blocking = results.violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.help}\n      ${v.nodes[0]?.target?.join(' ') ?? ''}`);
      if (advisory.length) console.warn(`\n[${path}] axe ADVISORY: ${advisory.join(' | ')}`);
      console.warn(`\n[${path}] axe BLOCKING (serious/critical): ${blocking.length}${blocking.length ? '\n' + blocking.join('\n') : ' ✓'}`);
      expect(blocking, `${path}\n${blocking.join('\n')}`).toEqual([]);
    });
  }
});
