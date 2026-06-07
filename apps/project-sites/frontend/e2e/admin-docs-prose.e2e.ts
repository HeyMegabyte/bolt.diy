/**
 * @file admin-docs-prose.e2e.ts
 * @description The /admin/docs reference renders markdown via [innerHTML] into
 * `.prose-docs`. Its child-element styles (links cyan #00E5FF + dashed underline,
 * code bg, list bullets) were SCOPED — under Emulated encapsulation they compile
 * to `el[_ngcontent-x]`, which the injected markdown never carries → DEAD. Links
 * fell back to inherited white (rgb(240,240,248)) — indistinguishable from body
 * text (WCAG 1.4.1). The fix pierces with `:host ::ng-deep`. This asserts the
 * live reference links are cyan. Seeds `ps_session` from `E2E_API_KEY`.
 * Run: `npm run test:e2e:prod`.
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

test.describe('docs reference markdown — cyan links (encapsulation pierced)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('a .prose-docs link is cyan #00E5FF, not inherited white', async ({ page }) => {
    await seed(page);
    await page.goto('/admin/docs', { waitUntil: 'domcontentloaded' });
    const link = page.locator('.prose-docs a').first();
    await link.waitFor({ state: 'attached', timeout: 20000 });
    const style = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, borderBottomStyle: cs.borderBottomStyle };
    });
    expect(style.color).toBe('rgb(0, 229, 255)');
    expect(style.borderBottomStyle).toBe('dashed');
  });
});
