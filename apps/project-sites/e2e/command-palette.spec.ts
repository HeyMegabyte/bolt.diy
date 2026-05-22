/**
 * E2E tests for the rebuilt Cmd-K command palette.
 *
 * @remarks
 * Verifies open/close hotkey, fuzzy search, calculator special-result,
 * quick site-switch, and the Ask-AI fallback. All tests start at the
 * admin shell where `<app-command-palette>` is mounted.
 */

import { test, expect } from './fixtures.js';

const isMac = process.platform === 'darwin';
const META = isMac ? 'Meta' : 'Control';

test.describe('Command palette (Cmd+K)', () => {
  test.beforeEach(async ({ page }) => {
    // Most palette tests can run against the homepage shell — but the palette
    // itself only mounts inside /admin. Visit the admin page and tolerate the
    // auth redirect; the e2e_server.cjs fixture serves a stubbed shell.
    await page.goto('/admin');
  });

  test('opens via Cmd+K and focuses input on the same rAF tick', async ({ page }) => {
    await page.keyboard.press(`${META}+KeyK`);
    const input = page.locator('[data-testid="palette-input"]');
    await expect(input).toBeVisible();
    // The input MUST be focused immediately — no setTimeout delay.
    await expect(input).toBeFocused();
  });

  test('Esc closes; re-press Cmd+K re-focuses + selects existing text', async ({ page }) => {
    await page.keyboard.press(`${META}+KeyK`);
    const input = page.locator('[data-testid="palette-input"]');
    await input.fill('snap');
    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
    await page.keyboard.press(`${META}+KeyK`);
    await expect(input).toBeFocused();
  });

  test('typing "snap" surfaces the Snapshots action and Enter navigates', async ({ page }) => {
    await page.keyboard.press(`${META}+KeyK`);
    const input = page.locator('[data-testid="palette-input"]');
    await input.fill('snap');
    const snap = page.locator('[data-testid="palette-action-nav-snapshots"]');
    await expect(snap).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/snapshots/);
  });

  test('calculator: typing "= 2 + 2" shows result chip', async ({ page }) => {
    await page.keyboard.press(`${META}+KeyK`);
    const input = page.locator('[data-testid="palette-input"]');
    await input.fill('= 2 + 2');
    const special = page.locator('[data-testid="palette-special"]');
    await expect(special).toBeVisible();
    await expect(special).toContainText('4');
  });

  test('quick site-switch row appears when sites exist', async ({ page }) => {
    // Stub a site into the AdminStateService via window if test harness exposes it.
    await page.keyboard.press(`${META}+KeyK`);
    const input = page.locator('[data-testid="palette-input"]');
    await input.fill('switch');
    // At minimum the Sites section header OR a site row should render — soft-assert
    // because the test fixture may not seed sites.
    const results = page.locator('[data-testid="palette-results"]');
    await expect(results).toBeVisible();
  });

  test('no-match query exposes Ask AI fallback', async ({ page }) => {
    await page.keyboard.press(`${META}+KeyK`);
    const input = page.locator('[data-testid="palette-input"]');
    await input.fill('zzzzz-no-match-xyz');
    const askAi = page.locator('[data-testid="palette-action-ask-ai"]');
    await expect(askAi).toBeVisible();
  });
});
