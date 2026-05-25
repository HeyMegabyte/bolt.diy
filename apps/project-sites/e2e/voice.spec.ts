import { test, expect } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Voice + SMS Agent (prod)', () => {
  test('homepage renders unified-AI cross-channel section', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(PROD, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Your AI, on every line/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/One AI, every channel/i)).toBeVisible();
    await expect(page.getByText(/82L-ABOR/)).toBeVisible();
    await expect(page.getByText(/AI receptionist/i)).toBeVisible();

    const blocking = errors.filter((e) =>
      !/posthog|gtag|google-analytics|cloudflareinsights|Failed to load resource/i.test(e),
    );
    expect(blocking).toEqual([]);
  });

  test('public API: voice numbers search is mounted (auth-gated)', async ({ request }) => {
    const r = await request.get(`${PROD}/api/voice/numbers/search?contains=ABOR`);
    expect(r.status()).toBe(401);
  });

  test('public API: vanity suggestions is mounted (auth-gated)', async ({ request }) => {
    const r = await request.get(`${PROD}/api/voice/vanity-suggestions?siteId=test`);
    expect(r.status()).toBe(401);
  });

  test('public API: health endpoint reachable', async ({ request }) => {
    const r = await request.get(`${PROD}/health`);
    expect(r.status()).toBe(200);
  });

  test('Voice route loads via SPA shell', async ({ page }) => {
    const r = await page.goto(`${PROD}/admin/voice`, { waitUntil: 'domcontentloaded' });
    expect(r?.status()).toBe(200);
  });
});
