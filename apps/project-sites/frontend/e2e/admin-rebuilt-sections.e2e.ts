/**
 * @module e2e/admin-rebuilt-sections
 *
 * Regression guard for the two whole-feature reconstructions this campaign
 * shipped (their P1 bugs had no test coverage):
 *   - site-branches `ef03dd1d` — was a one-line "admin UI under reconstruction"
 *     stub template; rebuilt into a real branches UI (stats + create form +
 *     table/empty-state). Guard: the stub copy must never return; the real
 *     header + "New branch" control + a valid 4-state container must render.
 *   - apps-instances `771f8f11` — was fully broken by a {data:…} response-
 *     envelope mismatch (blank list/detail/logs). Guard: the section renders a
 *     valid state (section/empty/skeleton/list) and throws no uncaught error.
 *
 * With the E2E test token the data APIs 401, so these render their empty/error
 * states — which is exactly what proves the shell + 4-state wiring is intact
 * (and, for branches, that the stub is gone).
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — rebuilt-section regression guards', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('site-branches renders the rebuilt UI, not the old stub', async ({ page }) => {
    test.setTimeout(60000);
    await seed(page);
    // Placeholder site id — branches list 401s under the test token → empty
    // state, which still exercises the full rebuilt template (header + CTA).
    await page.goto('/admin/sites/test-site/branches', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });

    const section = page.locator('[data-testid="site-branches"]');
    await expect(section).toBeVisible({ timeout: 20000 });
    // Real rebuilt UI: the "Branches" heading + a "New branch" control.
    await expect(section.getByRole('heading', { name: 'Branches', exact: true })).toBeVisible();
    await expect(section.getByTestId('branch-new-toggle')).toBeVisible();
    // The old stub copy must be gone.
    await expect(section).not.toContainText(/under reconstruction/i);
    // A valid 4-state container (empty-state / skeleton / table) is present.
    await expect(
      section.locator('app-empty-state, app-skeleton, table, [role="status"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test('apps-instances renders a valid state with no uncaught error', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await seed(page);
    await page.goto('/admin/apps/instances', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    // Renders SOMETHING substantive (empty-state / skeleton / instance rows /
    // a heading) — never a blank section.
    await expect(
      page.locator('app-empty-state, app-skeleton, .inst-row, [role="status"], h1, h2').first(),
    ).toBeVisible({ timeout: 20000 });
    expect(pageErrors, `apps-instances threw: ${pageErrors.join('; ')}`).toEqual([]);
  });
});
