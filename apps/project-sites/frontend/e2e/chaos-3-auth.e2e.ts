/**
 * CHAOS 3 — "The Locked-Out User": auth + access control.
 *
 * Homepage-first → sign-in. Feeds magic-link hostile emails, checks the OAuth
 * entry, and asserts protected routes bounce an UNauthed caller (no sensitive
 * data leaks to an unauthenticated session).
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, seedAuth, EVIL } from './chaos-helpers';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('CHAOS 3 — Locked-Out User (auth + access control)', () => {
  test('sign-in page renders from homepage, shell alive, no app errors', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/');
    await page.goto('/signin', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await assertAlive(page);
    console.log('CHAOS3/signin console:', JSON.stringify(e.consoleErrors));
    console.log('CHAOS3/signin warn   :', JSON.stringify(e.consoleWarnings));
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });

  test('magic-link input rejects/handles hostile emails without crash or XSS', async ({ page }) => {
    const e = trackErrors(page);
    await page.goto('/signin');
    await page.waitForTimeout(1500);
    const email = page
      .locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]')
      .first();
    if (await email.isVisible().catch(() => false)) {
      for (const evil of [
        '',
        'notanemail',
        EVIL.xssScript,
        `${EVIL.xssImg}@x.com`,
        EVIL.sqli,
        'a@a',
      ]) {
        await email.fill(evil).catch(() => {});
        await page.keyboard.press('Tab').catch(() => {});
        await page.waitForTimeout(200);
        await assertAlive(page);
      }
    }
    expect(await e.xssFired(), 'no injected script executed on the sign-in form').toBe(false);
    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
  });

  test('magic-link API never 5xx on hostile email (validation, not crash)', async ({ request }) => {
    for (const bad of ['', 'notanemail', EVIL.xssScript, EVIL.sqli, 'a@a']) {
      const r = await request
        .post('https://projectsites.dev/api/auth/magic-link', {
          data: { email: bad },
          failOnStatusCode: false,
          timeout: 15_000,
        })
        .catch(() => null);
      if (r)
        expect(r.status(), `magic-link "${bad.slice(0, 15)}" → ${r.status()}`).toBeLessThan(500);
    }
  });

  test('UNauthed protected routes do not leak — bounce or empty, never real data', async ({
    page,
  }) => {
    // No ps_session seeded. /admin etc. must NOT render authed content.
    for (const route of ['/admin', '/admin/billing', '/admin/settings', '/editor']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500);
      await assertAlive(page);
      // Should have bounced to signin OR shown a gate — assert no obvious authed
      // artifacts (a real sites table / analytics numbers) are visible.
      const url = page.url();
      const leaked = await page
        .locator(
          '[data-testid="sites-table"], [data-testid="admin-analytics"], text=/Monthly recurring/i',
        )
        .first()
        .isVisible()
        .catch(() => false);
      expect(leaked, `unauthed ${route} leaked authed content (url=${url})`).toBe(false);
    }
  });

  test('OAuth start endpoint issues a redirect (302), not a 5xx', async ({ request }) => {
    const r = await request
      .get('https://projectsites.dev/api/auth/google', {
        maxRedirects: 0,
        failOnStatusCode: false,
        timeout: 15_000,
      })
      .catch(() => null);
    // 302 to Google, or 200/4xx if disabled — just never a 5xx (null = network/timeout, tolerate).
    if (r) expect(r.status()).toBeLessThan(500);
  });

  // M3 — the "Active sessions" panel on /admin/auth-security reconciles with the
  // LIVE `sessions` table via GET /api/auth/list-sessions (a per-user security
  // surface: see + revoke your active sessions). This is a cross-system journey
  // (SPA ↔ auth middleware ↔ D1 sessions) AND a regression guard for the
  // better_auth-swallow class: those legacy `/api/auth/*` paths are shadowed if
  // the better_auth middleware turns ON without allowlisting them, silently
  // 404-ing the panel to "unavailable" for every real user.
  test('M3: /admin/auth-security sessions panel is reachable + not lying-unavailable (list-sessions 200, refresh re-fires)', async ({
    page,
  }) => {
    test.skip(!KEY, 'E2E_API_KEY not set');
    const e = trackErrors(page);
    await seedAuth(page, KEY);
    // A 404 here = the legacy path was swallowed → panel dead for every user.
    const listResp = page
      .waitForResponse((r) => r.url().includes('/api/auth/list-sessions'), { timeout: 20_000 })
      .catch(() => null);
    await page.goto('/');
    await page.goto('/admin/auth-security', { waitUntil: 'domcontentloaded' });
    const first = await listResp;
    expect(
      first?.status(),
      'GET /api/auth/list-sessions must be 200, not 404-swallowed by the better_auth middleware',
    ).toBe(200);
    await page.waitForTimeout(3000);
    await assertAlive(page);
    await expect(page.locator('[data-testid="auth-security-page"]')).toBeVisible({
      timeout: 10_000,
    });

    // The panel renders exactly one valid state — never a crash.
    const listShown = await page
      .locator('[data-testid="as-sessions-list"]')
      .isVisible()
      .catch(() => false);
    const emptyShown = await page
      .locator('[data-testid="as-sessions-empty"]')
      .isVisible()
      .catch(() => false);
    const unavailShown = await page
      .locator('[data-testid="as-sessions-unavailable"]')
      .isVisible()
      .catch(() => false);
    expect(
      listShown || emptyShown || unavailShown,
      'sessions panel shows a valid state (list / empty / unavailable)',
    ).toBe(true);
    // A 200 array must NOT render the "unavailable" fallback — that's reserved for a
    // non-array/stale body. Showing "unavailable" over a working 200 = a lying panel.
    expect(
      unavailShown,
      'list-sessions returned 200 but the panel showed "unavailable" (lying-unavailable over a working endpoint)',
    ).toBe(false);

    // Refresh must re-fire list-sessions (the panel is live, not a one-shot render).
    const refreshResp = page
      .waitForResponse((r) => r.url().includes('/api/auth/list-sessions'), { timeout: 15_000 })
      .catch(() => null);
    await page
      .locator('[data-testid="as-sessions-refresh"]')
      .first()
      .click()
      .catch(() => {});
    const refreshed = await refreshResp;
    expect(refreshed?.status(), 'refresh re-fires list-sessions 200').toBe(200);

    // The 2FA enrollment entry point is present (not a dead/missing control).
    await expect(page.locator('[data-testid="as-2fa-enroll"]')).toBeVisible();

    expect(e.pageErrors, `pageerrors: ${e.pageErrors.join('; ')}`).toEqual([]);
    expect(e.serverErrors, `5xx: ${e.serverErrors.join('; ')}`).toEqual([]);
    expect(e.consoleErrors, `console errors: ${e.consoleErrors.join('; ')}`).toEqual([]);
    expect(e.consoleWarnings, `console warnings (DoD=0): ${e.consoleWarnings.join('; ')}`).toEqual(
      [],
    );
  });
});
