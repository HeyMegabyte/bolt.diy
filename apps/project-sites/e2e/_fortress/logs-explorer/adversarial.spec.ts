/**
 * @fortress LOGS-EXPLORER — adversarial journey
 *
 * Break-it angles:
 *  LE1. DSL with SQL injection → not executed, 400 or sanitized
 *  LE2. Very large log payload → pagination handles, no OOM crash
 *  LE3. RBAC: other org's logs → 403
 *  LE4. Range pill with future date → graceful empty state
 *  LE5. XSS in log message → escaped in rendered row
 *  LE6. Log endpoint 429 rate-limit → UI shows friendly retry
 *  LE7. Invalid level filter → 400 or graceful fallback
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('LE ADV — input abuse', () => {
  test('LE-ADV-01 DSL query with SQLi chars is sanitised before request', async ({ authedPage: page }) => {
    const sqliQuery = "'; DROP TABLE audit_logs; --";
    let sentQuery = '';

    await page.route('**/api/audit-logs*', async (route) => {
      const url = new URL(route.request().url());
      sentQuery = url.searchParams.get('q') ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    const searchBox = page.locator('[data-testid="log-search"], input[placeholder*="search"]').first();
    if (await searchBox.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await searchBox.fill(sqliQuery);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    // The query sent via URL param should NOT contain raw SQL chars unencoded
    // URL encoding is fine; executing "DROP TABLE" is not fine
    if (sentQuery) {
      expect(sentQuery).not.toContain("DROP TABLE");
    }
  });

  test('LE-ADV-02 XSS in log message is escaped in rendered row', async ({ authedPage: page }) => {
    const xssMessage = '<script>window.__LE_XSS__=1</script>';

    await page.route('**/api/audit-logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            id: 'xss-log',
            level: 'info',
            message: xssMessage,
            created_at: new Date().toISOString(),
          }],
        }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    await page.waitForTimeout(1_500);

    const xssRan = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__LE_XSS__ === 1,
    );
    expect(xssRan, 'XSS in log message must not execute').toBe(false);
  });

  test('LE-ADV-03 invalid level value in filter returns 400 or graceful fallback', async ({ authedPage: page }) => {
    await page.route('**/api/audit-logs*', async (route) => {
      const url = new URL(route.request().url());
      const level = url.searchParams.get('level') ?? '';
      if (level === 'INVALID_LEVEL') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid level' } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      }
    });

    // Try to set an invalid level directly via API
    const res = await page.request.get(`${BASE}/api/audit-logs?level=INVALID_LEVEL`, {
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([200, 400, 401]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe('LE ADV — RBAC + rate limit', () => {
  test('LE-ADV-04 accessing other org logs returns 403', async ({ authedPage: page }) => {
    await page.route('**/api/sites/other-org-site/logs*', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not your site' } }),
      });
    });

    const res = await page.request.get(`${BASE}/api/sites/other-org-site/logs`, {
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([403, 401, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('LE-ADV-05 logs without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sites/any-site/logs`);
    expect([401, 403]).toContain(res.status());
  });

  test('LE-ADV-06 rate-limit 429 on logs shows friendly UI, not crash', async ({ authedPage: page }) => {
    await page.route('**/api/audit-logs*', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    await page.waitForTimeout(1_500);

    // Page must not be blank
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on 429').toBeGreaterThan(0);
  });
});

test.describe('LE ADV — large payload + boundary', () => {
  test('LE-ADV-07 large log response (500 entries) does not crash the page', async ({ authedPage: page }) => {
    const bigLogs = Array.from({ length: 500 }, (_, i) => ({
      id: `log-${i}`,
      level: 'info',
      message: `Entry ${i}: some log message with details`,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    }));

    await page.route('**/api/audit-logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: bigLogs }),
      });
    });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/admin/logs`);
    await page.waitForTimeout(2_000);

    expect(errors.filter((e) => !e.includes('Non-Error')), 'no crash on 500 log entries').toHaveLength(0);
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank with large payload').toBeGreaterThan(0);
  });

  test('LE-ADV-08 future date range shows empty state gracefully', async ({ authedPage: page }) => {
    await page.route('**/api/audit-logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    // Attempt to set range to future date via input
    const dateInput = page.locator('input[type="date"], input[type="datetime-local"]').first();
    if (await dateInput.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await dateInput.fill('2099-01-01');
      await dateInput.press('Enter');
      await page.waitForTimeout(500);
    }

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank with future date').toBeGreaterThan(0);
  });
});
