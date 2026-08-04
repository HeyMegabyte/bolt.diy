/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the two GATED admin surfaces that
 * sections-visual's strict "real data + 0 error" batch can't model, because their
 * correct state depends on the caller's entitlement, not on seeded rows:
 *
 *  - `/admin/super-admin` — ACCOUNT-gated: non-super-admin (the E2E_API_KEY org, per
 *    [[e2e-api-key-is-not-brians-account]] / gotcha #4) gets the honest ⛔ "requires
 *    users.is_super_admin = 1" surface; brian (allow-listed) gets real platform
 *    stats (verified separately via Browserbase, see the fire's board note).
 *  - `/admin/domains/:id/stack` — the Domain Stack Wizard (flag `domain_stack_wizard`
 *    is stable/enabled). The `:id` param is cosmetic; the board derives the hostname
 *    from the selected site, so a subdomain-only site shows the honest "no primary
 *    custom hostname" state — never a crash.
 *
 * Both assert the honest gated state renders (not an admin-404, not the error
 * boundary). super-admin's expected 403 responses are NOT counted as failures.
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const NOISE = /Failed to load resource|net::ERR|google-analytics|\/g\/collect|posthog/i;

test.describe('Admin · gated surfaces render an honest state (P0-ADMIN)', () => {
  test('/admin/super-admin shows the honest account-gated surface (denied or real stats), no crash', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text().slice(0, 140));
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 140)));

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/super-admin', { waitUntil: 'domcontentloaded' });
    // Wait until the surface settles into its honest state — the 403 must resolve to
    // the denial render (or real stats), else the fixed-wait races the fetch (flaky).
    await page
      .waitForFunction(
        () => {
          const b = document.body.innerText || '';
          return (
            /requires|super.?admin|is_super_admin/i.test(b) ||
            /platform|revenue|wallet|categor|MRR/i.test(b) ||
            /doesn.t exist|ran into a problem|something went wrong/i.test(b)
          );
        },
        undefined,
        { timeout: 14000 },
      )
      .catch(() => {});

    const info = await page.evaluate(() => {
      const b = document.body.innerText || '';
      return {
        isAdmin404: /doesn.t exist/i.test(b),
        crashed: /ran into a problem|something went wrong/i.test(b),
        // Honest gated surface: the ⛔ "requires super_admin" denial OR real
        // platform stats (super-admin content) — either is correct, never blank.
        gated: /requires|super.?admin|is_super_admin/i.test(b),
        stats: /platform|revenue|wallet|categor|total|MRR|users?\b/i.test(b),
        len: (document.querySelector('main')?.innerText || b).trim().length,
      };
    });
    expect(info.isAdmin404, '/admin/super-admin must not be an admin-404').toBe(false);
    expect(info.crashed, 'must not hit the error boundary').toBe(false);
    expect(info.len, 'renders real content').toBeGreaterThan(60);
    expect(info.gated || info.stats, 'shows the denial surface OR real super-admin stats').toBe(true);
    // The account-gated 403s are EXPECTED here, so only console errors gate.
    expect(consoleErrors, `0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('/admin/domains/:id/stack renders an honest wizard state (no site / no hostname / progress), no crash', async ({
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
      if (res.status() >= 400 && /\/api\/domains/.test(u)) {
        failed.push(`${res.status()} ${u.replace('https://projectsites.dev', '').slice(0, 70)}`);
      }
    });

    // :id is cosmetic (the component derives the hostname from the selected site).
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/domains/x/stack', { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(
        () => {
          const b = document.body.innerText || '';
          return (
            /no site selected|custom hostname|dns|ssl|progress|wizard|platform flag/i.test(b) ||
            /doesn.t exist|ran into a problem|something went wrong/i.test(b)
          );
        },
        undefined,
        { timeout: 14000 },
      )
      .catch(() => {});
    await page.waitForTimeout(600); // settle any trailing status fetch

    const info = await page.evaluate(() => {
      const b = document.body.innerText || '';
      return {
        isAdmin404: /doesn.t exist/i.test(b),
        crashed: /ran into a problem|something went wrong/i.test(b),
        // One honest wizard state: no-site / no-hostname / the DNS→SSL progress board.
        honest: /no site selected|custom hostname|stack|dns|ssl|progress|wizard|platform flag/i.test(b),
        len: (document.querySelector('main')?.innerText || b).trim().length,
      };
    });
    expect(info.isAdmin404, '/admin/domains/:id/stack must not be an admin-404').toBe(false);
    expect(info.crashed, 'must not hit the error boundary').toBe(false);
    expect(info.len, 'renders real content').toBeGreaterThan(50);
    expect(info.honest, 'shows an honest stack-wizard state').toBe(true);
    // Flag is stable/enabled → no flag-dark 404 expected on the domains API.
    expect(failed, `no unexpected domains-API 4xx/5xx — saw ${failed.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);
  });
});
