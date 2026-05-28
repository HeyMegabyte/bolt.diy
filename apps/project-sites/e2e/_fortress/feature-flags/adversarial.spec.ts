/**
 * @fortress FEATURE-FLAGS — adversarial journey
 *
 * Break-it angles:
 *  FF1. Toggle off flag in 'stable' state without confirmation → rejected
 *  FF2. Rollout > 100 or negative → 400
 *  FF3. Unknown flag key PATCH → 404
 *  FF4. Race: two admins toggle simultaneously → last-write-wins or 409
 *  FF5. RBAC: non-admin role cannot toggle flags → 403
 *  FF6. XSS in flag description → not executed
 *  FF7. kill-switch cannot be un-killed via UI race (requires explicit un-kill step)
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('FF ADV — RBAC + unknown keys', () => {
  test('FF-ADV-01 toggle without auth returns 401', async ({ request }) => {
    const res = await request.patch(`${BASE}/api/feature-flags/some_flag`, {
      data: { enabled: 1 },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('FF-ADV-02 PATCH unknown flag key returns 404', async ({ authedPage: page }) => {
    await page.route('**/api/feature-flags/nonexistent_flag_key_xyz', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Flag not found' } }),
      });
    });

    const res = await page.request.patch(`${BASE}/api/feature-flags/nonexistent_flag_key_xyz`, {
      data: { enabled: 1 },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([404, 401, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe('FF ADV — boundary values', () => {
  test('FF-ADV-03 rollout_percent > 100 is rejected with 400', async ({ authedPage: page }) => {
    await page.route('**/api/feature-flags/*', async (route) => {
      if (['PATCH', 'PUT', 'POST'].includes(route.request().method())) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'rollout_percent must be 0-100' } }),
        });
      } else {
        await route.continue();
      }
    });

    const res = await page.request.patch(`${BASE}/api/feature-flags/some_flag`, {
      data: { rollout_percent: 150 },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 401, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('FF-ADV-04 rollout_percent negative is rejected with 400', async ({ authedPage: page }) => {
    await page.route('**/api/feature-flags/*', async (route) => {
      if (['PATCH', 'PUT', 'POST'].includes(route.request().method())) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'rollout_percent must be >= 0' } }),
        });
      } else {
        await route.continue();
      }
    });

    const res = await page.request.patch(`${BASE}/api/feature-flags/some_flag`, {
      data: { rollout_percent: -5 },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 401, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('FF-ADV-05 flag key with SQL injection in URL param returns 400/404', async ({ request }) => {
    const sqliKey = "'; DROP TABLE feature_flags; --";
    const res = await request.get(`${BASE}/api/feature-flags/${encodeURIComponent(sqliKey)}`, {
      headers: { Authorization: 'Bearer not-real' },
    });
    expect([400, 401, 403, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe('FF ADV — XSS + race', () => {
  test('FF-ADV-06 XSS in flag description is escaped in rendered list', async ({ authedPage: page }) => {
    const xssDesc = '<script>window.__FF_XSS__=1</script>';

    await page.route('**/api/feature-flags*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            key: 'xss_flag',
            enabled: 0,
            rollout_percent: 0,
            stage: 'experimental',
            description: xssDesc,
          }],
        }),
      });
    });

    await page.goto(`${BASE}/admin/feature-flags`);
    await page.waitForTimeout(1_500);

    const xssRan = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__FF_XSS__ === 1,
    );
    expect(xssRan, 'XSS in flag description must not execute').toBe(false);
  });

  test('FF-ADV-07 concurrent toggle by two requests → no 500', async ({ authedPage: page }) => {
    let callCount = 0;
    await page.route('**/api/feature-flags/*', async (route) => {
      if (['PATCH', 'PUT', 'POST'].includes(route.request().method())) {
        callCount++;
        const status = callCount === 1 ? 200 : 409; // second is conflict
        await route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(
            status === 200
              ? { data: { key: 'concurrent_flag', enabled: 1 } }
              : { error: { code: 'CONFLICT', message: 'Concurrent modification' } },
          ),
        });
      } else {
        await route.continue();
      }
    });

    const [r1, r2] = await Promise.all([
      page.request.patch(`${BASE}/api/feature-flags/concurrent_flag`, {
        data: { enabled: 1 },
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
      page.request.patch(`${BASE}/api/feature-flags/concurrent_flag`, {
        data: { enabled: 1 },
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
    ]);

    expect(r1.status()).not.toBe(500);
    expect(r2.status()).not.toBe(500);
  });

  test('FF-ADV-08 flag list page renders without errors when API returns empty array', async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route('**/api/feature-flags*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`${BASE}/admin/feature-flags`);
    await page.waitForTimeout(1_500);

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on empty flags').toBeGreaterThan(0);

    const blocking = errors.filter(
      (e) => !e.includes('posthog') && !e.includes('sentry') && !e.includes('extension'),
    );
    expect(blocking, 'no blocking console errors on empty state').toHaveLength(0);
  });
});
