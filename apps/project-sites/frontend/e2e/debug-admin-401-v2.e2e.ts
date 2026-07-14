/**
 * Debug v2: find exact 401 URLs with full stubs in place.
 */
import { test, expect } from '@playwright/test';

test('exact 401 URLs on admin with stubs', async ({ page }) => {
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

  // Stub all known admin endpoints
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { user_id: 'x', org_id: 'x', email: 'test@megabyte.space', display_name: 'Test' } }) });
  });
  // Match /api/sites exactly, with or without query
  await page.route(/\/api\/sites(\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    } else {
      await route.continue();
    }
  });
  await page.route('**/api/inbox/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/audit/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) });
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

  console.log('\n=== 4xx/5xx API Responses ===');
  const seen = new Set<string>();
  for (const e of errors) {
    const key = `${e.method} ${e.status} ${e.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(`  ${key}`);
    }
  }

  if (errors.length === 0) {
    console.log('  (none — all clean!)');
  }
});
