/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — HOMEPAGE-FIRST JOURNEYS. Every other admin-verify spec
 * direct-`goto`s `/admin/<x>`; these two start at the marketing homepage `/` and navigate purely
 * by UI clicks — the mandate's "navigate FROM THE HOMEPAGE via the UI" + the real inter-section
 * nav paths that direct-goto specs never exercise.
 *
 * Because `/` and `/admin/*` are ONE Angular SPA, a `window.__spa` sentinel set right after the
 * first (and only) `goto('/')` survives every routerLink navigation — so if any step triggered a
 * full page reload (`window.location`), the sentinel would clear and the assertion would catch it.
 * That makes these the canonical "no-full-reload" proof (per [[spa-no-full-reload]]).
 *
 * Path into admin: the signed-in homepage header renders a top-level "Dashboard" button in the
 * Primary nav (→ `/admin`). `/` is the same Angular SPA, so this is an SPA nav (sentinel survives).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./admin-nav-shell.spec.ts} — the per-section direct-goto render sweep.
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage|status of 4/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

/** goto '/', drop the SPA sentinel, then enter admin via the user-menu → Dashboard. */
async function homepageIntoAdmin(page: Page): Promise<void> {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // A full page reload clears window vars — this sentinel proves every later nav stayed SPA.
  await page.evaluate(() => ((window as unknown as { __spa?: string }).__spa = 'alive'));
  // The signed-in Primary nav renders a top-level "Dashboard" → /admin (no menu needed; the
  // account-menu's own "Dashboard" is hidden while closed, so `.first()` is the visible top one).
  await page.getByRole('button', { name: 'Dashboard', exact: true }).first().click();
  await page.waitForURL(/\/admin(\/|$|\?)/, { timeout: 15000 });
  await page.getByRole('navigation', { name: /admin sections/i }).waitFor({ state: 'visible', timeout: 15000 });
}

const spaAlive = (page: Page) => page.evaluate(() => (window as unknown as { __spa?: string }).__spa);

test.describe('Admin · homepage-first navigation journeys (P0-ADMIN)', () => {
  test('homepage → user-menu → Dashboard → click through 4 sections, all SPA + 0 errors', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await homepageIntoAdmin(page);
    expect(await spaAlive(page), 'entering admin from the homepage stayed SPA (no reload)').toBe('alive');

    const nav = page.getByRole('navigation', { name: /admin sections/i });
    const hops: ReadonlyArray<{ name: string; path: string }> = [
      { name: 'Analytics', path: '/admin/analytics' },
      { name: 'Forms', path: '/admin/forms' },
      { name: 'Apps', path: '/admin/apps' },
      { name: 'Snapshots', path: '/admin/snapshots' },
    ];
    for (const hop of hops) {
      await nav.getByRole('link', { name: hop.name, exact: true }).click();
      await page.waitForURL((u) => new URL(u).pathname === hop.path, { timeout: 12000 });
      const body = (await page.locator('main').innerText()).toLowerCase();
      expect(body.length, `${hop.name}: the section renders content`).toBeGreaterThan(30);
      expect(/this admin page doesn't exist|page not found/i.test(body), `${hop.name}: not a 404`).toBe(false);
      expect(await spaAlive(page), `${hop.name}: navigation stayed SPA (no full reload)`).toBe('alive');
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/journey-nav.png' });
    expect(errors, `no console errors across the journey — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('homepage → admin → Snapshots → open the create-snapshot modal (no mutation), all SPA', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await homepageIntoAdmin(page);

    await page.getByRole('navigation', { name: /admin sections/i }).getByRole('link', { name: 'Snapshots', exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === '/admin/snapshots', { timeout: 12000 });

    // Open the create affordance reached entirely by UI from the homepage — assert it opens, never submit.
    await page.locator('[data-testid="snapshot-create-button"]').click();
    await expect(
      page.locator('[data-testid="snapshot-name-input"]'),
      'the create-snapshot modal opens via the full homepage→nav→click path',
    ).toBeVisible({ timeout: 12000 });
    expect(await spaAlive(page), 'the whole create journey stayed SPA (no reload)').toBe('alive');

    // Close without creating anything (Escape) — this is a non-mutating journey.
    await page.keyboard.press('Escape');

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/journey-create.png' });
    expect(errors, `no console errors across the create journey — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
