/**
 * multi-day-quote.spec.ts — TDD RED phase
 *
 * Verifies:
 * - Multi-day quote with per-day overrides renders per-day tab cards
 * - "Start and end time" label appears bottom-right, small text, on each day card
 * - Single-day mode hides per-day tabs
 */

import { test, expect } from '../_fixtures/auth.js';

test.describe('multi-day quote', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/');
    const quotesLink = authedPage
      .getByRole('link', { name: /quotes/i })
      .or(authedPage.getByTestId('nav-quotes'));
    await quotesLink.click();
    const newQuoteBtn = authedPage
      .getByRole('button', { name: /new quote|create quote/i })
      .or(authedPage.getByTestId('quote-new-btn'));
    await expect(newQuoteBtn).toBeVisible({ timeout: 8_000 });
    await newQuoteBtn.click();
    await expect(authedPage).toHaveURL(/\/quotes\/new|\/quotes\/[^/]+\/edit/);
  });

  test('multi-day mode shows per-day tab cards with start/end time label', async ({ authedPage }) => {
    // Enable multi-day mode
    const multiDayToggle = authedPage
      .getByRole('checkbox', { name: /multi.?day/i })
      .or(authedPage.getByTestId('quote-multiday-toggle'));
    await expect(multiDayToggle).toBeVisible({ timeout: 5_000 });
    await multiDayToggle.check();

    // Should now show at least 2 day tabs
    const dayTabs = authedPage.getByTestId('quote-day-tab');
    await expect(dayTabs).toHaveCount(2, { timeout: 5_000 });

    // Each tab card should show a "Start and end time" label
    for (let i = 0; i < 2; i++) {
      const tabCard = dayTabs.nth(i);
      await expect(tabCard).toBeVisible();

      const timeLabel = tabCard.getByText(/start and end time/i);
      await expect(timeLabel).toBeVisible();

      // Assert the label is rendered at a small font size (≤ 13px)
      const fontSize = await timeLabel.evaluate(
        (el) => parseFloat(window.getComputedStyle(el).fontSize),
      );
      expect(fontSize).toBeLessThanOrEqual(13);

      // Assert the label is in the bottom-right quadrant of its container
      const cardBox = await tabCard.boundingBox();
      const labelBox = await timeLabel.boundingBox();
      if (cardBox && labelBox) {
        const cardMidX = cardBox.x + cardBox.width / 2;
        const cardMidY = cardBox.y + cardBox.height / 2;
        expect(labelBox.x).toBeGreaterThan(cardMidX - 20); // right half
        expect(labelBox.y).toBeGreaterThan(cardMidY - 20); // bottom half
      }
    }
  });

  test('single-day mode hides per-day tabs', async ({ authedPage }) => {
    // Ensure we are in single-day mode (default)
    const multiDayToggle = authedPage
      .getByRole('checkbox', { name: /multi.?day/i })
      .or(authedPage.getByTestId('quote-multiday-toggle'));
    await expect(multiDayToggle).toBeVisible({ timeout: 5_000 });

    if (await multiDayToggle.isChecked()) {
      await multiDayToggle.uncheck();
    }

    // Per-day tabs must be hidden
    const dayTabs = authedPage.getByTestId('quote-day-tab');
    await expect(dayTabs).toHaveCount(0);
  });

  test('per-day overrides update independently', async ({ authedPage }) => {
    const multiDayToggle = authedPage
      .getByRole('checkbox', { name: /multi.?day/i })
      .or(authedPage.getByTestId('quote-multiday-toggle'));
    await expect(multiDayToggle).toBeVisible({ timeout: 5_000 });
    await multiDayToggle.check();

    const dayTabs = authedPage.getByTestId('quote-day-tab');
    await expect(dayTabs).toHaveCount(2, { timeout: 5_000 });

    // Click day 1 tab and change its start time
    await dayTabs.nth(0).click();
    const day1StartInput = authedPage
      .getByTestId('quote-day-1-start-time')
      .or(authedPage.getByLabel(/day 1.*start/i));
    await expect(day1StartInput).toBeVisible();
    await day1StartInput.fill('09:00');

    // Switch to day 2 — day 1 value should not change
    await dayTabs.nth(1).click();
    const day2StartInput = authedPage
      .getByTestId('quote-day-2-start-time')
      .or(authedPage.getByLabel(/day 2.*start/i));
    await expect(day2StartInput).toBeVisible();

    // Go back to day 1 and verify unchanged
    await dayTabs.nth(0).click();
    await expect(day1StartInput).toHaveValue('09:00');
  });
});
