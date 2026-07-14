import { test, expect } from '@playwright/test';

test('find final 401', async ({ page }) => {
  const errors: Array<{ url: string; status: number; method: string }> = [];

  page.on('response', (resp) => {
    if (resp.status() >= 400 && resp.url().includes('/api/')) {
      errors.push({
        url: resp.url(),
        status: resp.status(),
        method: resp.request().method(),
      });
    }
  });

  // All known stubs
  await page.route('**/api/auth/me', async (r) => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { user_id: 'x', org_id: 'x', email: 'test@megabyte.space', display_name: 'Test', is_super_admin: 1 } }) });
  });
  await page.route(/\/api\/sites(\?.*)?$/, async (r) => {
    if (r.request().method() === 'GET') await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    else await r.continue();
  });
  await page.route('**/api/inbox/tasks**', async (r) => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/audit/**', async (r) => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) });
  });
  await page.route('**/api/admin/domains/**', async (r) => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) });
  });
  // Stub ALL /api/ that aren't already matched — catch any stragglers
  await page.route('**/api/**', async (r) => {
    if (r.request().url().includes('/api/auth/me') ||
        r.request().url().includes('/api/sites') ||
        r.request().url().includes('/api/inbox') ||
        r.request().url().includes('/api/audit') ||
        r.request().url().includes('/api/admin/domains')) {
      await r.continue(); // let the specific stubs handle it
    } else {
      console.log(`  UNSTUBBED: ${r.request().method()} ${r.request().url()}`);
      await r.continue();
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('ps_session', JSON.stringify({ token: 'x', email: 'test@megabyte.space' }));
    localStorage.setItem('ps_feedback_dismissed', 'true');
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await page.goto('/admin');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(6000);

  console.log('\n=== Remaining 4xx/5xx API ===');
  for (const e of errors) {
    console.log(`  ${e.method} ${e.status} ${e.url}`);
  }
});
