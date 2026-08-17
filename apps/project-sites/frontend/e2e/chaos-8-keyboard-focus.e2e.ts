/**
 * CHAOS 8 — "The Keyboard-Only User": focus visibility (WCAG 2.4.7).
 *
 * The homepage hero search input is `border-none outline-none` and its focus ring
 * is deliberately suppressed by `input.outline-none:focus-visible` in styles.scss
 * (the global outline rendered as thin stripes on the full-width borderless input),
 * with no replacement — so a keyboard user saw NO focus indicator. The ring is
 * restored on the WRAPPER (`.hero-search-shell`, :focus-within) in styles.scss.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-8-keyboard-focus
 */
import { test, expect } from '@playwright/test';

test.describe('CHAOS 8 — Keyboard focus visibility (WCAG 2.4.7)', () => {
  test('homepage hero search shows a visible focus ring when keyboard-focused', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Target the hero search WRAPPER directly (the visible one). Its inner input
    // opts out of the ring; the visible indicator lives here via :focus-within.
    const shell = page.locator('.hero-search-shell:visible').first();
    await expect(shell).toBeVisible({ timeout: 15000 });

    // Focus the wrapper's input + measure the wrapper's ring in ONE evaluate so
    // focus can't be lost between calls.
    const ind = await shell.evaluate((wrap: HTMLElement) => {
      const inp = wrap.querySelector('input') as HTMLElement | null;
      inp?.focus();
      const cs = getComputedStyle(wrap);
      const hasRing =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow !== 'none' && cs.boxShadow.trim() !== '');
      return {
        inputActive: document.activeElement === inp,
        matchesFocusWithin: wrap.matches(':focus-within'),
        hasRing,
        outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
        boxShadow: cs.boxShadow.slice(0, 40),
      };
    });
    expect(
      ind.hasRing,
      `no visible keyboard focus indicator on the hero search wrapper (${JSON.stringify(ind)})`,
    ).toBe(true);
  });

  // Sibling instances of the same class: the /create funnel + /contact form inputs
  // are `outline-none` and were suppressed by the same global rule — they showed NO
  // keyboard focus ring (confirmed live: every text input ring:false). A box-shadow
  // ring is restored globally for all outline-none inputs.
  for (const url of ['/create', '/contact']) {
    test(`form inputs on ${url} show a keyboard focus ring (WCAG 2.4.7)`, async ({ page }) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      // First visible text control that is NOT the icon-flanked hero search.
      const input = page
        .locator('input:visible, textarea:visible')
        .filter({ hasNot: page.locator('.hero-search-shell *') })
        .first();
      await expect(input).toBeVisible({ timeout: 15000 });
      const hasRing = await input.evaluate((el: HTMLElement) => {
        el.focus();
        const cs = getComputedStyle(el);
        return (
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
          (cs.boxShadow !== 'none' && cs.boxShadow.trim() !== '')
        );
      });
      expect(hasRing, `no keyboard focus ring on the first form input of ${url}`).toBe(true);
    });
  }
});
