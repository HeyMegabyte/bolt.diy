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
