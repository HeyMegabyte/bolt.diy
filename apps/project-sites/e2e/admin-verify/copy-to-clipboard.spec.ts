/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — COPY-TO-CLIPBOARD interactions.
 *
 * A new interaction type for the admin-verify suite: click a "copy" affordance →
 * the exact value lands on the clipboard → a success toast confirms. Verified by
 * granting clipboard permission + reading `navigator.clipboard.readText()` back
 * (the strongest assertion — the real copied bytes), plus the toast UX.
 *
 * Two surfaces:
 *  1. Feature-flags — the flag-key button (`copyKey(flag.key)`) copies the key;
 *     the key is in the button's aria-label ("Copy flag key <key>") for a
 *     deterministic expected value.
 *  2. Domains — the "Copy" button (`copyBackup()`) copies the site's backup
 *     subdomain (`{slug}.projectsites.dev`).
 *
 * Both are client-side (clipboard write) → robust. Real session (E2E_API_KEY).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · copy-to-clipboard (P0-ADMIN)', () => {
  test('feature-flags: the flag-key button copies the exact key + toasts', async ({ page, context }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });

    const keyBtn = page.locator('.ff-key-btn').first();
    await keyBtn.waitFor({ state: 'visible', timeout: 15000 });

    // The exact key to expect comes from the button's aria-label ("Copy flag key <key>").
    const ariaLabel = (await keyBtn.getAttribute('aria-label')) ?? '';
    const key = ariaLabel.replace(/^Copy flag key\s+/i, '').trim();
    expect(key.length, 'the flag-key button must expose the key via aria-label').toBeGreaterThan(0);

    await keyBtn.click();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip, 'the clipboard must hold the exact flag key that was clicked').toBe(key);

    await expect(
      page.getByText(new RegExp(`Copied\\s+"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)),
      'a success toast must confirm the copy',
    ).toBeVisible({ timeout: 6000 });
  });

  test('domains: the Copy button copies the backup subdomain + toasts', async ({ page, context }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    // The backup-domain "Copy" is the first Copy button on the page (the ACTIVE
    // subdomain card); auth-code Copy buttons appear lower under connected domains.
    const copyBtn = page.getByRole('button', { name: /^Copy$/ }).first();
    await copyBtn.waitFor({ state: 'visible', timeout: 15000 });
    await copyBtn.click();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip, 'the clipboard must hold the backup subdomain').toContain('.projectsites.dev');

    await expect(
      page.getByText(/backup domain copied/i),
      'a success toast must confirm the copy',
    ).toBeVisible({ timeout: 6000 });
  });
});
