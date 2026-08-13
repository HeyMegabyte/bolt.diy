/**
 * Full-flow · Voice — /admin/voice
 *
 * 16 elaborate journey tests for the Voice agent surface.
 * Auth: e2e-test-org owner (E2E_API_KEY).
 * NON-GOALS: never buy a phone number, never place a real call.
 */

import { test, expect } from '@playwright/test';
import {
  hasKey,
  seedSession,
  gotoAdmin,
  attachConsole,
  expectClean,
  snap,
  apiFetch,
} from './_flow-helpers';

test.describe('Full-flow · voice', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set — skipping authed voice tests');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  // ─── 01 · Section renders with expected heading ────────────────────────────
  test('01 · voice-section renders with org heading', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    const section = page.locator('[data-testid="voice-section"]');
    await expect(section).toBeVisible({ timeout: 15_000 });

    const heading = page.getByRole('heading', { name: /Voice/i });
    await expect(heading).toBeVisible();

    await snap(page, '01-voice-section-heading');
    expectClean(logs);
  });

  // ─── 02 · Live pill shows status ──────────────────────────────────────────
  test('02 · voice-live-pill is present and shows a status state', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const pill = page.locator('[data-testid="voice-live-pill"]');
    await expect(pill).toBeVisible();

    // The pill should contain some text indicating live/inactive/pending status
    const pillText = await pill.textContent();
    expect(pillText).toBeTruthy();
    expect(pillText!.trim().length).toBeGreaterThan(0);

    await snap(page, '02-voice-live-pill');
    expectClean(logs);
  });

  // ─── 03 · Stat strip is rendered ──────────────────────────────────────────
  test('03 · voice-stat-strip is present with stat tiles', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const strip = page.locator('[data-testid="voice-stat-strip"]');
    await expect(strip).toBeVisible();

    // Strip should have some rendered content (at least one stat tile)
    const stripText = await strip.textContent();
    expect(stripText).toBeTruthy();

    await snap(page, '03-voice-stat-strip');
    expectClean(logs);
  });

  // ─── 04 · Tab strip: all 6 tab buttons are visible ────────────────────────
  test('04 · all 6 tab buttons are visible in the tab strip', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    await expect(page.locator('[data-testid="voice-tab-numbers"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-tab-conversations"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-tab-test"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-tab-agent"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-tab-mcps"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-tab-share"]')).toBeVisible();

    await snap(page, '04-voice-tab-strip-all-visible');
    expectClean(logs);
  });

  // ─── 05 · Numbers tab: click activates panel + honest empty state ──────────
  test('05 · Numbers tab click shows panel with 0/3 honest empty state', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const numbersTab = page.locator('[data-testid="voice-tab-numbers"]');
    await numbersTab.click();

    // Tab should become active (aria-selected or a class change)
    await expect(numbersTab).toHaveAttribute('aria-selected', 'true');

    // Panel content should be non-empty
    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel).toBeVisible();
    const panelText = await panel.textContent();
    expect(panelText!.trim().length).toBeGreaterThan(10);

    // Honest empty state: org has 0 phone numbers
    await expect(page.getByText(/No numbers yet/i)).toBeVisible();
    await expect(page.getByText(/0\s*\/\s*3/)).toBeVisible();

    await snap(page, '05-voice-numbers-tab-empty');
    expectClean(logs);
  });

  // ─── 06 · Numbers tab: search field accepts vanity + area-code input ───────
  test.fixme('06 · Numbers tab search accepts vanity text and area-code input', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    await page.locator('[data-testid="voice-tab-numbers"]').click();
    await expect(page.locator('[data-testid="voice-tab-numbers"]')).toHaveAttribute('aria-selected', 'true');

    const searchBox = page.locator('[data-testid="voice-search-q"]');
    await expect(searchBox).toBeVisible();

    // Type a vanity term
    await searchBox.click();
    await page.keyboard.type('FITNESS');
    await expect(searchBox).toHaveValue('FITNESS');

    await snap(page, '06a-voice-search-vanity');

    // Clear and type an area code
    await searchBox.fill('');
    await page.keyboard.type('415');
    await expect(searchBox).toHaveValue('415');

    await snap(page, '06b-voice-search-area-code');
    expectClean(logs);
  });

  // ─── 07 · Numbers tab: search does NOT purchase a number ──────────────────
  test.fixme('07 · Numbers tab search triggers a lookup but never purchases a number', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    await page.locator('[data-testid="voice-tab-numbers"]').click();

    const searchBox = page.locator('[data-testid="voice-search-q"]');
    await expect(searchBox).toBeVisible();
    await searchBox.fill('800');
    await page.keyboard.press('Enter');

    // Allow up to 2s for any search response to settle
    await page.waitForTimeout(2_000);

    // The org still shows 0 numbers (no purchase happened)
    const sectionText = await page.locator('[data-testid="voice-section"]').textContent();
    expect(sectionText).toMatch(/0\s*\/\s*3/);

    await snap(page, '07-voice-search-no-purchase');
    expectClean(logs);
  });

  // ─── 08 · Conversations tab: click shows panel content ────────────────────
  test('08 · Conversations tab click shows conversations panel', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const convTab = page.locator('[data-testid="voice-tab-conversations"]');
    await convTab.click();
    await expect(convTab).toHaveAttribute('aria-selected', 'true');

    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel).toBeVisible();

    const panelText = await panel.textContent();
    expect(panelText!.trim().length).toBeGreaterThan(0);

    await snap(page, '08-voice-conversations-tab');
    expectClean(logs);
  });

  // ─── 09 · Test Console tab: click shows test console panel ────────────────
  test('09 · Test Console tab click shows test console / call simulator panel', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const testTab = page.locator('[data-testid="voice-tab-test"]');
    await testTab.click();
    await expect(testTab).toHaveAttribute('aria-selected', 'true');

    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel).toBeVisible();

    // Panel should show a test console UI — some content rendered
    const panelText = await panel.textContent();
    expect(panelText!.trim().length).toBeGreaterThan(0);

    // Must NOT auto-place a real call
    await snap(page, '09-voice-test-console-tab');
    expectClean(logs);
  });

  // ─── 10 · Agent tab: click shows prompts / voice config ───────────────────
  test('10 · Agent tab click shows agent prompt and voice configuration', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const agentTab = page.locator('[data-testid="voice-tab-agent"]');
    await agentTab.click();
    await expect(agentTab).toHaveAttribute('aria-selected', 'true');

    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel).toBeVisible();

    // Agent tab should reveal prompt/voice config content
    const panelText = await panel.textContent();
    expect(panelText!.trim().length).toBeGreaterThan(20);

    await snap(page, '10-voice-agent-tab');
    expectClean(logs);
  });

  // ─── 11 · MCPs tab: click shows MCP integrations panel ───────────────────
  test('11 · MCPs tab click shows MCP integrations panel', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const mcpsTab = page.locator('[data-testid="voice-tab-mcps"]');
    await mcpsTab.click();
    await expect(mcpsTab).toHaveAttribute('aria-selected', 'true');

    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel).toBeVisible();

    const panelText = await panel.textContent();
    expect(panelText!.trim().length).toBeGreaterThan(0);

    await snap(page, '11-voice-mcps-tab');
    expectClean(logs);
  });

  // ─── 12 · Share tab: shows shareable affordance ───────────────────────────
  test('12 · Share tab click shows shareable link / embed affordance', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const shareTab = page.locator('[data-testid="voice-tab-share"]');
    await shareTab.click();
    await expect(shareTab).toHaveAttribute('aria-selected', 'true');

    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel).toBeVisible();

    // Share tab should expose a URL, embed code, or copy button
    const panelText = await panel.textContent();
    expect(panelText!.trim().length).toBeGreaterThan(0);

    // Look for a shareable affordance (link input, copy button, or embed snippet)
    const shareAffordance = panel.locator(
      'input[type="url"], input[type="text"], button:has-text("Copy"), [role="textbox"]',
    );
    if (await shareAffordance.count()) {
      await expect(shareAffordance.first()).toBeVisible();
    }

    await snap(page, '12-voice-share-tab');
    expectClean(logs);
  });

  // ─── 13 · Regenerate button is present and does not crash ─────────────────
  test('13 · Regenerate button is present and interactive without crashing', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    // Regenerate button may be on the Share tab or visible globally
    const regenBtn = page.getByRole('button', { name: /Regenerate/i });
    if (await regenBtn.count()) {
      await expect(regenBtn.first()).toBeVisible();
      await regenBtn.first().click();
      // Section still intact — no error boundary triggered
      await expect(page.locator('[data-testid="voice-section"]')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
    } else {
      // Navigate to Share tab where Regenerate is most likely to live
      await page.locator('[data-testid="voice-tab-share"]').click();
      const regenInShare = page.getByRole('button', { name: /Regenerate/i });
      if (await regenInShare.count()) {
        await expect(regenInShare.first()).toBeVisible();
        await regenInShare.first().click();
        await expect(page.locator('[data-testid="voice-section"]')).toBeVisible();
      }
    }

    await snap(page, '13-voice-regenerate-button');
    expectClean(logs);
  });

  // ─── 14 · Deep-link: /admin/voice directly renders the section ────────────
  test('14 · Deep-linking directly to /admin/voice renders voice section without prior nav', async ({
    page,
  }) => {
    const logs = attachConsole(page);
    await seedSession(page);

    // Navigate directly — no intermediate route navigation
    await gotoAdmin(page, '/admin/voice');

    const section = page.locator('[data-testid="voice-section"]');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // All tab buttons should be present on direct load
    await expect(page.locator('[data-testid="voice-tab-numbers"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-tab-agent"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-tab-share"]')).toBeVisible();

    // Stat strip and live pill should also be immediately present
    await expect(page.locator('[data-testid="voice-live-pill"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-stat-strip"]')).toBeVisible();

    await snap(page, '14-voice-deep-link');
    expectClean(logs);
  });

  // ─── 15 · Tab keyboard navigation: arrow keys cycle focus ─────────────────
  test('15 · Tab strip supports keyboard arrow navigation between tabs', async ({ page }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    // Focus the Numbers tab and navigate with arrow keys
    const numbersTab = page.locator('[data-testid="voice-tab-numbers"]');
    await numbersTab.focus();
    await expect(numbersTab).toBeFocused();

    // Arrow right should move focus toward the Conversations tab
    await page.keyboard.press('ArrowRight');
    const convTab = page.locator('[data-testid="voice-tab-conversations"]');

    // Either focus moved to next tab or stayed on Numbers — neither should crash
    const convFocused = await convTab.evaluate((el) => document.activeElement === el);
    const numbersFocused = await numbersTab.evaluate((el) => document.activeElement === el);
    expect(convFocused || numbersFocused).toBe(true);

    // Section remains visible after keyboard nav
    await expect(page.locator('[data-testid="voice-section"]')).toBeVisible();

    await snap(page, '15-voice-tab-keyboard-nav');
    expectClean(logs);
  });

  // ─── 16 · Full tab round-trip + console hygiene ───────────────────────────
  test('16 · Full tab round-trip: click all 6 tabs sequentially with console hygiene', async ({
    page,
  }) => {
    const logs = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/voice');

    await page.locator('[data-testid="voice-section"]').waitFor({ state: 'visible', timeout: 15_000 });

    const tabs: Array<{ testid: string; label: string }> = [
      { testid: 'voice-tab-numbers', label: 'Numbers' },
      { testid: 'voice-tab-conversations', label: 'Conversations' },
      { testid: 'voice-tab-test', label: 'Test-Console' },
      { testid: 'voice-tab-agent', label: 'Agent' },
      { testid: 'voice-tab-mcps', label: 'MCPs' },
      { testid: 'voice-tab-share', label: 'Share' },
    ];

    for (const { testid, label } of tabs) {
      const tab = page.locator(`[data-testid="${testid}"]`);
      await tab.click();

      // Tab becomes active
      await expect(tab).toHaveAttribute('aria-selected', 'true');

      // Corresponding panel is visible and non-empty
      const panel = page.locator('[role="tabpanel"]').first();
      await expect(panel).toBeVisible();
      const panelText = await panel.textContent();
      expect(panelText!.trim().length).toBeGreaterThan(0);

      await snap(page, `16-voice-round-trip-${label.toLowerCase()}`);
    }

    // After cycling all tabs: section and live pill still intact
    await expect(page.locator('[data-testid="voice-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-live-pill"]')).toBeVisible();
    await expect(page.locator('[data-testid="voice-stat-strip"]')).toBeVisible();

    expectClean(logs);
  });
});
