/**
 * @module e2e/homepage-disclosure-a11y
 *
 * Disclosure-widget state regression (WCAG 4.1.2 Name/Role/Value). axe-core
 * CANNOT detect a missing `aria-expanded` on a <button> (it's valid HTML), so
 * the marketing-a11y axe sweep passed while the FAQ accordion + mobile hamburger
 * exposed NO expanded/collapsed state to screen readers. Fixed 2026-08-16 by
 * binding `[attr.aria-expanded]` to the toggle signals. This is the manual-review
 * a11y check axe leaves to us.
 *
 * Run: npx playwright test --config=playwright.prod.config.ts homepage-disclosure-a11y
 */
import { test, expect } from '@playwright/test';

const BASE = 'https://projectsites.dev';

test.describe('homepage — disclosure widgets expose aria-expanded (WCAG 4.1.2)', () => {
  test.describe.configure({ retries: 2 });

  test('FAQ accordion trigger reflects collapsed↔expanded via aria-expanded', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#faq button', { state: 'attached', timeout: 15000 });
    const trigger = page.locator('#faq button').first();
    await trigger.scrollIntoViewIfNeeded();
    // Collapsed by default.
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Expands on click.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Single-open accordion — a second click collapses it again.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('mobile hamburger reflects closed↔open via aria-expanded', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav[aria-label="Primary"]', { state: 'attached', timeout: 15000 });
    const burger = page.locator('button[aria-label="Toggle menu"]');
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('search page — FAQ accordion exposes aria-expanded (WCAG 4.1.2)', () => {
  test.describe.configure({ retries: 2 });

  test('/search FAQ trigger reflects collapsed↔expanded via aria-expanded', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE + '/search', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.faq-item button', { state: 'attached', timeout: 15000 });
    const trigger = page.locator('.faq-item button').first();
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('homepage — search input shows a visible focus indicator (WCAG 2.4.7)', () => {
  test.describe.configure({ retries: 2 });

  test('hero search wrapper gains a focus ring when the input is focused', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('nav[aria-label="Primary"]', { state: 'attached', timeout: 15000 });
    const input = page.locator('input[placeholder*="Search for your business" i]').first();
    await expect(input).toBeVisible();
    // The input is `outline-none` (the global cyan outline was suppressed on
    // these icon-wrapped inputs to avoid stray stripes). It must instead carry a
    // `focus:` box-shadow ring so keyboard users can see the primary funnel input
    // is focused — the axe-blind WCAG 2.4.7 gap. No ring when blurred; a ring on focus.
    const wrapperShadow = (el) => getComputedStyle(el.parentElement).boxShadow;
    const before = await input.evaluate(wrapperShadow);
    expect(before, 'no focus ring on the search wrapper when blurred').toBe('none');
    await input.focus(); // :focus-within triggers on the wrapper (programmatic focus counts)
    await page.waitForTimeout(150);
    const after = await input.evaluate(wrapperShadow);
    expect(after, 'search wrapper must render a focus ring (box-shadow) when the input is focused').not.toBe('none');
  });
});
