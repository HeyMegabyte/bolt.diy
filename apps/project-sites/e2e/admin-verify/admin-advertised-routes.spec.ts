/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — REGRESSION for the P0.79 fix: FOUR more
 * advertised `/admin/*` routes that all rendered the admin not-found page (404),
 * caught by auditing every nav-href / routerLink / command-palette / onboarding
 * target against the defined routes (the same class as P0.78's mcp/ai-chat).
 *
 * Two were standalone sections whose routes were LOST → restored as loadComponent
 * routes; two were folded into tabs → functional redirects:
 *   - /admin/audit         → RESTORED (AdminAuditComponent — real Audit Log, 500 events)
 *   - /admin/ai-endpoints  → RESTORED (AdminAiEndpointsComponent — AI API endpoints)
 *   - /admin/ai-logs       → REDIRECT /admin/logs?tab=traces (RENAMED_ROUTES: ai-logs→traces)
 *   - /admin/webhooks      → REDIRECT /admin/settings#webhooks (Settings Webhooks tab)
 *
 * `sections-visual` never caught these — its generic BROKEN-copy list excludes the
 * not-found phrase (gotcha #6). Fixed + verified LIVE as brian (audit renders 500
 * real events). Real session (E2E_API_KEY).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./settings-tab-redirects.spec.ts} — the P0.78 sibling (mcp/ai-chat).
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const NOT_FOUND = /this admin page doesn't exist|page does not exist/i;

const notNotFound = async (page: import('@playwright/test').Page, label: string) => {
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(NOT_FOUND.test(body), `${label} must not render the admin not-found page`).toBe(false);
};

test.describe('Admin · advertised routes all resolve, none 404 (P0-ADMIN)', () => {
  test('/admin/audit renders the restored Audit Log section (real events)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' });

    expect(new URL(page.url()).pathname).toBe('/admin/audit');
    await expect(page.getByText(/audit log/i).first(), 'the Audit Log section must render').toBeVisible({
      timeout: 12000,
    });
    await notNotFound(page, '/admin/audit');
  });

  test('/admin/ai-endpoints renders the restored AI Endpoints section', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/ai-endpoints', { waitUntil: 'domcontentloaded' });

    expect(new URL(page.url()).pathname).toBe('/admin/ai-endpoints');
    // Substantial content rendered (not the ~570-char not-found page).
    await page
      .waitForFunction(() => (document.querySelector('main')?.innerText ?? document.body.innerText).trim().length > 400, {
        timeout: 12000,
      })
      .catch(() => {});
    await notNotFound(page, '/admin/ai-endpoints');
  });

  test('/admin/ai-logs redirects to the Logs dashboard (renamed → traces)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/ai-logs', { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => location.pathname === '/admin/logs', undefined, { timeout: 10000 }).catch(() => {});
    expect(new URL(page.url()).pathname, '/admin/ai-logs must resolve to the Logs dashboard').toBe('/admin/logs');
    await notNotFound(page, '/admin/ai-logs');
  });

  test('/admin/webhooks redirects to the Settings Webhooks tab', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/webhooks', { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => location.pathname === '/admin/settings', undefined, { timeout: 10000 }).catch(() => {});
    expect(new URL(page.url()).pathname, '/admin/webhooks must resolve to Settings').toBe('/admin/settings');
    await notNotFound(page, '/admin/webhooks');
  });
});
