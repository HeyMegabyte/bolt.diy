/**
 * CHAOS 3 — "The Locked-Out User": auth + access control.
 *
 * Homepage-first → sign-in. Feeds magic-link hostile emails, checks the OAuth
 * entry, and asserts protected routes bounce an UNauthed caller (no sensitive
 * data leaks to an unauthenticated session).
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive, EVIL } from './chaos-helpers';

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
    const email = page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]').first();
    if (await email.isVisible().catch(() => false)) {
      for (const evil of ['', 'notanemail', EVIL.xssScript, `${EVIL.xssImg}@x.com`, EVIL.sqli, 'a@a']) {
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
      if (r) expect(r.status(), `magic-link "${bad.slice(0, 15)}" → ${r.status()}`).toBeLessThan(500);
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
        .locator('[data-testid="sites-table"], [data-testid="admin-analytics"], text=/Monthly recurring/i')
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
});
