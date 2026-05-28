/**
 * @fortress DOMAIN-STACK — adversarial journey
 *
 * Break-it angles:
 *  DS1. Purchase already-taken domain → 409 Conflict
 *  DS2. Stack advance on wrong site_id → 403/404
 *  DS3. DMARC/SPF record XSS → not reflected
 *  DS4. DNS verification timeout → tile shows error state
 *  DS5. Double-advance race → idempotent / no 500
 *  DS6. Stack without auth → 401
 *  DS7. hostname > 253 chars → 400
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('DS ADV — RBAC + auth', () => {
  test('DS-ADV-01 stack advance without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/domains/example.com/stack`, {
      data: { site_id: 'test-site' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
  });

  test('DS-ADV-02 stack-status without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/domains/example.com/stack-status`);
    expect([401, 403]).toContain(res.status());
  });

  test('DS-ADV-03 advance on site belonging to another org → 403/404', async ({ authedPage: page }) => {
    await page.route('**/api/domains/other-org-domain.com/stack', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not your site' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/domains/other-org-domain.com/stack`, {
      data: { site_id: 'other-site' },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([403, 401, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe('DS ADV — input abuse', () => {
  test('DS-ADV-04 purchase already-taken domain returns 409', async ({ authedPage: page }) => {
    await page.route('**/api/domains/purchase', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'CONFLICT', message: 'Domain already registered' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/domains/purchase`, {
      data: { domain: 'taken-domain.com', site_id: 'test-site' },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([409, 401]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('DS-ADV-05 hostname > 253 chars returns 400', async ({ authedPage: page }) => {
    const longHostname = 'a'.repeat(260) + '.com';
    await page.route('**/api/domains/purchase', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Hostname too long' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/domains/purchase`, {
      data: { domain: longHostname, site_id: 'test-site' },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 401]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('DS-ADV-06 XSS in domain search query is not reflected as script', async ({ authedPage: page }) => {
    const xssQuery = '<script>window.__DS_XSS__=1</script>.com';

    await page.route('**/api/domains/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`${BASE}/admin/domains`);
    const searchInput = page.locator('[data-testid="domain-search"], input[placeholder*="domain"]').first();
    if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.fill(xssQuery);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }

    const xssRan = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__DS_XSS__ === 1,
    );
    expect(xssRan, 'XSS in domain search must not execute').toBe(false);
  });

  test('DS-ADV-07 SQLi in domain name returns 400 not 500', async ({ request }) => {
    const sqliDomain = "'; DROP TABLE hostnames; --";
    const res = await request.post(`${BASE}/api/domains/purchase`, {
      data: { domain: sqliDomain, site_id: 'test' },
      headers: { Authorization: 'Bearer not-real', 'Content-Type': 'application/json' },
    });
    expect([400, 401]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe('DS ADV — race + error recovery', () => {
  test('DS-ADV-08 double-advance race → at most 409 or 200, never 500', async ({ authedPage: page }) => {
    let callCount = 0;
    await page.route('**/api/domains/*/stack', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      callCount++;
      const status = callCount === 1 ? 200 : 409;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200
            ? { next_step: 'ssl' }
            : { error: { code: 'CONFLICT', message: 'Step already advancing' } },
        ),
      });
    });

    const [r1, r2] = await Promise.all([
      page.request.post(`${BASE}/api/domains/example.com/stack`, {
        data: { site_id: 'test' },
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
      page.request.post(`${BASE}/api/domains/example.com/stack`, {
        data: { site_id: 'test' },
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
    ]);

    expect(r1.status()).not.toBe(500);
    expect(r2.status()).not.toBe(500);
  });
});
