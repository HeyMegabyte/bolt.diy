/**
 * flows-referral.flow.e2e.ts — Surface: the refer-a-friend card (feature
 * `referral_loop`) on the /admin getting-started hub.
 *
 * FINISHED this fire — and it required a REAL WORKER BUG FIX first:
 * `GET /api/referral/code` returned 500 for EVERY org (the org-scoped service
 * INSERTed into the site-scoped `referral_codes` table without its NOT NULL
 * `site_id`). Fixed the service to anchor the code to the org's first site (and
 * return an empty code gracefully for site-less orgs). THEN built the
 * `<app-referral-card>` UI + wired it into the hub.
 *
 * Real testids: referral-widget, referral-code, referral-url, referral-copy,
 * referral-clicks, referral-conversions.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-referral.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const CARD = '[data-testid="referral-widget"]';

test.describe('Full-flow · referral', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the refer-a-friend card renders on the /admin hub with a code', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD), 'the referral card renders').toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /refer a friend/i })).toBeVisible();
    await expect(page.locator('[data-testid="referral-code"]'), 'a referral code is shown').toBeVisible();
    const code = (await page.locator('[data-testid="referral-code"]').innerText()).trim();
    expect(code, 'the code is a non-empty token').toMatch(/^[A-Z0-9]{4,}$/);
    await snap(page, 'referral-01-card');
    expectClean(errors);
  });

  test('02 the referral URL field shows a share link that embeds the code', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    const code = (await page.locator('[data-testid="referral-code"]').innerText()).trim();
    const url = await page.locator('[data-testid="referral-url"]').inputValue();
    expect(url, 'the share URL is a real projectsites link').toMatch(/^https:\/\/projectsites\.dev\/\?ref=/);
    expect(url, 'the share URL embeds the visible code').toContain(code);
  });

  test('03 ground-truth: the widget code reconciles with the API store', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    const api = await apiFetch<{ code: string; referral_url: string }>(page, '/api/referral/code');
    expect(api.status).toBe(200);
    expect(api.body.code, 'the store returns a real code (no more 500)').toMatch(/^[A-Z0-9]{4,}$/);
    const uiCode = (await page.locator('[data-testid="referral-code"]').innerText()).trim();
    expect(uiCode, 'display reconciles with store').toBe(api.body.code);
  });

  test('04 clicking Copy confirms with a "Copied" state (share action works)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    const copyBtn = page.locator('[data-testid="referral-copy"]');
    await expect(copyBtn).toHaveText(/copy link/i);
    await copyBtn.click();
    await expect(copyBtn, 'the button confirms the copy').toHaveText(/copied/i, { timeout: 5_000 });
    await snap(page, 'referral-04-copied');
  });

  test('05 the reward stats (clicks + signups) render as numbers', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    const clicks = (await page.locator('[data-testid="referral-clicks"]').innerText()).trim();
    const conv = (await page.locator('[data-testid="referral-conversions"]').innerText()).trim();
    expect(clicks, 'clicks is a number').toMatch(/^\d+$/);
    expect(conv, 'signups is a number').toMatch(/^\d+$/);
  });

  test('06 the referral surface is console-error-free (no 500 leaks through)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    expectClean(errors);
  });

  test('07 deep-link + reload preserves the referral card (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(CARD), 'still there after reload').toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('08 the referral code is STABLE across reloads (getOrCreate is idempotent)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    const first = (await page.locator('[data-testid="referral-code"]').innerText()).trim();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(CARD)).toBeVisible({ timeout: 15_000 });
    const second = (await page.locator('[data-testid="referral-code"]').innerText()).trim();
    expect(second, 'the same org keeps the same referral code').toBe(first);
  });

  test('09 full journey: land on hub → all three finished widgets present → referral usable + ground-truth', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    // The three hub widgets this loop finished all render on the getting-started hub.
    await expect(page.locator('[data-testid="onboarding-checklist"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="recent-activity"]')).toBeVisible();
    await expect(page.locator(CARD)).toBeVisible();
    // Referral is genuinely usable (real code from a fixed endpoint).
    const api = await apiFetch<{ code: string }>(page, '/api/referral/code');
    expect(api.status).toBe(200);
    expect(api.body.code).toMatch(/^[A-Z0-9]{4,}$/);
    await snap(page, 'referral-09-journey');
    expectClean(errors);
  });
});
