/**
 * flows-super-admin.flow.e2e.ts — Surface: /admin/super-admin (operator layer).
 *
 * The e2e-test-org key is is_super_admin:FALSE (see /api/auth/me). This file proves
 * the operator GATE works: a non-super-admin lands on the "Super admin" route and
 * sees a "Restricted" state — NOT the privileged operator console, and never a white
 * screen or a leak of operator controls. (Full operator coverage needs a real
 * super-admin session — Browserbase-as-brian — tracked separately.)
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-super-admin.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

test.describe('Full-flow · super-admin gate', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the Super admin route renders (not a white screen, not a 404)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/super-admin');
    await expect(page).toHaveURL(/\/admin\/super-admin/);
    await expect(page.getByRole('heading', { name: /super admin/i }).first()).toBeVisible({ timeout: 15_000 });
    const mainLen = await page.evaluate(
      () => (document.querySelector('main, [role="main"], .admin-main') as HTMLElement | null)?.innerHTML.length ?? 0,
    );
    expect(mainLen, 'the route renders real content').toBeGreaterThan(200);
    await snap(page, 'superadmin-01');
    expectClean(errors);
  });

  test('02 a non-super-admin sees the RESTRICTED state (the operator gate holds)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/super-admin');
    await expect(
      page.getByText(/restricted|not authorized|super.?admin.*only|access denied|permission/i).first(),
      'a non-super-admin is gated out of the operator console',
    ).toBeVisible({ timeout: 15_000 });
    await snap(page, 'superadmin-02-restricted');
  });

  test('03 ground-truth: /api/auth/me confirms is_super_admin:false for this key', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/super-admin');
    const me = await apiFetch<{ data?: { is_super_admin?: boolean } }>(page, '/api/auth/me');
    expect(me.status).toBe(200);
    // The gate above is CORRECT precisely because this key is not a super admin.
    expect(me.body?.data?.is_super_admin ?? false, 'the e2e key is not a super admin').toBeFalsy();
  });

  test('04 no privileged operator write-controls leak to the non-super-admin view', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/super-admin');
    await expect(page.getByRole('heading', { name: /super admin/i }).first()).toBeVisible({ timeout: 15_000 });
    // Restricted view must not expose destructive operator actions.
    const dangerous = page.getByRole('button', { name: /impersonate|delete org|suspend|force|wipe|kill/i });
    expect(await dangerous.count(), 'no destructive operator controls are rendered for a restricted user').toBe(0);
  });

  test('05 deep-link + reload keeps the restricted state (session intact, no bounce)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/super-admin');
    await expect(page.getByRole('heading', { name: /super admin/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /super admin/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('06 the super-admin route is console-error-free for a restricted user', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/super-admin');
    await expect(page.getByRole('heading', { name: /super admin/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    expectClean(errors);
  });
});
