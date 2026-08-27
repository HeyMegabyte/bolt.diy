/**
 * @module e2e/admin-section-h1
 *
 * Every admin section must render EXACTLY ONE <h1> — the page-title heading.
 *
 * Why a dedicated gate: the axe pass in `admin-a11y.e2e.ts` scans only the
 * wcag2a/2aa/21aa/22aa tag set, but axe's `page-has-heading-one` and
 * `heading-order` rules are BEST-PRACTICE tier (untagged), so that gate is
 * STATE-BLIND to a section shipping with zero <h1>. A 2026-08-27 surf audit
 * found 6 of 13 sections (Dashboard, Editor, Snapshots, Forms, Apps, Voice)
 * rendering their top heading as <h2> with no <h1> at all — a WCAG 2.4.6 /
 * screen-reader page-identity defect. Fix: promote each visible section-title
 * h2→h1 (Apps/Snapshots/Forms/Voice) or add an sr-only h1 where there is no
 * visible title (Dashboard/Editor). This gate makes exactly-one-h1 an enforced
 * invariant so no section can regress to zero (or sprout a second) h1.
 *
 * The embedded bolt.diy editor iframe is a separate origin — its internal
 * headings are not counted by a top-document `h1` locator, so /admin/editor
 * asserts against our own shell h1 only.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

/** Every real admin SECTION (the 13 nav destinations). */
const SECTIONS = [
  '/admin', '/admin/editor', '/admin/snapshots', '/admin/analytics',
  '/admin/forms', '/admin/apps', '/admin/site-features', '/admin/social',
  '/admin/voice', '/admin/logs', '/admin/docs', '/admin/settings',
  '/admin/super-admin',
];

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin sections — exactly one <h1> (WCAG 2.4.6 page identity)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  // Parallel section loads contend on the heavy admin SPA + continuous polling;
  // retries self-heal transient shell-render lag (a genuine h1 miscount fails
  // every attempt).
  test.describe.configure({ retries: 2 });

  for (const path of SECTIONS) {
    test(`exactly one h1 — ${path}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await seed(page);
      await page.goto(path, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 45000 });
      // Settle async section fetches (skeletons set aria-busy) so the steady DOM
      // is measured, not a mid-load transient.
      await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      // Top-document h1s only — the bolt iframe is a separate origin/document.
      const count = await page.locator('h1').count();
      const texts = await page.locator('h1').allTextContents();
      expect(count, `${path} → ${count} h1(s): ${JSON.stringify(texts)}`).toBe(1);
    });
  }
});
