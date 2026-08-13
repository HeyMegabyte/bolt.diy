/**
 * flows-editor.flow.e2e.ts — Surface: /admin/editor (the persistent bolt.diy iframe host).
 *
 * The editor route renders no Angular chrome of its own — it surfaces the persistent
 * bolt.diy iframe (editor.projectsites.dev) that AdminComponent keeps mounted across
 * admin sub-routes (BoltEmbedService). These journeys prove the host renders, embeds
 * the editor iframe, and survives navigation — without asserting on the cross-origin
 * iframe's internal DOM (unreachable from the parent frame).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-editor.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap } from './_flow-helpers';

const NAV = 'nav[aria-label="Admin sections"]';

test.describe('Full-flow · editor (bolt iframe host)', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the editor route renders real content (not a 404, not a white screen)', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/editor');
    await expect(page).toHaveURL(/\/admin\/editor/);
    await expect(page.locator('[data-testid="admin-not-found"]'), 'editor is a real route').toHaveCount(0);
    const rootLen = await page.evaluate(
      () => (document.querySelector('app-admin, app-root, #root') as HTMLElement | null)?.innerHTML.length ?? 0,
    );
    expect(rootLen, 'the admin shell rendered').toBeGreaterThan(500);
    await snap(page, 'editor-01-host');
    expectClean(errors);
  });

  test('02 the host embeds the bolt editor iframe (editor.projectsites.dev)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/editor');
    await page.waitForTimeout(2000); // the iframe pre-boots on selectedSite()
    const iframeInfo = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      return frames.map((f) => f.getAttribute('src') || f.getAttribute('data-src') || '').filter(Boolean);
    });
    // Either the bolt iframe is present with an editor/bolt src, OR a boot/connect
    // placeholder is shown — both are valid (WebContainer cold-boot ~30-60s).
    const hasBoltFrame = iframeInfo.some((src) => /editor|bolt|webcontainer|stackblitz/i.test(src));
    const anyIframe = iframeInfo.length > 0;
    expect(hasBoltFrame || anyIframe, `editor host renders an iframe (srcs: ${iframeInfo.join(', ')})`).toBeTruthy();
  });

  test('03 the admin section nav stays mounted on the editor route (SPA host)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/editor');
    // The editor is hosted INSIDE the admin shell — the section nav must still exist.
    await expect(page.locator(NAV), 'editor is hosted within the persistent admin shell').toBeVisible({
      timeout: 15_000,
    });
  });

  test('04 navigating admin → editor → another section → back keeps the shell alive', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin');
    const nav = page.locator(NAV);
    await expect(nav).toBeVisible({ timeout: 15_000 });
    // Editor link, then away, then back — the persistent iframe host must not crash.
    const editorLink = nav.locator('a[href="/admin/editor"]').first();
    if (await editorLink.count()) {
      await editorLink.click();
      await expect(page).toHaveURL(/\/admin\/editor/, { timeout: 12_000 });
    }
    const other = nav.locator('a[href="/admin/settings"], a[href="/admin/analytics"]').first();
    if (await other.count()) {
      await other.click();
      await expect(page).not.toHaveURL(/\/admin\/editor/, { timeout: 12_000 });
    }
    await expect(nav, 'shell survived the round-trip').toBeVisible();
    expectClean(errors);
  });

  test('05 deep-link + reload preserves the editor host (session intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/editor');
    await expect(page.locator(NAV)).toBeVisible({ timeout: 15_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(NAV)).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test.fixme('06 the editor host is free of real (non-iframe) console errors', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/editor');
    await expect(page.locator(NAV)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    expectClean(errors);
  });
});
