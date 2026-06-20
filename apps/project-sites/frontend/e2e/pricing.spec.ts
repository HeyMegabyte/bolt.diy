import { test, expect } from '@playwright/test';

/**
 * Public /pricing page — asserts the $50/month + $500/year offers render and the
 * claim CTAs point into the funnel. Deterministic, no external calls.
 */
test.describe('pricing page', () => {
  test('renders the $50/mo and $500/yr offers', async ({ page }) => {
    await page.goto('/pricing');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Rolling counters animate from 0 → final; assert the final values land.
    await expect(page.getByText('$50', { exact: false })).toBeVisible();
    await expect(page.getByText('$500', { exact: false })).toBeVisible();
    await expect(page.getByText('/month', { exact: false })).toBeVisible();
    await expect(page.getByText('/year', { exact: false })).toBeVisible();
  });

  test('both CTAs route into the claim funnel', async ({ page }) => {
    await page.goto('/pricing');

    for (const id of ['pricing-cta-monthly', 'pricing-cta-annual']) {
      const cta = page.getByTestId(id);
      await expect(cta).toBeVisible();
      await expect(cta).toHaveAttribute('href', /\/search/);
    }
  });
});
