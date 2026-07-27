/**
 * Super Admin + System Services — auth-gate verification for operator-only sections.
 *
 * Per ADR-0034: system-services is the canonical platform service catalog (§66).
 * Super-admin is cost/markup tuning + wallet drill-down.
 * Both are sysAdminGuard-gated — normal users get redirected.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('System Services', () => {
  test('/admin/system-services redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/system-services`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });
});

test.describe('Super Admin', () => {
  test('/admin/super-admin redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/super-admin`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });
});

test.describe('Service subdomain health', () => {
  test('mail.projectsites.dev (Listmonk) is reachable', async ({ request }) => {
    const res = await request.get('https://mail.projectsites.dev');
    expect([200, 301, 302, 401, 403]).toContain(res.status());
  });

  test('traces.projectsites.dev (Langfuse) is reachable', async ({ request }) => {
    const res = await request.get('https://traces.projectsites.dev');
    // CF Access-gated — 200 (Access login page) is valid
    expect([200, 301, 302]).toContain(res.status());
  });

  test('cms.projectsites.dev (Payload) is reachable', async ({ request }) => {
    const res = await request.get('https://cms.projectsites.dev');
    expect([200, 301, 302, 401]).toContain(res.status());
  });
});
