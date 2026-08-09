/**
 * @module e2e/admin-confirm-dialog
 *
 * Verifies the branded {@link ConfirmService} that replaced native
 * `window.confirm()` across destructive admin actions (feature-flags killswitch,
 * domains remove-hostname, settings remove-member, ai-endpoints/ide delete, media
 * delete + bulk-delete, env-vars delete).
 *
 * TWO coverage paths (the E2E key is NOT super-admin + the e2e-test-org is data-sparse):
 *  1. SUPER-ADMIN — the feature-flags killswitch (always-present but sysAdminGuard'd) →
 *     SKIPS for the E2E key; covered by the Browserbase brian sweep.
 *  2. NON-SUPER-ADMIN (direct E2E-key coverage) — the user-settings API-key REVOKE confirm
 *     on the seeded `e2e-test-key`. /admin/user isn't super-admin-gated + the E2E org has
 *     one active key, so the branded confirm renders directly.
 * Both open → Esc → Cancel; the accept button is NEVER clicked. The revoke path also
 * `page.route`-ABORTS any DELETE so the live E2E key can never be revoked even on a
 * mis-edit; guards assert no native dialog + no real mutation.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect } from '@playwright/test';
import { isSessionSuperAdmin } from './helpers/super-admin.js';

const KEY = process.env.E2E_API_KEY ?? '';
// The specs in THIS describe drive the feature-flags killswitch — a SUPER-ADMIN surface
// (sysAdminGuard redirects non-super-admins), so they SKIP for the non-super-admin E2E
// key (that path is covered by the Browserbase brian sweep). The SECOND describe below
// gives the E2E-key suite DIRECT ConfirmService coverage via the user-settings api-key
// revoke — closing the prior "domains remove-hostname" follow-up (domains/snapshots are
// empty for the e2e-test-org, so the always-present api-key revoke is the reliable trigger).
let SUPER_ADMIN = false;

test.describe('admin ConfirmService — branded confirm, no native confirm()', () => {
  test.describe.configure({ retries: 1 });

  test.beforeAll(async ({ request }) => {
    SUPER_ADMIN = await isSessionSuperAdmin(request);
  });

  let nativeDialogFired = false;
  let killswitchPosted = false;

  test.beforeEach(async ({ page }) => {
    test.skip(
      !!KEY && !SUPER_ADMIN,
      'killswitch lives on the super-admin feature-flags surface — E2E key is not super-admin; covered by the Browserbase brian sweep',
    );
    nativeDialogFired = false;
    killswitchPosted = false;
    page.on('dialog', (d) => {
      nativeDialogFired = true;
      void d.dismiss().catch(() => undefined);
    });
    // Guard: fail if a real killswitch mutation ever leaves the browser.
    page.on('request', (r) => {
      if (/\/api\/super-admin\/feature-flags/.test(r.url()) && r.method() === 'POST') {
        killswitchPosted = true;
      }
    });
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
      } catch {
        /* ignore */
      }
    }, KEY);
  });

  test.skip(!KEY, 'E2E_API_KEY not set');

  test('killswitch opens the branded confirm; Esc + Cancel dismiss it (no native dialog, no mutation)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });

    const killBtn = page.locator('.ff-btn-danger').first();
    await expect(killBtn).toBeVisible({ timeout: 15000 });

    // 1) Open → branded dialog appears with the real, route-accurate message.
    await killBtn.click();
    const message = page.getByTestId('confirm-message');
    await expect(message).toBeVisible({ timeout: 5000 });
    await expect(message).toContainText(/kill/i);
    await expect(page.getByTestId('confirm-accept')).toBeVisible();
    await expect(page.getByTestId('confirm-cancel')).toBeVisible();

    // 2) Esc closes it (CDK overlay) — no action taken.
    await page.keyboard.press('Escape');
    await expect(message).toBeHidden({ timeout: 5000 });

    // 3) Reopen → Cancel button closes it.
    await killBtn.click();
    await expect(message).toBeVisible({ timeout: 5000 });
    await page.getByTestId('confirm-cancel').click();
    await expect(message).toBeHidden({ timeout: 5000 });

    // Safety + correctness invariants.
    expect(
      nativeDialogFired,
      'no native confirm()/alert() may fire — must be the branded dialog',
    ).toBe(false);
    expect(killswitchPosted, 'cancelling/Esc must NOT execute the killswitch mutation').toBe(false);
  });

  test('confirm dialog traps focus and restores it to the trigger on close (WCAG)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });

    const killBtn = page.locator('.ff-btn-danger').first();
    await expect(killBtn).toBeVisible({ timeout: 15000 });
    await killBtn.focus();

    await killBtn.click();
    await expect(page.getByTestId('confirm-message')).toBeVisible({ timeout: 5000 });

    // Focus must move INTO the dialog (cdkFocusInitial → the accept button).
    const focusInsideDialog = await page.evaluate(() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      return !!overlay && overlay.contains(document.activeElement);
    });
    expect(focusInsideDialog, 'focus must move into the dialog when it opens').toBe(true);

    // Tab stays trapped within the dialog (focus never escapes to the page behind).
    await page.keyboard.press('Tab');
    const stillTrapped = await page.evaluate(() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      return !!overlay && overlay.contains(document.activeElement);
    });
    expect(stillTrapped, 'Tab must stay trapped inside the dialog').toBe(true);

    // Esc closes and restores focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('confirm-message')).toBeHidden({ timeout: 5000 });
    await expect(killBtn).toBeFocused();

    expect(nativeDialogFired).toBe(false);
    expect(killswitchPosted).toBe(false);
  });
});

// NON-SUPER-ADMIN path — direct E2E-key coverage of ConfirmService via the user-settings
// API-key revoke. Unlike the killswitch (super-admin) these ALWAYS run for the E2E key.
test.describe('admin ConfirmService — non-super-admin (api-key revoke)', () => {
  test.describe.configure({ retries: 1 });
  test.skip(!KEY, 'E2E_API_KEY not set');

  let nativeDialogFired = false;
  let revokeReachedServer = false;

  test.beforeEach(async ({ page }) => {
    nativeDialogFired = false;
    revokeReachedServer = false;
    page.on('dialog', (d) => {
      nativeDialogFired = true;
      void d.dismiss().catch(() => undefined);
    });
    // SAFETY: abort any api-key DELETE so the LIVE e2e-test-key can never be revoked,
    // even if a future edit accidentally clicks accept. The specs only Esc/Cancel.
    await page.route('**/api/admin/api-keys/**', async (route) => {
      if (route.request().method() === 'DELETE') {
        revokeReachedServer = true;
        await route.abort();
      } else {
        await route.continue();
      }
    });
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
      } catch {
        /* ignore */
      }
    }, KEY);
  });

  test('revoke opens the branded confirm; Esc + Cancel dismiss it (no native dialog, no revoke)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin/user', { waitUntil: 'load' });

    // The E2E org has one active api key → its Revoke button renders (non-super-admin).
    const revokeBtn = page.locator('[data-testid^="apikey-revoke-"]').first();
    await expect(revokeBtn).toBeVisible({ timeout: 15000 });

    // 1) Open → branded dialog with the real, route-accurate revoke message.
    await revokeBtn.click();
    const message = page.getByTestId('confirm-message');
    await expect(message).toBeVisible({ timeout: 5000 });
    await expect(message).toContainText(/revoke/i);
    await expect(page.getByTestId('confirm-accept')).toBeVisible();
    await expect(page.getByTestId('confirm-cancel')).toBeVisible();

    // 2) Esc closes it — no action taken.
    await page.keyboard.press('Escape');
    await expect(message).toBeHidden({ timeout: 5000 });

    // 3) Reopen → Cancel closes it. The accept button is NEVER clicked.
    await revokeBtn.click();
    await expect(message).toBeVisible({ timeout: 5000 });
    await page.getByTestId('confirm-cancel').click();
    await expect(message).toBeHidden({ timeout: 5000 });

    expect(nativeDialogFired, 'no native confirm()/alert() may fire — must be the branded dialog').toBe(false);
    expect(revokeReachedServer, 'cancelling/Esc must NOT fire the revoke DELETE').toBe(false);
  });

  test('revoke confirm traps focus and restores it to the trigger on close (WCAG)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.goto('/admin/user', { waitUntil: 'load' });

    const revokeBtn = page.locator('[data-testid^="apikey-revoke-"]').first();
    await expect(revokeBtn).toBeVisible({ timeout: 15000 });
    await revokeBtn.focus();

    await revokeBtn.click();
    await expect(page.getByTestId('confirm-message')).toBeVisible({ timeout: 5000 });

    const focusInsideDialog = await page.evaluate(() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      return !!overlay && overlay.contains(document.activeElement);
    });
    expect(focusInsideDialog, 'focus must move into the dialog when it opens').toBe(true);

    await page.keyboard.press('Tab');
    const stillTrapped = await page.evaluate(() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      return !!overlay && overlay.contains(document.activeElement);
    });
    expect(stillTrapped, 'Tab must stay trapped inside the dialog').toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('confirm-message')).toBeHidden({ timeout: 5000 });
    await expect(revokeBtn).toBeFocused();

    expect(nativeDialogFired).toBe(false);
    expect(revokeReachedServer).toBe(false);
  });
});
