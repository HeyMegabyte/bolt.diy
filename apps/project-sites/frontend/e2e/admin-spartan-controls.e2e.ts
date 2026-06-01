/**
 * @module e2e/admin-spartan-controls
 *
 * Lane-2 (Spartan UI) convergence LOCK. The admin's form controls were migrated
 * off raw native elements onto Spartan helm directives across the campaign:
 *   - checkboxes → `hlmCheckbox` (commit 6298626d closed the last 6)
 *   - selects    → `hlmSelect`   (only the intentional `.badge-select` HTTP-method
 *                                  pickers in ai-endpoints stay native by design)
 *
 * This guard asserts the invariant on the LIVE admin: across the routes that
 * render form controls, ZERO raw native checkboxes/selects appear (every
 * checkbox carries `hlmcheckbox`; every non-`badge-select` select carries
 * `hlmselect`). If a future change reintroduces a bare native control, this
 * fails — keeping the Spartan system coherent.
 *
 * Invariant-style: a route that renders no such control under the test token
 * contributes nothing (vacuous) — the assertion is "no RAW natives anywhere",
 * not "controls must be present".
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

// Routes that render at least one form control on their default (test-token) view.
const ROUTES = [
  '/admin/sites',
  '/admin/settings',
  '/admin/trust',
  '/admin/billing',
  '/admin/social',
  '/admin/user',
  '/admin/media',
];
// NOTE: site-dna lives at /admin/sites/:id/dna (needs a site id), not a
// top-level route — its select is already hlmSelect (verified in source), so
// it's covered by the source-level migration, not this live route guard.

test.describe('admin — Spartan form-control convergence lock', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('no raw native checkboxes/selects across admin (hlmCheckbox/hlmSelect only)', async ({ page }) => {
    test.setTimeout(120000);
    const offenders: string[] = [];

    for (const route of ROUTES) {
      await seed(page);
      await page.goto(route, { waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
      // Let the section settle.
      await page.waitForTimeout(800);

      const raw = await page.evaluate(() => {
        const bad: string[] = [];
        // A control is a real Spartan gap only when it's a VISIBLE, native-
        // appearance form control. Hidden a11y-backing inputs of custom toggle
        // switches (appearance:none / opacity:0 / sr-only) are intentional and
        // excluded — those render their own track/dot, not a native checkbox.
        const isNativeVisible = (el: Element): boolean => {
          const he = el as HTMLElement;
          if (he.offsetWidth === 0 || he.offsetHeight === 0) return false;
          const cs = getComputedStyle(he);
          if (cs.appearance === 'none' || cs.opacity === '0' || cs.visibility === 'hidden') return false;
          return true;
        };
        document.querySelectorAll('input[type="checkbox"]').forEach((el) => {
          if (!el.hasAttribute('hlmcheckbox') && isNativeVisible(el)) {
            bad.push(`checkbox[${(el as HTMLElement).className || (el.getAttribute('data-testid') ?? '')}]`);
          }
        });
        document.querySelectorAll('select').forEach((el) => {
          const cls = (el as HTMLElement).className || '';
          // `.badge-select` HTTP-method pickers are intentionally native.
          if (!el.hasAttribute('hlmselect') && !/badge-select/.test(cls) && isNativeVisible(el)) {
            bad.push(`select[${cls || (el.getAttribute('data-testid') ?? '')}]`);
          }
        });
        return bad;
      });

      for (const o of raw) offenders.push(`${route} → ${o}`);
    }

    expect(offenders, `Raw native form controls found (should be hlmCheckbox/hlmSelect):\n${offenders.join('\n')}`).toEqual([]);
  });
});
