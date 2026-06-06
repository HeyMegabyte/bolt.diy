/**
 * @file admin-palette-highlight.e2e.ts
 * @description The Cmd+K command palette highlights matched query chars with
 * <mark>. Those marks are injected via [innerHTML]="cmd._renderedTitle", so the
 * component-scoped `.cp-title mark` rule (Emulated encapsulation) never matched
 * them → browser-default BLACK-on-YELLOW, jarringly off-brand in the cyan/black
 * cockpit. The fix pierces encapsulation (`:host ::ng-deep`). This asserts the
 * live highlight is CYAN on a transparent background, not yellow. Seeds
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

test.describe('command palette — match highlight is on-brand cyan (not default yellow)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('the <mark> highlight is cyan #00E5FF on a transparent background', async ({ page }) => {
    await seed(page);
    await page.goto('/admin/sites', { waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-label="Open command palette"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('button[aria-label="Open command palette"]').click();
    const input = page.locator('.cp-panel input').first();
    await input.waitFor({ state: 'visible', timeout: 8000 });
    await input.fill('feat'); // matches "Feature Flags", "Forms", etc.
    const mark = page.locator('.cp-title mark').first();
    await mark.waitFor({ state: 'visible', timeout: 8000 });
    const style = await mark.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, bg: cs.backgroundColor };
    });
    // Cyan text (#00E5FF == rgb(0, 229, 255)), transparent bg — NOT black-on-yellow.
    expect(style.color).toBe('rgb(0, 229, 255)');
    expect(style.bg).toMatch(/rgba?\(0, 0, 0, 0\)|transparent/);
  });
});
