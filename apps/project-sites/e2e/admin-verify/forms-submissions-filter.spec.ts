/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Forms submissions FILTER views (the
 * saved-view chips: All / Today / Newsletter / Contact / With email / Errors) switch
 * the inbox and reconcile their counts. `forms-interactions.spec.ts` covers the prompt
 * designer + test panel; the submissions filter surface was uncovered.
 *
 * The Submissions section + its filter-chips + Export CSV render unconditionally
 * (forms.component.ts:442), regardless of submission count. Filtering is client-side
 * view switching (`setView`) — no mutation. Org-agnostic: each chip carries a numeric
 * count, activates on click, and the "X / Y" summary stays coherent (filtered ≤ total).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./forms-interactions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Real console errors + pageerrors, ignoring benign fixture/harness noise. */
function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

const chips = (page: Page) => page.locator('.filter-chips .filter-chip');
const exportBtn = (page: Page) => page.locator('[data-testid="forms-export-csv"]');

const gotoForms = async (page: Page): Promise<void> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/forms', { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: /submissions/i })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
};

test.describe('Admin · Forms submissions filter (P0-ADMIN)', () => {
  test('the Submissions section + saved-view filter chips + Export render (0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    await gotoForms(page);
    await expect.poll(() => chips(page).count(), { timeout: 10000 }).toBeGreaterThan(1);
    await expect(exportBtn(page), 'the Export CSV affordance renders').toBeVisible();
    // Each chip carries a numeric count badge (0 is valid for an empty org).
    const firstCount = (await page.locator('.filter-chips .filter-chip .filter-count').first().innerText()).trim();
    expect(firstCount, 'a filter chip shows a numeric count').toMatch(/^\d+$/);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/forms-filter-chips.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('clicking each saved view activates it and keeps the filtered ≤ total summary coherent', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoForms(page);
    const all = chips(page);
    await expect.poll(() => all.count(), { timeout: 10000 }).toBeGreaterThan(1);
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const chip = all.nth(i);
      await chip.click();
      await page.waitForTimeout(150); // let the `activeView` signal settle
      await expect(chip, `chip ${i} becomes the active view on click`).toHaveClass(/active/);
    }
    // The "X / Y" summary — the filtered count never exceeds the total.
    const summary = (await page.getByText(/^\d+\s*\/\s*\d+$/).first().innerText()).trim();
    const [f, t] = summary.split('/').map((s) => parseInt(s.trim(), 10));
    expect(Number.isFinite(f) && Number.isFinite(t), `parsed the "${summary}" summary`).toBe(true);
    expect(f, `filtered (${f}) ≤ total (${t})`).toBeLessThanOrEqual(t);
  });
});
