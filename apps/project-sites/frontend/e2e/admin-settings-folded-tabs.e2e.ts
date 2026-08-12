import { test, expect, type Page } from '@playwright/test';

/**
 * Prod lock for the Domains + API Tokens → Settings fold (2026-08-12).
 *
 * Both standalone sections became Settings TABS (#domains / #api-tokens),
 * reusing AdminDomainsComponent + AdminApiTokensComponent verbatim (same fold
 * pattern as mcp/ai-chat/webhooks). The legacy /admin/domains and
 * /admin/api-tokens routes now client-redirect into Settings, and both were
 * removed from the left-nav "More tools" menu.
 *
 * Seeds `ps_session` from E2E_API_KEY as `test@megabyte.space` — an auth-level
 * (non-operator) identity. Settings + these two tabs are guard:'auth', so no
 * operator gate applies. The API Tokens tab self-gates on public_api_v1: the
 * TAB + PANEL always render (the component mounts); its token table may show a
 * calm flag-gate notice when the flag is dark — so we assert the panel mounts,
 * not table contents.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts admin-settings-folded-tabs
 */
const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

/** Navigate + let the SPA bootstrap + lazy Settings chunk settle (no networkidle — it never idles here). */
async function go(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1800);
}

test.describe('admin — Domains + API Tokens folded into Settings (prod lock)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('Settings tablist exposes the new Domains + API Tokens tabs', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings');
    await expect(page.getByRole('tab', { name: 'Domains' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'API Tokens' })).toBeVisible();
  });

  test('Domains tab mounts the embedded domains surface', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings');
    await page.getByRole('tab', { name: 'Domains' }).click();
    await expect(page.locator('[data-testid="settings-domains-panel"]')).toBeVisible();
    await expect(page.locator('app-admin-domains')).toBeAttached();
  });

  test('API Tokens tab mounts the embedded api-tokens surface', async ({ page }) => {
    await seed(page);
    await go(page, '/admin/settings');
    await page.getByRole('tab', { name: 'API Tokens' }).click();
    await expect(page.locator('[data-testid="settings-api-tokens-panel"]')).toBeVisible();
    await expect(page.locator('app-admin-api-tokens')).toBeAttached();
  });

  test('/admin/domains client-redirects into Settings and shows the Domains panel', async ({ page }) => {
    await seed(page);
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForURL((u) => u.href.includes('/admin/settings'), { timeout: 20000 });
    await expect(page.locator('[data-testid="settings-domains-panel"]')).toBeVisible();
  });

  test('/admin/api-tokens client-redirects into Settings and shows the API Tokens panel', async ({ page }) => {
    await seed(page);
    await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForURL((u) => u.href.includes('/admin/settings'), { timeout: 20000 });
    await expect(page.locator('[data-testid="settings-api-tokens-panel"]')).toBeVisible();
  });

  test('left-nav "More tools" no longer links to the standalone Domains / API Tokens routes', async ({ page }) => {
    await seed(page);
    await go(page, '/admin');
    // routerLink to a plain path renders as href; both sidebar links were removed.
    await expect(page.locator('aside a[href="/admin/domains"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/admin/api-tokens"]')).toHaveCount(0);
  });
});
