import { test, expect, type Page } from '@playwright/test';

/**
 * Prod regression lock for the two-layer feature plane + Settings consolidation
 * shipped 2026-06-07 (commits ecf65b83 · 81696c9e · 64ccc894):
 *
 *  - System Admin (LAYER 1, platform-ops flags) is operator-only — hidden in the
 *    nav + /admin/feature-flags redirects to /admin/site-features for non-operators.
 *  - The retired Features Hub (/admin/features) has NO route → the admin `**`
 *    catch-all renders the friendly not-found (it was NOT given a redirect,
 *    unlike seo/mcp/webhooks; the owner Features layer lives at /admin/site-features).
 *  - Webhooks moved under Settings → /admin/settings#webhooks (legacy
 *    /admin/webhooks redirects there).
 *  - Email Deliverability is its OWN standalone route (/admin/deliverability →
 *    AdminDeliverabilityComponent, the #12 SPF/DKIM/DMARC wizard) — it was pulled
 *    back OUT of Settings, so it no longer redirects to /admin/settings#email.
 *
 * Seeds `ps_session` from E2E_API_KEY as `test@megabyte.space` — a NON-operator
 * identity (not in SYS_ADMIN_EMAILS), so this exercises the locked-down branch.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts admin-two-layer-settings
 */
const KEY = process.env.E2E_API_KEY ?? '';

async function seedNonOperator(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

async function go(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1800); // SPA hydrate settle
}

/**
 * Navigate to a legacy path and wait for the client-side router redirect to land
 * (cold Angular bootstrap + lazy-chunk load can exceed a fixed wait — assert on
 * the URL transition instead of a sleep).
 */
async function goExpectingRedirect(page: Page, from: string, toContains: string): Promise<void> {
  await page.goto(from, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForURL((url) => url.href.includes(toContains), { timeout: 20000 });
}

test.describe('admin — two-layer feature plane + Settings consolidation (prod lock)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('System Admin (LAYER 1) is operator-only — nav hidden + route redirects for non-operators', async ({ page }) => {
    await seedNonOperator(page);
    await go(page, '/admin');
    // The operator-only "System Admin" nav item must NOT render for a site owner.
    await expect(page.locator('[data-testid="nav-system-admin"]')).toHaveCount(0);
    // The owner-facing "Features" item IS present.
    await expect(page.locator('[data-testid="nav-features"]')).toHaveCount(1);
    // Direct URL to the platform-ops flags bounces to the owner Features layer.
    await goExpectingRedirect(page, '/admin/feature-flags', '/admin/site-features');
    expect(page.url()).toContain('/admin/site-features');
  });

  test('the retired Features Hub (/admin/features) degrades gracefully to the admin not-found', async ({ page }) => {
    await seedNonOperator(page);
    // /admin/features was RETIRED with NO redirect (unlike seo/mcp/webhooks/ai-chat,
    // which redirect to their real surfaces). It has no route → the admin `**`
    // catch-all renders the friendly not-found (never a white screen). The owner
    // Features layer lives at /admin/site-features (covered by the LAYER 1 test).
    await go(page, '/admin/features');
    await expect(page.locator('[data-testid="admin-not-found"]')).toBeVisible({ timeout: 15000 });
  });

  test('Webhooks lives under Settings — /admin/webhooks redirects to the Webhooks tab', async ({ page }) => {
    await seedNonOperator(page);
    await goExpectingRedirect(page, '/admin/webhooks', '/admin/settings');
    expect(page.url()).toContain('/admin/settings');
    await expect(page.locator('[data-testid="settings-webhooks-panel"]')).toBeVisible();
    // The Webhooks tab is among the Settings tablist, selected.
    await expect(page.locator('button[role="tab"]', { hasText: 'Webhooks' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Email Deliverability is its own live section — /admin/deliverability renders the wizard (no redirect)', async ({ page }) => {
    await seedNonOperator(page);
    // Deliverability was pulled back OUT of Settings into a standalone route (#12
    // Email Deliverability Wizard: app.routes.ts `path: 'deliverability'` →
    // AdminDeliverabilityComponent, no sysAdminGuard) — it no longer redirects to
    // /admin/settings. Assert the URL stays put + the component mounted.
    await go(page, '/admin/deliverability');
    expect(page.url()).toContain('/admin/deliverability');
    await expect(page.locator('app-admin-deliverability')).toHaveCount(1);
  });
});
