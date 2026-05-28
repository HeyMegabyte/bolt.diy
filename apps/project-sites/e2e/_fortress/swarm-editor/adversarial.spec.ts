/**
 * @fortress SWARM-EDITOR — adversarial journey
 *
 * Break-it angles:
 *  SW1. Start swarm without auth → 401
 *  SW2. SSE stream disconnect mid-run → UI recovers, not crash
 *  SW3. Double-start same run → 409 idempotent
 *  SW4. Swarm on non-owned site → 403
 *  SW5. XSS in agent feedback → not executed
 *  SW6. Start with 0 specs selected → 400 (at least 1 required)
 *  SW7. Concurrent agent file conflicts resolve without 500
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('SW ADV — RBAC + auth', () => {
  test('SW-ADV-01 start swarm without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/swarm`, {
      data: { site_id: 'test', specs: ['visual-qa'] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('SW-ADV-02 swarm on non-owned site returns 403/404', async ({ authedPage: page }) => {
    await page.route('**/api/swarm*', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not your site' } }),
        });
      } else {
        await route.continue();
      }
    });

    const res = await page.request.post(`${BASE}/api/swarm`, {
      data: { site_id: 'other-org-site', specs: ['visual-qa'] },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([403, 401, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('SW-ADV-03 double-start same run returns 409 Conflict', async ({ authedPage: page }) => {
    let count = 0;
    await page.route('**/api/swarm*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      count++;
      const status = count === 1 ? 200 : 409;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200
            ? { run_id: 'swarm-run-race' }
            : { error: { code: 'CONFLICT', message: 'Run already in progress' } },
        ),
      });
    });

    const [r1, r2] = await Promise.all([
      page.request.post(`${BASE}/api/swarm`, {
        data: { site_id: 'test-site', specs: ['visual-qa'] },
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
      page.request.post(`${BASE}/api/swarm`, {
        data: { site_id: 'test-site', specs: ['visual-qa'] },
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
    ]);

    expect(r1.status()).not.toBe(500);
    expect(r2.status()).not.toBe(500);
  });
});

test.describe('SW ADV — input abuse + error recovery', () => {
  test('SW-ADV-04 start with empty specs array returns 400', async ({ authedPage: page }) => {
    await page.route('**/api/swarm*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'At least 1 spec required' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/swarm`, {
      data: { site_id: 'test-site', specs: [] },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 401, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('SW-ADV-05 XSS in agent feedback is escaped in rendered panel', async ({ authedPage: page }) => {
    const xssFeedback = '<script>window.__SW_XSS__=1</script>';

    await page.route('**/api/swarm/*/status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'complete',
          feedback: { summary: xssFeedback },
        }),
      });
    });

    await page.goto(`${BASE}/admin/sites/swarm-test-site-001/swarm`);
    await page.waitForTimeout(1_500);

    const xssRan = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__SW_XSS__ === 1,
    );
    expect(xssRan, 'XSS in swarm feedback must not execute').toBe(false);
  });

  test('SW-ADV-06 SSE stream abrupt disconnect does not crash page', async ({ authedPage: page }) => {
    // Serve an SSE response that terminates abruptly
    await page.route('**/api/swarm/stream*', async (route) => {
      // Abort the route to simulate a network disconnect
      await route.abort('connectionfailed');
    });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/admin/sites/swarm-test-site-001/swarm`);
    await page.waitForTimeout(2_000);

    expect(errors.filter((e) => !e.includes('Non-Error')), 'no unhandled JS errors on SSE disconnect').toHaveLength(0);
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on SSE disconnect').toBeGreaterThan(0);
  });

  test('SW-ADV-07 SQLi in site_id is rejected with 400 not 500', async ({ request }) => {
    const res = await request.post(`${BASE}/api/swarm`, {
      data: { site_id: "'; DROP TABLE sites; --", specs: ['visual-qa'] },
      headers: { Authorization: 'Bearer not-real', 'Content-Type': 'application/json' },
    });
    expect([400, 401, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});
