/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: when a site has no AI endpoints,
 * `/admin/ai-endpoints` renders the honest "Build your first AI agent" first-action empty state —
 * not a crash, not a blank. Complements `ai-endpoints-error-state.spec.ts` (500 → error card):
 * together they cover the registry in every data state.
 *
 * Injection: 200 `{data:[]}` for `/api/sites/:id/ai-endpoints` (the FE reads `r.data ?? []`).
 * `ai-endpoints.component.ts`: `@if (endpoints().length === 0)` → `<app-empty-state title="Build
 * your first AI agent">` (no section testid → matched by title). Site-scoped (selected site),
 * auto-load on `ngOnInit`, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./ai-endpoints-error-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

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

test.describe('Admin · AI Endpoints empty-state honesty (P0-ADMIN)', () => {
  test('an empty registry renders the honest "Build your first AI agent" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/ai-endpoints**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );
    await page.goto('/admin/ai-endpoints', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText(/build your first ai agent/i),
      'the honest first-action empty state renders on an empty registry',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty registry must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/ai-endpoints-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
