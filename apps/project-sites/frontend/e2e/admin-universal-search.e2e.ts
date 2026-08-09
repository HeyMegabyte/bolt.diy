/**
 * @module e2e/admin-universal-search
 *
 * The admin **Cmd+K command palette** (`command-palette.component`) IS the
 * universal search. HISTORY: this spec targeted the old always-visible
 * AdminUpgradesShell search box (`[data-testid="admin-universal-search"]` +
 * `.adm-search-results`) — that upgrade shell was REMOVED, so the box no longer
 * exists. Rewritten 2026-08-09 to drive the CURRENT palette: open via ⌘K/Ctrl+K
 * → type in `[data-testid="palette-input"]` → results are
 * `[data-testid="palette-results"] [role="option"]`. It must surface REAL admin
 * results and NEVER the old fabricated mock corpus ("Bayonne Bakery",
 * "published 12s ago"). (Feature Flags is intentionally NOT asserted — it's a
 * super-admin-gated section the non-super-admin E2E key may not see; Audit +
 * Analytics are live org-scoped sections that always surface.)
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const INPUT = '[data-testid="palette-input"]';
const RESULTS = '[data-testid="palette-results"] [role="option"]';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
    } catch {
      /* private mode */
    }
  }, KEY);
}

/** Open the Cmd+K command palette on /admin and wait for its input. */
async function openPalette(page: Page): Promise<void> {
  await page.goto('/admin/', { waitUntil: 'load' });
  await expect(page.locator('.admin-sidebar, app-admin, [data-cockpit]').first()).toBeVisible({
    timeout: 30000,
  });
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator(INPUT)).toBeVisible({ timeout: 15000 });
}

test.describe('admin universal search (Cmd+K palette) — real nav, no fabricated rows', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('typing "analytics" surfaces the real Analytics section', async ({ page }) => {
    await seed(page);
    await openPalette(page);
    await page.locator(INPUT).fill('analytics');
    await expect(
      page
        .locator(RESULTS)
        .filter({ hasText: /analytics/i })
        .first(),
      'searching "analytics" must surface the live Analytics section',
    ).toBeVisible({ timeout: 8000 });
  });

  test('never returns fabricated rows (no Bayonne Bakery / "published 12s ago")', async ({
    page,
  }) => {
    await seed(page);
    await openPalette(page);
    // Type the DISTINCTIVE old-mock strings. NB: the palette legitimately
    // surfaces REAL sites (a "Switch to Acme Bakery … published" row is a real
    // org site + status), so generic "bakery"/"published" are NOT forbidden —
    // only the exact fabricated corpus ("Bayonne Bakery", "published 12s ago").
    for (const q of ['bayonne', 'published 12s']) {
      await page.locator(INPUT).fill(q);
      await page.waitForTimeout(300);
      const texts = (await page.locator(RESULTS).allInnerTexts()).join(' ').toLowerCase();
      expect(texts, `"${q}" must not surface the old fabricated corpus`).not.toContain('bayonne');
      expect(texts).not.toContain('published 12s');
    }
  });

  test('a broad query returns real results (palette wired to a live corpus)', async ({ page }) => {
    await seed(page);
    await openPalette(page);
    await page.locator(INPUT).fill('s'); // broad match
    await expect
      .poll(async () => page.locator(RESULTS).count(), { timeout: 8000 })
      .toBeGreaterThan(0);
    // Every visible result must render a non-empty title (not an empty shell).
    const texts = await page.locator(RESULTS).allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    expect(
      texts.every((t) => t.trim().length > 0),
      'every palette result renders a real, non-empty title',
    ).toBe(true);
  });
});
