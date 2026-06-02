/**
 * @module e2e/admin-a11y-mobile
 *
 * Mobile (390px) WCAG 2.2 AA axe coverage. admin-a11y runs at the prod config's
 * sole project (Desktop Chrome, 1280) — so target-size (2.5.8, 24px), reflow
 * (1.4.10), and width-dependent contrast/overlap were never scanned at a phone
 * width. This spec forces a 390×844 viewport and re-runs axe on the data-dense
 * + interactive admin routes (where small controls + wrapped layouts surface
 * mobile-only violations).
 *
 * Same AxeBuilder config as admin-a11y (wcag2a/2aa/21aa/22aa; iframe + AG Grid
 * excluded). Fails on serious/critical only. Seeds `ps_session` from
 * `E2E_API_KEY`. Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-a11y-mobile
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const KEY = process.env.E2E_API_KEY ?? '';

const ROUTES = [
  '/admin/sites', '/admin/feature-flags', '/admin/analytics', '/admin/billing',
  '/admin/media', '/admin/audit', '/admin/social', '/admin/seo',
];

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — mobile (390px) WCAG 2.2 AA axe', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.use({ viewport: { width: 390, height: 844 } });
  test.describe.configure({ retries: 2 });

  for (const path of ROUTES) {
    test(`no serious/critical axe violations @390px — ${path}`, async ({ page }) => {
      test.setTimeout(60000);
      await seed(page);
      // Settle scroll-reveal + FAB/toast entrance animations so axe measures the
      // steady UI — otherwise target-size flakes on a mid-animation (scaling)
      // control that is briefly <24px but ≥24px once settled.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path, { waitUntil: 'load' });
      // On mobile the sidebar is a drawer; assert the shell (header) is alive.
      await expect(page.locator('.admin-shell, .admin-topbar, header, .admin-sidebar').first())
        .toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1000);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .exclude('iframe')
        .exclude('.ag-root')
        .analyze();
      const blocking = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.nodes[0]?.target?.join(' ') ?? ''}`);
      // eslint-disable-next-line no-console
      console.warn(`\n[${path} @390px] BLOCKING: ${blocking.length}${blocking.length ? '\n' + blocking.join('\n') : ' ✓'}`);
      expect(blocking, `${path} @390px\n${blocking.join('\n')}`).toEqual([]);
    });
  }
});
