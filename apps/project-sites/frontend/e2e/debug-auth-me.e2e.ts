/**
 * Debug: intercept /api/auth/me to see request/response details.
 */
import { test, expect } from '@playwright/test';

test('inspect /api/auth/me request', async ({ page }) => {
  const apiKey = process.env.E2E_API_KEY;
  expect(apiKey).toBeTruthy();

  let authMeRequest: { headers: Record<string, string>; method: string } | null = null;
  let authMeResponse: { status: number; body: string } | null = null;

  // Intercept to inspect without blocking
  await page.route('**/api/auth/me', async (route) => {
    authMeRequest = {
      headers: route.request().headers(),
      method: route.request().method(),
    };
    // Let it through to the server
    const response = await route.fetch();
    authMeResponse = {
      status: response.status(),
      body: (await response.text()).slice(0, 500),
    };
    await route.fulfill({ response });
  });

  // Also listen for all /api responses
  const apiResponses: Array<{ url: string; status: number }> = [];
  page.on('response', (resp) => {
    if (resp.url().includes('/api/')) {
      apiResponses.push({ url: resp.url(), status: resp.status() });
    }
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
  await page.waitForTimeout(3000);

  console.log('\n=== Request to /api/auth/me ===');
  console.log(JSON.stringify(authMeRequest, null, 2));
  console.log('\n=== Response from /api/auth/me ===');
  console.log(JSON.stringify(authMeResponse, null, 2));

  console.log('\n=== ALL /api/* Responses ===');
  for (const r of apiResponses) {
    console.log(`  ${r.status} ${r.url}`);
  }
});
