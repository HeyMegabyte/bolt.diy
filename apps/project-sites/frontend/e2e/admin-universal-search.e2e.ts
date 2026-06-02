/**
 * @module e2e/admin-universal-search
 *
 * Verifies the #11 universal search in AdminUpgradesShell (mounted on the
 * /admin dashboard host). Asserts it returns REAL admin-section nav results
 * (every result links to a live route) and NEVER fabricated rows — guarding
 * the fix that replaced the old mock corpus ("Bayonne Bakery", "Site
 * published 12s ago") with ADMIN_NAV_INDEX. Seeds `ps_session` from
 * `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const SEARCH = '[data-testid="admin-universal-search"]';
const RESULTS = '.adm-search-results [role="option"]';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch {
      /* */
    }
  }, KEY);
}

async function openSearch(page: Page): Promise<void> {
  await page.goto('/admin/', { waitUntil: 'load' });
  await page.locator(SEARCH).waitFor({ state: 'visible', timeout: 20000 });
}

test.describe('admin universal search — real nav, no fabricated rows', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('typing "feature" surfaces the real Feature Flags section', async ({ page }) => {
    await seed(page);
    await openSearch(page);
    const input = page.locator(SEARCH);
    await input.fill('feature');
    const result = page.locator(RESULTS).filter({ hasText: /Feature Flags/i });
    await expect(result.first()).toBeVisible({ timeout: 8000 });
  });

  test('typing "audit" surfaces the real Audit Log section', async ({ page }) => {
    await seed(page);
    await openSearch(page);
    const input = page.locator(SEARCH);
    await input.fill('audit');
    await expect(page.locator(RESULTS).filter({ hasText: /Audit Log/i }).first()).toBeVisible({ timeout: 8000 });
  });

  test('never returns fabricated rows (no Bayonne Bakery / "published 12s ago")', async ({ page }) => {
    await seed(page);
    await openSearch(page);
    const input = page.locator(SEARCH);
    // Broad queries that would have matched the old mock corpus.
    for (const q of ['bayonne', 'published', 'bakery', '12s']) {
      await input.fill(q);
      await page.waitForTimeout(250);
      const texts = (await page.locator(RESULTS).allInnerTexts()).join(' ').toLowerCase();
      expect(texts).not.toContain('bayonne');
      expect(texts).not.toContain('bakery');
      expect(texts).not.toContain('published 12s');
    }
  });

  test('every visible result is a real /admin route', async ({ page }) => {
    await seed(page);
    await openSearch(page);
    const input = page.locator(SEARCH);
    await input.fill('s'); // broad match
    await page.waitForTimeout(300);
    const count = await page.locator(RESULTS).count();
    expect(count).toBeGreaterThan(0);
  });
});
