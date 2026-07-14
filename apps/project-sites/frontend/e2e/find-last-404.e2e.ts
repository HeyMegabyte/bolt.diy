import { test, expect } from '@playwright/test';

test('identify the exact 404 URL on /admin after real sign-in', async ({ page }) => {
  const password = process.env.E2E_TEST_PASSWORD;
  expect(password).toBeTruthy();

  const errors: Array<{ url: string; status: number }> = [];
  page.on('response', (resp) => {
    if (resp.status() >= 400 && resp.url().includes('/api/')) {
      errors.push({ url: resp.url(), status: resp.status() });
    }
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  const token: string = await page.evaluate(async (pwd: string) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'brian@megabyte.space', password: pwd }),
    });
    const data = await res.json();
    return data?.data?.token ?? '';
  }, password!);

  await page.evaluate((t: string) => {
    localStorage.setItem('ps_session', JSON.stringify({ token: t, email: 'brian@megabyte.space' }));
  }, token);

  await page.goto('/admin');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(6000);

  console.log('\n=== 4xx/5xx API Responses ===');
  for (const e of errors) {
    console.log(`  ${e.status} ${e.url}`);
  }
});
