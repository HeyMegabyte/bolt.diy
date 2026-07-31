import { resilientGet } from './helpers/api-request.js';
import { test, expect } from '@playwright/test';

const PROD = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Voice + SMS Agent (prod)', () => {
  // RETIRED (2026-07-31): "homepage renders unified-AI cross-channel section".
  // That test asserted copy from the OLD vanilla marketing homepage. The live
  // Angular homepage (frontend/src/app/pages/homepage/homepage.component.html)
  // contains NO voice/unified-AI section — the copy migrated into the admin
  // Voice section: "One AI, every channel" is now the share-surface kicker
  // (frontend/src/app/pages/admin/sections/voice/share.component.ts:47) and
  // "82L-ABOR" is the vanity-number rendering example
  // (frontend/src/app/pages/admin/sections/voice/numbers.component.ts:609).
  // Replacement: assert the /admin/voice entry surface exists behind the auth
  // gate — guards/auth.guard.ts returns a UrlTree to /signin?returnUrl=<url>.
  test('voice entry surface: /admin/voice is auth-gated to sign-in', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${PROD}/admin/voice`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/signin**', { timeout: 15_000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible({ timeout: 15_000 });
    // Guard preserves the requested route for the post-signin handoff.
    expect(page.url()).toContain('returnUrl');

    const blocking = errors.filter((e) =>
      !/posthog|gtag|google-analytics|cloudflareinsights|Failed to load resource/i.test(e),
    );
    expect(blocking).toEqual([]);
  });

  test('public API: voice numbers search is mounted (auth-gated)', async ({ request }) => {
    const r = await resilientGet(request, `${PROD}/api/voice/numbers/search?contains=ABOR`);
    expect(r.status()).toBe(401);
  });

  test('public API: vanity suggestions is mounted (auth-gated)', async ({ request }) => {
    const r = await resilientGet(request, `${PROD}/api/voice/vanity-suggestions?siteId=test`);
    expect(r.status()).toBe(401);
  });

  test('public API: health endpoint reachable', async ({ request }) => {
    const r = await resilientGet(request, `${PROD}/health`);
    expect(r.status()).toBe(200);
  });

  test('Voice route loads via SPA shell', async ({ page }) => {
    const r = await page.goto(`${PROD}/admin/voice`, { waitUntil: 'domcontentloaded' });
    expect(r?.status()).toBe(200);
  });
});
