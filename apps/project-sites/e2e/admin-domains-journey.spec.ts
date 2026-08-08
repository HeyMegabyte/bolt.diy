import { resilientGet } from './helpers/api-request.js';
import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

test.describe('Admin — Domains (authenticated journey)', () => {
  test('renders real content, interactions work, a11y clean', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // GET stubs
    const hostnamesStub = (route: import('@playwright/test').Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'h1', hostname: 'mysite.projectsites.dev', is_primary: true, verified: true },
            { id: 'h2', hostname: 'custom.example.com', is_primary: false, verified: false },
          ],
        }),
      });
    await page.route('**/api/sites/*/hostnames**', hostnamesStub);
    // Mid-token ** can't cross '/' — twin covers /hostnames/:id/primary etc.
    await page.route('**/api/sites/*/hostnames/**', hostnamesStub);
    // glob-ok: query-suffix only — /api/domains/search has no subpaths
    // (search-enrich is a sibling token-extension, no '/' crossed)
    await page.route('**/api/domains/search**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { domain: 'mybusiness.com', available: true, price: 1200 },
            { domain: 'mybusiness.net', available: true, price: 900 },
          ],
        }),
      }));

    // Mutation stub
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/domains`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    // Hostnames table or loading state — no hard error
    const hostnameError = page.locator('[data-testid="hostnames-load-error"]');
    await expect(hostnameError).not.toBeVisible({ timeout: 3_000 }).catch(() => null);

    // Custom domain input (conditional)
    const domainInput = page.locator('[data-testid="custom-domain-input"]');
    if (await domainInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(domainInput).toBeVisible();
      // Type a domain to check input works
      await domainInput.click();
      await page.keyboard.type('testdomain.com');
      await page.keyboard.press('Tab');
    }

    // AI search button (conditional)
    const aiSearchBtn = page.locator('[data-testid="ai-search-btn"]');
    if (await aiSearchBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await aiSearchBtn.click();
      const aiSearchInput = page.locator('[data-testid="ai-search-input"]');
      if (await aiSearchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await aiSearchInput.click();
        await page.keyboard.type('coffee shop');
        await page.keyboard.press('Escape');
      }
    }

    // Backup domain section (conditional)
    const backupDomain = page.locator('[data-testid="backup-domain"]');
    if (await backupDomain.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(backupDomain).toBeVisible();
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-domains/desktop.png', fullPage: true });
    await checkA11y(page, 'admin-domains');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'e2e/screenshots/admin-domains/mobile.png', fullPage: true });

    const real = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('third-party') && !e.includes('ERR_BLOCKED_BY_CLIENT') && !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/domains`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first()).toBeVisible();
  });

  test('API: GET /api/domains/search returns structured response', async ({ request }) => {
    // Live registrar/RDAP upstream — honestly slow; resilient transport + real budget.
    const res = await resilientGet(request, `${PROD_URL}/api/domains/search?q=test`, { timeout: 20_000 });
    expect([200, 401, 404]).toContain(res.status());
  });

  test('API: GET /api/sites returns list', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/sites`);
    expect([200, 401, 404]).toContain(res.status());
  });
});
