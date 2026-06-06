import { test, expect, type Page } from '@playwright/test';

/**
 * Windows High Contrast Mode (`forced-colors: active`) guard.
 *
 * Dark cyan-on-black UIs are a classic forced-colors failure mode — author
 * colours are replaced by the user's system palette, and elements that relied
 * on a coloured background (badges, status pills, cards) can VANISH or lose
 * their meaning. WCAG 1.4.1 (use of colour) + the cockpit's heavy accent use
 * make this a real risk. The desktop/mobile axe passes do NOT emulate
 * forced-colors, so this dimension was previously uncovered.
 *
 * Contract: in forced-colors, the admin shell + section content + the error
 * card (a colour-dependent surface) stay VISIBLE, and interactive controls keep
 * a border (HCM strips background fills — a borderless button becomes invisible).
 *
 * Verified manually 2026-06-06 (analytics error state + feature-flags list both
 * render legibly in HCM — error conveyed via border+icon+text, not colour-only);
 * this locks that in.
 */

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — forced-colors (Windows High Contrast) legibility', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('admin shell + nav stay visible in forced-colors', async ({ page }) => {
    test.setTimeout(45000);
    await seed(page);
    // emulateMedia (NOT test.use) — the proven pattern here; test.use media
    // options don't reliably apply in this prod config (admin-reduced-motion r-).
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });
    // The shell chrome must not vanish when author colours are stripped.
    await expect(page.locator('.admin-sidebar, nav').first()).toBeVisible({ timeout: 30000 });
    // A representative nav link is reachable + visible.
    await expect(page.locator('a.nav-item').first()).toBeVisible();
  });

  test('the analytics error card conveys its state without relying on colour', async ({ page }) => {
    test.setTimeout(45000);
    await seed(page);
    await page.emulateMedia({ forcedColors: 'active' });
    // Analytics 404s for the test site → the error card is the default state.
    await page.goto('/admin/analytics', { waitUntil: 'load' });
    const card = page.locator('app-error-card, [data-testid="audit-error"], [data-testid*="error"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });
    // The Retry button must stay visible AND keep a border (HCM strips bg fills,
    // so a border is what keeps an interactive control from disappearing).
    const retry = page.getByRole('button', { name: /retry/i }).first();
    await expect(retry).toBeVisible();
    const borderW = await retry.evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth) || 0);
    expect(borderW, 'Retry button keeps a border in forced-colors (else it vanishes)').toBeGreaterThan(0);
  });
});
