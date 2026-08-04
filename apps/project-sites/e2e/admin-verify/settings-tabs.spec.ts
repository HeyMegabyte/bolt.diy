/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Settings TAB navigation (`/admin/settings`):
 * 8 tabs (General / Business / Team / AI Chat / MCP / AI Env Vars / Webhooks / Email).
 * Distinct from settings-value-domains.spec (General fields) — this exercises the tab
 * strip + each panel's marker. Non-mutating (never saves). Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./settings-tab-redirects.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
  await page.locator('[role="tab"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
};

test.describe('Admin · Settings tabs (P0-ADMIN)', () => {
  test('the tab strip renders all 8 tabs with one active by default', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/settings');
    expect(await page.locator('[role="tab"]').count(), 'all 8 settings tabs render').toBeGreaterThanOrEqual(8);
    await expect(page.locator('[role="tab"][aria-selected="true"]'), 'one tab is active by default').toHaveCount(1);
  });

  test('clicking the MCP tab activates it + reveals the integrations panel', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    const mcpTab = page.getByRole('tab', { name: /^MCP$/i });
    await mcpTab.click();
    await expect(mcpTab, 'the MCP tab becomes selected').toHaveAttribute('aria-selected', 'true', { timeout: 6000 });
    await expect(page.getByText(/MCP integrations/i).first(), 'the MCP panel renders').toBeVisible({ timeout: 8000 });
  });

  test('clicking the AI Chat tab reveals its panel', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    await page.getByRole('tab', { name: /ai chat/i }).click();
    await expect(
      page.getByText(/knowledge files for the AI chat widget/i).first(),
      'the AI Chat panel renders',
    ).toBeVisible({ timeout: 8000 });
  });

  test('clicking the Email tab reveals its panel', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    const emailTab = page.getByRole('tab', { name: /^Email$/i });
    await emailTab.click();
    await expect(emailTab, 'the Email tab becomes selected').toHaveAttribute('aria-selected', 'true', {
      timeout: 6000,
    });
    // The active panel is now the Email one (tab strip switches correctly).
    await expect(page.locator('[role="tab"][aria-selected="true"]'), 'exactly one tab is active after switching').toHaveCount(
      1,
    );
  });
});
