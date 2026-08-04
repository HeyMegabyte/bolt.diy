/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the installed-app INSTANCES manager
 * (`/admin/apps/instances` list + `/admin/apps/instances/:id` detail,
 * `apps-instances.component`). Coverage gap closed this fire.
 *
 * Enumerated read-only (directive #1). `GET /api/apps/instances` → `{instances}`
 * (Array.isArray-guarded, via ApiService bearer — verified clean, no bug). Gates
 * are org-agnostic: the list renders one honest state (instances / empty / loading
 * / error), 0 console errors, 0 failed `/api/apps` requests, no error-boundary
 * crash. If an instance exists it drills into the param-driven detail route; else
 * the empty state's Browse affordance is asserted. Non-mutating: never
 * restarts/stops/deletes an instance or saves env.
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const NOISE = /Failed to load resource|net::ERR|google-analytics|\/g\/collect|posthog/i;

test.describe('Admin · installed-app Instances (P0-ADMIN)', () => {
  test('the instances list renders an honest state with 0 console errors + 0 failed requests', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const consoleErrors: string[] = [];
    const failed: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text().slice(0, 140));
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 140)));
    page.on('response', (res) => {
      const u = res.url();
      if (res.status() >= 400 && /\/api\/apps/.test(u)) {
        failed.push(`${res.status()} ${u.replace('https://projectsites.dev', '').slice(0, 70)}`);
      }
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps/instances', { waitUntil: 'domcontentloaded' });
    // Wait for the fetch to SETTLE past the loading skeleton — deterministic, not a
    // fixed sleep (the skeleton shows neither rows nor empty-text → the flaky window).
    await page
      .waitForFunction(
        () => {
          const b = document.body.innerText || '';
          return (
            !!document.querySelector('[data-testid^="apps-instance-"]') ||
            /no app instances/i.test(b) ||
            /couldn.t load|failed to load|try again/i.test(b)
          );
        },
        undefined,
        { timeout: 15000 },
      )
      .catch(() => {});

    const info = await page.evaluate(() => ({
      isAdmin404: /doesn.t exist/i.test(document.body.innerText || ''),
      crashed: /ran into a problem|something went wrong/i.test(document.body.innerText || ''),
      mainLen: (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length,
      hasEmpty: /no app instances/i.test(document.body.innerText || ''),
    }));
    expect(info.isAdmin404, '/admin/apps/instances must not be an admin-404').toBe(false);
    expect(info.crashed, 'must not hit the error boundary').toBe(false);
    expect(info.mainLen, 'renders real content').toBeGreaterThan(80);
    expect(failed, `apps requests must resolve (no 4xx/5xx) — saw ${failed.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);

    // Either instances are listed, or the calm empty state is showing — never blank.
    const rows = page.locator('[data-testid^="apps-instance-"]');
    const rowCount = await rows.count();
    expect(rowCount > 0 || info.hasEmpty, 'instances list OR a calm empty state renders').toBe(true);
  });

  test('an instance drills into its param-driven detail route (or the empty state offers Browse)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps/instances', { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(
        () =>
          !!document.querySelector('[data-testid^="apps-instance-"]') ||
          /no app instances/i.test(document.body.innerText || ''),
        undefined,
        { timeout: 15000 },
      )
      .catch(() => {});

    const firstRow = page.locator('[data-testid^="apps-instance-"]').first();
    if ((await firstRow.count()) > 0) {
      await firstRow.click();
      await page
        .waitForFunction(() => /\/admin\/apps\/instances\/.+/.test(location.pathname), undefined, {
          timeout: 8000,
        })
        .catch(() => {});
      expect(
        /\/admin\/apps\/instances\/.+/.test(new URL(page.url()).pathname),
        'clicking an instance opens its detail route',
      ).toBe(true);
      // Detail renders real content (param-driven), not an admin-404.
      const detail = await page.evaluate(() => ({
        crashed: /ran into a problem|something went wrong/i.test(document.body.innerText || ''),
        len: (document.querySelector('main')?.innerText || '').trim().length,
      }));
      expect(detail.crashed, 'detail must not crash').toBe(false);
      expect(detail.len, 'detail renders content').toBeGreaterThan(40);
    } else {
      // No instances → the empty state links to the catalog to install one.
      const browse = page.locator('a[href="/admin/apps"], a[href^="/admin/apps"]').first();
      await expect(browse, 'the empty state offers a path to the apps catalog').toBeVisible({ timeout: 6000 });
    }
  });
});
