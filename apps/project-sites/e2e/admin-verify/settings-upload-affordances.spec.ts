/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the per-project Settings upload affordances
 * are PRESENT and CORRECTLY TYPE-CONSTRAINED: the AI-Chat knowledge dropzone accepts
 * PDFs (multiple), and the Business branding uploaders accept the right image types.
 * Proves the upload surfaces a real owner relies on exist + guard their input types —
 * WITHOUT ever selecting a file (no upload, no mutation).
 *
 * SITE-SCOPED: Settings content is per-project → `selectFirstSite` via the sidebar
 * switcher first. NON-MUTATING: asserts input presence + `accept`/`multiple` only.
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const openSettings = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  // Settings panels are per-project — pick a site FIRST via the sidebar switcher
  // (independent of the settings panel gating), then wait for the tabs to render.
  const ok = await selectFirstSite(page);
  if (ok) await page.locator('#settings-tab-general').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  return ok;
};

test.describe('Admin · settings upload affordances (P0-ADMIN)', () => {
  test('the AI-Chat knowledge dropzone accepts PDFs (present + type-constrained)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openSettings(page)), 'no site to scope Settings to');

    await page.locator('#settings-tab-ai-chat').click();
    const dropzone = page.locator('[data-testid="ai-chat-knowledge-dropzone"]');
    await expect(dropzone, 'the knowledge dropzone renders on the AI-Chat tab').toBeVisible({ timeout: 8000 });

    const pdfInput = dropzone.locator('input[type="file"]');
    await expect(pdfInput, 'the knowledge file input exists').toHaveCount(1);
    await expect(pdfInput, 'it accepts PDFs only').toHaveAttribute('accept', 'application/pdf');
    await expect(pdfInput, 'it allows multiple files').toHaveJSProperty('multiple', true);
  });

  test('the Business branding uploaders accept the right image types', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openSettings(page)), 'no site to scope Settings to');

    await page.locator('#settings-tab-business').click();
    const logo = page.locator('[data-testid="business-logo-upload"]');
    const icon = page.locator('[data-testid="business-icon-upload"]');

    await expect(logo, 'the logo uploader renders on the Business tab').toBeAttached({ timeout: 8000 });
    await expect(logo, 'the logo uploader accepts any image').toHaveAttribute('accept', 'image/*');
    await expect(icon, 'the icon uploader renders').toBeAttached();
    await expect(icon, 'the icon uploader constrains to png/jpeg/webp').toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/webp',
    );
  });
});
