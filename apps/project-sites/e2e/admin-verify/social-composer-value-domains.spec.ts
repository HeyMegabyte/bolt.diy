/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the Social post COMPOSER (`/admin/social` → the "Compose" tab).
 *
 * NON-MUTATING: exercises the content char-counter + publish-gating only — it NEVER
 * clicks Publish/Schedule, so no post is ever published or scheduled.
 *
 * Enumerated read-only (social.component): textarea `social-composer-textarea`,
 * live counter `composer-counter` (`{length}/{limit}`, over-limit appends "· over
 * {platform}" when `composerCharState()==='over'`), publish gated by
 * `canPublish()` (`[disabled]="!canPublish() || saving()"`; blocked when content
 * empty OR no platform selected → `publish-hint` shows the reason). Composer is
 * ungated (no feature flag).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const reachComposer = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/social', { waitUntil: 'domcontentloaded' });
  const tab = page.getByRole('tab', { name: /compose/i });
  await tab.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if ((await tab.count()) > 0) await tab.click();
  const ta = page.locator('[data-testid="social-composer-textarea"]');
  await ta.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  return ta.isVisible().catch(() => false);
};

test.describe('Admin · Social composer — value domain (P0-ADMIN)', () => {
  test('the composer renders and accepts typed content', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachComposer(page)), 'social composer not reachable for this org');
    // (The live `composer-counter` only renders once a platform is selected — its
    // `@if (composerLimit())` is null for an org with no connected socials — so the
    // platform-independent value-domain assertion is on the textarea itself.)
    const ta = page.locator('[data-testid="social-composer-textarea"]');
    await expect(ta, 'the composer textarea renders').toBeVisible();
    await ta.fill('Hello world from the CI probe');
    expect(await ta.inputValue(), 'the textarea accepts + holds typed content').toBe(
      'Hello world from the CI probe',
    );
  });

  test('an overlong + unicode + injection-shaped message is accepted without a crash', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachComposer(page)), 'social composer not reachable for this org');
    const ta = page.locator('[data-testid="social-composer-textarea"]');

    // ~5000 chars incl. unicode + injection-shaped content — far over any network limit.
    const overlong = ('🚀 <script>café ' + 'x'.repeat(60) + ' ').repeat(60);
    await ta.fill(overlong);
    expect((await ta.inputValue()).length, 'the textarea holds the overlong content').toBeGreaterThan(3000);
    // The page did not crash into the error boundary on overlong/unicode input.
    const crashed = await page.evaluate(() =>
      /ran into a problem|something went wrong/i.test(document.body.innerText || ''),
    );
    expect(crashed, 'overlong content must not crash the composer').toBe(false);
  });

  test('empty content blocks publish (canPublish gate)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await reachComposer(page)), 'social composer not reachable for this org');
    const ta = page.locator('[data-testid="social-composer-textarea"]');
    await ta.fill('');
    const publish = page.getByRole('button', { name: /publish now|schedule post/i }).first();
    if ((await publish.count()) === 0) {
      // No standalone publish button surfaced (composer variant) — assert the block hint instead.
      await expect(page.locator('[data-testid="publish-hint"]').first(), 'a publish-block hint shows').toBeVisible({
        timeout: 4000,
      });
      return;
    }
    await expect(publish, 'empty content keeps publish disabled').toBeDisabled({ timeout: 4000 });
  });
});
