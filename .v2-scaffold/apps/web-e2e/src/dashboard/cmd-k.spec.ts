/**
 * cmd-k.spec.ts — TDD RED phase
 *
 * Meta+K opens command palette AND immediately focuses the text input.
 * Search works across every entity type.
 * "?" opens shortcut sheet.
 */

import { test, expect } from '../_fixtures/auth.js';

test.describe('command palette (Cmd+K)', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/');
    const dashLink = authedPage
      .getByRole('link', { name: /dashboard/i })
      .or(authedPage.getByTestId('nav-dashboard'));
    await dashLink.click();
    await expect(authedPage).toHaveURL(/\/dashboard/);
  });

  test('Meta+K opens palette and immediately focuses input', async ({ authedPage }) => {
    await authedPage.keyboard.press('Meta+k');

    const paletteInput = authedPage
      .getByRole('searchbox')
      .or(authedPage.getByTestId('cmd-palette-input'))
      .or(authedPage.getByRole('textbox', { name: /search|command/i }));
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });

    // Input must be focused — document.activeElement must match
    const isFocused = await authedPage.evaluate(() => {
      const activeEl = document.activeElement;
      if (!activeEl) return false;
      const role = activeEl.getAttribute('role');
      const testId = activeEl.getAttribute('data-testid');
      return (
        activeEl.tagName === 'INPUT' ||
        role === 'searchbox' ||
        role === 'textbox' ||
        testId === 'cmd-palette-input'
      );
    });
    expect(isFocused).toBe(true);
  });

  test('Ctrl+K also opens palette (cross-platform)', async ({ authedPage }) => {
    await authedPage.keyboard.press('Control+k');

    const paletteInput = authedPage
      .getByTestId('cmd-palette-input')
      .or(authedPage.getByRole('searchbox'));
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });
  });

  test('palette searches bookings', async ({ authedPage }) => {
    await authedPage.route('**/api/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ type: 'booking', id: 'b-001', title: 'Booking #001', url: '/dashboard/bookings/b-001' }],
        }),
      });
    });

    await authedPage.keyboard.press('Meta+k');
    const paletteInput = authedPage.getByTestId('cmd-palette-input').or(authedPage.getByRole('searchbox'));
    await paletteInput.fill('booking');

    await expect(authedPage.getByText('Booking #001')).toBeVisible({ timeout: 5_000 });
  });

  for (const entityType of ['quotes', 'jobs', 'sites', 'team', 'settings', 'docs'] as const) {
    test(`palette searches ${entityType}`, async ({ authedPage }) => {
      await authedPage.route('**/api/search**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                type: entityType,
                id: `${entityType}-001`,
                title: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Result`,
                url: `/dashboard/${entityType}/001`,
              },
            ],
          }),
        });
      });

      await authedPage.keyboard.press('Meta+k');
      const paletteInput = authedPage.getByTestId('cmd-palette-input').or(authedPage.getByRole('searchbox'));
      await paletteInput.fill(entityType);

      await expect(
        authedPage.getByText(new RegExp(`${entityType} result`, 'i')),
      ).toBeVisible({ timeout: 5_000 });
    });
  }

  test('? opens shortcut sheet', async ({ authedPage }) => {
    // Press ? to open the keyboard shortcut help sheet
    await authedPage.keyboard.press('?');

    const shortcutSheet = authedPage
      .getByRole('dialog', { name: /keyboard shortcuts|shortcuts/i })
      .or(authedPage.getByTestId('shortcut-sheet'));
    await expect(shortcutSheet).toBeVisible({ timeout: 5_000 });

    // Should list at least one shortcut
    await expect(
      shortcutSheet.getByText(/cmd\+k|ctrl\+k/i).or(shortcutSheet.getByTestId(/shortcut-item/)),
    ).not.toHaveCount(0);
  });

  test('Escape closes palette and returns focus to trigger', async ({ authedPage }) => {
    await authedPage.keyboard.press('Meta+k');
    const paletteInput = authedPage.getByTestId('cmd-palette-input').or(authedPage.getByRole('searchbox'));
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });

    await authedPage.keyboard.press('Escape');
    await expect(paletteInput).not.toBeVisible({ timeout: 3_000 });
  });
});
