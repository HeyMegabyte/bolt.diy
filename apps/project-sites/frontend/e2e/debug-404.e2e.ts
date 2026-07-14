/**
 * Debug: identify which resources 404 on /admin after sign-in.
 */
import { test, expect } from '@playwright/test';

test('identify 404 resources on /admin after sign-in', async ({ page }) => {
  const apiKey = process.env.E2E_API_KEY;
  expect(apiKey).toBeTruthy();

  const errors: Array<{ type: string; text: string; url?: string }> = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push({ type: 'console', text: msg.text() });
    }
  });

  page.on('pageerror', (err) => {
    errors.push({ type: 'pageerror', text: err.message });
  });

  // Capture ALL failed network requests
  const failedRequests: Array<{ url: string; status: number }> = [];
  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      failedRequests.push({ url: resp.url(), status: resp.status() });
    }
  });

  // Also capture request failures (network errors, not HTTP errors)
  page.on('requestfailed', (req) => {
    failedRequests.push({
      url: req.url(),
      status: 0,
    });
  });

  await page.addInitScript(
    ({ key }: { key: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: key, email: 'test@megabyte.space' }),
      );
    },
    { key: apiKey! },
  );

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Navigate to admin
  await page.goto('/admin');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);

  console.log('=== FAILED NETWORK REQUESTS ===');
  for (const r of failedRequests) {
    console.log(`  ${r.status} ${r.url}`);
  }

  console.log('\n=== CONSOLE ERRORS ===');
  for (const e of errors) {
    console.log(`  [${e.type}] ${e.text}`);
  }

  // The failures are what we're investigating
  expect(failedRequests.length).toBeGreaterThanOrEqual(0);
});
