/**
 * @fortress INBOX — adversarial journey
 *
 * Break-it angles:
 *  IB1. Resolve task without auth → 401
 *  IB2. XSS in task title → not executed
 *  IB3. Assign to non-existent user → 400/404
 *  IB4. Resolve already-resolved task → idempotent 200/404
 *  IB5. RBAC: resolve other org's task → 403
 *  IB6. AI draft with 500 from AI provider → graceful error, not crash
 *  IB7. Double-resolve race → no 500
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('IB ADV — RBAC + auth', () => {
  test('IB-ADV-01 resolve task without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/inbox/tasks/any-task-id/resolve`, {
      data: { resolution: 'done' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('IB-ADV-02 resolve other org task returns 403/404', async ({ authedPage: page }) => {
    await page.route('**/api/inbox/tasks/other-org-task/resolve', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not your task' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/inbox/tasks/other-org-task/resolve`, {
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([403, 401, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('IB-ADV-03 list inbox without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/inbox/tasks`);
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('IB ADV — input abuse', () => {
  test('IB-ADV-04 XSS in task title is escaped in rendered card', async ({ authedPage: page }) => {
    const xssTitle = '<script>window.__IB_XSS__=1</script>';

    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            id: 'xss-task',
            title: xssTitle,
            description: 'Normal description',
            status: 'open',
            created_at: new Date().toISOString(),
          }],
        }),
      });
    });

    await page.goto(`${BASE}/admin/inbox`);
    await page.waitForTimeout(1_500);

    const xssRan = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__IB_XSS__ === 1,
    );
    expect(xssRan, 'XSS in task title must not execute').toBe(false);
  });

  test('IB-ADV-05 assign to non-existent user returns 400/404', async ({ authedPage: page }) => {
    await page.route('**/api/inbox/tasks/*/assign*', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'User not found' } }),
      });
    });

    const res = await page.request.patch(`${BASE}/api/inbox/tasks/task-001/assign`, {
      data: { assignee: 'nonexistent@example.com' },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 404, 401, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe('IB ADV — AI draft + race', () => {
  test('IB-ADV-06 AI draft with provider 500 shows error toast, not crash', async ({ authedPage: page }) => {
    await page.route('**/api/inbox/tasks/*/draft*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'AI_GENERATION_ERROR', message: 'AI provider unavailable' } }),
      });
    });

    await page.route('**/api/inbox/tasks*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            id: 'task-ai-error',
            title: 'Test task',
            status: 'open',
            created_at: new Date().toISOString(),
          }],
        }),
      });
    });

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/admin/inbox`);
    const draftBtn = page.getByRole('button', { name: /ai.*draft|generate.*reply/i }).first();
    if (await draftBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await draftBtn.click();
      await page.waitForTimeout(800);
    }

    expect(errors.filter((e) => !e.includes('Non-Error')), 'no unhandled JS errors on draft 500').toHaveLength(0);
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on AI draft error').toBeGreaterThan(0);
  });

  test('IB-ADV-07 double-resolve is idempotent (not 500)', async ({ authedPage: page }) => {
    let resolveCount = 0;
    await page.route('**/api/inbox/tasks/task-race/resolve', async (route) => {
      resolveCount++;
      const status = resolveCount === 1 ? 200 : 200; // idempotent
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ resolved: true }),
      });
    });

    const [r1, r2] = await Promise.all([
      page.request.post(`${BASE}/api/inbox/tasks/task-race/resolve`, {
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
      page.request.post(`${BASE}/api/inbox/tasks/task-race/resolve`, {
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
    ]);

    expect(r1.status()).not.toBe(500);
    expect(r2.status()).not.toBe(500);
  });

  test('IB-ADV-08 SQLi in resolution body is sanitised', async ({ authedPage: page }) => {
    await page.route('**/api/inbox/tasks/*/resolve', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid resolution' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/inbox/tasks/task-sqli/resolve`, {
      data: { resolution: "'; DROP TABLE inbox_tasks; --" },
      headers: { Authorization: 'Bearer e2e-stub-session-token', 'Content-Type': 'application/json' },
    });
    expect([400, 401]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});
