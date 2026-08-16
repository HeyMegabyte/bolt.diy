/**
 * CHAOS 4 — "The Power Admin": authed full-dashboard sweep.
 *
 * Homepage-first, seeds a real `ps_session` from E2E_API_KEY, then walks EVERY
 * admin section asserting each renders alive with no pageerror / no 5xx / no
 * injected-script execution. Then hammers a couple of interactive surfaces.
 * Skips if E2E_API_KEY is absent (fork/secret-less runs).
 *
 * ⚠️ Does NOT touch the sidebar/admin-shell owned by a concurrent session — it
 * only navigates section ROUTES and reads state.
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

// Section routes (navigate directly; the shell mounts each lazily).
const SECTIONS = [
  '/admin',
  '/admin/sites',
  '/admin/analytics',
  '/admin/domains',
  '/admin/media',
  '/admin/social',
  '/admin/voice',
  '/admin/billing',
  '/admin/settings',
  '/admin/feature-flags',
  '/admin/seo',
  '/admin/docs',
  '/admin/apps',
  '/admin/mcp',
  '/admin/audit',
  '/admin/snapshots',
];

test.describe('CHAOS 4 — Power Admin (authed dashboard sweep)', () => {
  test.beforeEach(() => {
    test.skip(!KEY, 'E2E_API_KEY not set');
  });

  for (const route of SECTIONS) {
    test(`section ${route} renders alive — no pageerror / 5xx / XSS`, async ({ page }) => {
      const e = trackErrors(page);
      await seedAuth(page, KEY);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500); // Angular lazy chunk + data fetch
      await assertAlive(page);
      if (
        e.consoleErrors.length ||
        e.pageErrors.length ||
        e.serverErrors.length ||
        e.consoleWarnings.length
      ) {
        console.log(
          `CHAOS4 ${route}:`,
          JSON.stringify({
            err: e.consoleErrors,
            warn: e.consoleWarnings,
            asset404: e.notFoundAssets,
            pageerr: e.pageErrors,
            s5xx: e.serverErrors,
          }),
        );
      }
      expect(await e.xssFired(), `no injected script on ${route}`).toBe(false);
      expect(e.pageErrors, `${route} pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
      expect(e.serverErrors, `${route} 5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
      expect(e.consoleErrors, `${route} console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
      expect(
        e.consoleWarnings,
        `${route} console warnings (mission DoD = 0): ${e.consoleWarnings.join('; ')}`,
      ).toEqual([]);
      expect(
        e.notFoundAssets,
        `${route} missing same-origin assets (404): ${e.notFoundAssets.join('; ')}`,
      ).toEqual([]);
    });
  }

  test('settings form: hostile input round-trip does not crash or 5xx', async ({ page }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const inputs = page.locator('input[type="text"], input:not([type]), textarea');
    const n = Math.min(await inputs.count(), 6);
    for (let i = 0; i < n; i++) {
      const inp = inputs.nth(i);
      if (!(await inp.isVisible().catch(() => false))) continue;
      if (await inp.isDisabled().catch(() => true)) continue;
      await inp.fill('<script>window.__xss__=1</script>А'.repeat(50)).catch(() => {});
      await page.waitForTimeout(150);
    }
    await assertAlive(page);
    expect(await e.xssFired(), 'settings did not execute injected script').toBe(false);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
  });

  test('settings tabs: switching every lazy sub-view stays error-free', async ({ page }) => {
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    // The settings surface is tabbed; each tab mounts a DISTINCT lazy sub-view
    // (a different data fetch + component). A render-only sweep never enters them
    // — press every tab and assert none logs an app error / warn / 5xx / pageerror.
    const TABS = [
      'Team',
      'AI Chat',
      'MCP',
      'AI Env Vars',
      'Webhooks',
      'Email',
      'Domains',
      'API Tokens',
      'General',
    ];
    let switched = 0;
    for (const label of TABS) {
      const tab = page
        .getByRole('tab', { name: label })
        .or(page.locator(`button:has-text("${label}"), [role="tab"]:has-text("${label}")`))
        .first();
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click({ timeout: 3000 }).catch(() => {});
      switched++;
      await page.waitForTimeout(600); // lazy chunk + data fetch
      await assertAlive(page);
    }
    console.log(`CHAOS4/settings-tabs switched ${switched}/${TABS.length}`);
    // Selector drift guard: if fewer than 3 tabs were reachable the surface changed.
    expect(switched, 'settings tabs reachable').toBeGreaterThan(2);
    expect(await e.xssFired(), 'no injected script on tab switches').toBe(false);
    expect(e.pageErrors, `tab pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `tab 5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `tab console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(
      e.consoleWarnings,
      `tab console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`,
    ).toEqual([]);
    expect(e.notFoundAssets, `tab missing assets (404): ${e.notFoundAssets.join('; ')}`).toEqual(
      [],
    );
  });
});
