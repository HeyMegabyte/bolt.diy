/**
 * CHAOS 6 — "The Comparison Shopper + Spanish Speaker": conversion CTAs + i18n.
 *
 * Homepage-first. Covers human interactions the other chaos journeys skip:
 *  - the pricing-page plan CTAs actually route into the create funnel (/search),
 *  - the header language toggle (ES) actually TRANSLATES the page (not a dead
 *    control / partial i18n) without layout overflow or console errors.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) npx playwright test \
 *   --config=playwright.prod.config.ts chaos-6-conversion-i18n
 */
import { test, expect } from '@playwright/test';
import { trackErrors, assertAlive } from './chaos-helpers';

test.describe('CHAOS 6 — Conversion + i18n (uncovered UI interactions)', () => {
  test('pricing plan CTAs route into the create funnel (/search), shell alive, no console error', async ({
    page,
  }) => {
    const e = trackErrors(page);
    // Land directly on /pricing — homepage-nav reachability is already covered by
    // chaos-1's "every homepage nav control responds" (M1). This journey's novel
    // assertion is the PLAN CTA → create-funnel routing.
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByTestId('pricing-cta-monthly').click();
    await expect(page).toHaveURL(/\/search/);
    await assertAlive(page);

    await page.goBack();
    await expect(page).toHaveURL(/\/pricing/);
    await page.getByTestId('pricing-cta-annual').click();
    await expect(page).toHaveURL(/\/search/);
    await assertAlive(page);

    expect(e.consoleErrors, e.consoleErrors.join('\n')).toEqual([]);
    expect(e.pageErrors, e.pageErrors.join('\n')).toEqual([]);
    expect(e.serverErrors, e.serverErrors.join('\n')).toEqual([]);
  });

  test('header ES toggle translates the hero (real i18n) with no overflow / console error', async ({
    page,
  }) => {
    const e = trackErrors(page);
    await page.goto('/');
    const h1 = page.getByRole('heading', { level: 1 }).first();
    await expect(h1).toBeVisible();
    const enText = (await h1.innerText()).trim();

    // Click the language toggle labelled "ES" (button or link in the header).
    const es = page.getByRole('button', { name: /^ES$/ }).or(page.getByRole('link', { name: /^ES$/ }));
    await es.first().click();

    // Condition-based wait (NO arbitrary sleep): the hero H1 MUST change to Spanish.
    // An unchanged H1 means the toggle is dead or the hero string is untranslated
    // (partial-i18n defect). Polling keeps it deterministic under parallel load.
    await expect
      .poll(async () => (await h1.innerText()).trim(), {
        timeout: 8000,
        message: `hero H1 never translated on ES (stuck on "${enText}")`,
      })
      .not.toBe(enText);
    await assertAlive(page);

    // Longer Spanish copy must not introduce horizontal overflow at desktop width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow ${overflow}px after switching to ES`).toBeLessThanOrEqual(2);

    expect(e.consoleErrors, e.consoleErrors.join('\n')).toEqual([]);
    expect(e.pageErrors, e.pageErrors.join('\n')).toEqual([]);
  });
});
