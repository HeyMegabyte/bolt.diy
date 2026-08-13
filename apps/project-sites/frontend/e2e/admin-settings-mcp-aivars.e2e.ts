import { test, expect, type Page } from '@playwright/test';

/**
 * Prod lock for the 2026-08-13 Settings tweaks:
 *  - The "Settings overview" stat-strip was removed.
 *  - The MCP tab now conveys that MCPs ALSO receive the project-wide AI vars
 *    (a callout + read-only key list + a link to the AI Env Vars tab), and the
 *    per-MCP "Import .env"/"Export .env" actions were dropped there.
 *
 * Seeds ps_session from E2E_API_KEY. Assertions hold regardless of the seed
 * org's connected-MCP / selected-site state (the callout + strip-absence are
 * template-level).
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts admin-settings-mcp-aivars
 */
const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

async function go(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1800);
}

test.describe('admin — Settings MCP AI-vars conveyance + overview removed (prod lock)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('the "Settings overview" stat-strip is gone', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings');
    await expect(page.locator('.stat-strip')).toHaveCount(0);
    await expect(page.locator('[aria-label="Settings overview"]')).toHaveCount(0);
  });

  test('MCP tab conveys that MCPs receive the project AI vars (callout + link)', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings#mcp');
    await expect(page.getByText('MCPs also use your project AI variables', { exact: false })).toBeVisible();
    const link = page.locator('[data-testid="mcp-aivars-link"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /#env-vars$/);
  });
});
