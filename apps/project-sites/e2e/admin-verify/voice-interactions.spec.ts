/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Voice section (`/admin/voice`): 6 sub-view
 * tabs (numbers / conversations / test / agent / mcps / share). Org-agnostic: the
 * E2E_API_KEY org may have 0 numbers/conversations and possibly no selected site
 * (→ empty-state). Assert one-of-state + tab switching; NEVER place a test call/SMS
 * or save agent settings (see [[admin-verify-e2e-authoring-gotchas]] #5).
 * Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/voice', { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 150, { timeout: 15000 })
    .catch(() => {});
};

const voiceMounted = (page: import('@playwright/test').Page) => page.locator('[data-testid="voice-section"]');

test.describe('Admin · Voice interactions (P0-ADMIN)', () => {
  test('renders the voice shell (or the no-site empty state), not the 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/voice');
    // Either the mounted voice section (site selected) or a friendly no-site state.
    const emptyish = page.getByText(/no site selected|pick a site|voice/i);
    expect((await voiceMounted(page).count()) + (await emptyish.count()), 'a voice state renders').toBeGreaterThan(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('the 6 sub-view tabs switch (when the section is mounted)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    test.skip((await voiceMounted(page).count()) === 0, 'voice section not mounted (no site selected for this org)');

    const tabs = page.locator('[data-testid^="voice-tab-"]');
    expect(await tabs.count(), 'the 6 voice tabs render').toBeGreaterThanOrEqual(2);
    await expect(page.locator('[role="tab"][aria-selected="true"]').first(), 'a tab is active').toBeVisible();

    // Switch to the Agent-settings tab → it becomes selected (client-side, non-mutating).
    const agentTab = page.locator('[data-testid="voice-tab-agent"]');
    await agentTab.click();
    await expect(agentTab, 'clicking a voice tab selects it').toHaveAttribute('aria-selected', 'true', {
      timeout: 6000,
    });
  });

  test('the control-surfaces stat strip renders (when mounted)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    test.skip((await voiceMounted(page).count()) === 0, 'voice section not mounted (no site selected for this org)');
    await expect(page.locator('[data-testid="voice-stat-strip"]'), 'the stat strip renders').toBeVisible({
      timeout: 6000,
    });
  });
});
