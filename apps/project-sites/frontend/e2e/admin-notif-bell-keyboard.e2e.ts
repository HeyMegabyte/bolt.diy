/**
 * @file admin-notif-bell-keyboard.e2e.ts
 * @description The admin-shell notification bell dropdown items must be
 * keyboard-operable (WCAG 2.1.1) — i.e. real `<button>`s, not mouse-only
 * `<div (click)>`. (The separate `<app-notification-bell>` component was fixed
 * in 72c8a5b0; this verifies the INLINE admin-shell bell too.) Seeds
 * `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch {
      /* */
    }
  }, KEY);
}

test.describe('admin notification bell — keyboard operable', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('bell opens and its notification items are <button>s (not mouse-only divs)', async ({ page }) => {
    await seed(page);
    await page.goto('/admin/', { waitUntil: 'domcontentloaded' });
    const bell = page.locator('button[aria-label="Notifications"]');
    await bell.waitFor({ state: 'visible', timeout: 20000 });
    // Keyboard-activate the bell itself (it's a native <button>).
    await bell.focus();
    await page.keyboard.press('Enter');
    const pop = page.locator('.notif-pop').first();
    await expect(pop).toBeVisible();

    const items = page.locator('.notif-item');
    const n = await items.count();
    if (n === 0) {
      // Empty inbox is valid — assert the cockpit cyan-halo empty state (was a
      // bare grey ✦): a role=status region with a cyan-disc glyph, not default grey.
      const empty = page.locator('[data-testid="notif-empty"]');
      await expect(empty).toBeVisible();
      await expect(empty).toHaveAttribute('role', 'status');
      await expect(empty).toContainText(/caught up/i);
      const glyphColor = await page.locator('.notif-empty-glyph').evaluate((el) => getComputedStyle(el).color);
      expect(glyphColor).toBe('rgb(0, 229, 255)'); // cyan, not grey
      return;
    }
    // Every notification row must be a real <button> (native keyboard + Enter/Space),
    // never a mouse-only <div>.
    for (let i = 0; i < n; i++) {
      const tag = await items.nth(i).evaluate((el) => el.tagName.toLowerCase());
      expect(tag, `notif item ${i} is a <button>`).toBe('button');
    }
    // The first item is reachable + activatable by keyboard.
    await items.first().focus();
    await expect(items.first()).toBeFocused();
  });
});
