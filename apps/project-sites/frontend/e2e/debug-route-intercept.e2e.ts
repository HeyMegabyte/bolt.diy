/**
 * Minimal test: does page.route intercept at all?
 */
import { test, expect } from '@playwright/test';

test('verify page.route interception works', async ({ page }) => {
  let interceptCount = 0;
  const apiRequests: string[] = [];

  // Listen BEFORE any navigation
  page.on('request', (req) => {
    if (req.url().includes('/api/')) {
      apiRequests.push(`${req.method()} ${req.url()}`);
    }
  });

  // Simplest possible stub — intercept ALL /api/auth/me
  await page.route('**/api/auth/me', async (route) => {
    interceptCount++;
    console.log(`  INTERCEPTED #${interceptCount}: ${route.request().method()} ${route.request().url()}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { user_id: 'x', org_id: 'x', email: 'test@test.com', display_name: 'Test', is_super_admin: 1 } }),
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('ps_session', JSON.stringify({ token: 'x', email: 'test@megabyte.space' }));
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);

  console.log(`\nIntercept count: ${interceptCount}`);
  console.log('API requests:');
  for (const r of apiRequests) {
    console.log(`  ${r}`);
  }

  expect(interceptCount).toBeGreaterThan(0);
});
