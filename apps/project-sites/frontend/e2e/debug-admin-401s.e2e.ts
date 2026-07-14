/**
 * Debug: identify all 401 API calls on /admin after stub auth.
 */
import { test, expect } from '@playwright/test';

test('identify 401 endpoints on /admin', async ({ page }) => {
  const errors: Array<{ url: string; status: number }> = [];

  page.on('response', (resp) => {
    if (resp.status() >= 400 && resp.url().includes('/api/')) {
      errors.push({ url: resp.url(), status: resp.status() });
    }
  });

  // Stub /api/auth/me
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user_id: 'e2e-test-user',
          email: 'test@megabyte.space',
          name: 'E2E Test User',
          plan: 'pro',
        },
      }),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'e2e-stub-token', email: 'test@megabyte.space' }),
    );
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  await page.goto('/admin');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);

  console.log('\n=== 4xx/5xx API Responses on /admin ===');
  const unique = new Map<string, number>();
  for (const e of errors) {
    const key = `${e.status} ${e.url.replace(/\?.*/, '?…')}`;
    unique.set(key, (unique.get(key) || 0) + 1);
  }
  for (const [key, count] of unique) {
    console.log(`  ${key} (×${count})`);
  }
});
