/**
 * @module e2e/admin-flag-gated
 *
 * Regression guard for round 111 (commit 33de2b8a): flag-gated sections must
 * NOT fire their org-scoped data fetch when the feature flag is off. Before the
 * fix, site-dna + inbox inferred flag-state from a failing fetch (404 ->
 * flagEnabled=false), but the ApiService switch (rounds 101-102) made that
 * fetch toast "Can't reach the server" on a disabled feature (inbox re-toasted
 * every 30s via its poll). The fix gates the fetch on FeatureFlagService.isOn().
 *
 * We assert at the NETWORK layer — the org-scoped endpoint is never requested
 * when the flag is off — which precisely locks the fix and avoids the
 * toast-text ambiguity (background AdminState polls share the same error copy).
 * Only the public /api/feature-flags probe should fire.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run:
 *   E2E_API_KEY=psk_test_… npx playwright test --config=playwright.prod.config.ts admin-flag-gated
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
      );
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — flag-gated sections do not fetch org data when disabled (round 111)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('inbox (flag off): no /api/inbox/conversations fetch; disabled message shows', async ({ page }) => {
    test.setTimeout(60000);
    const orgFetches: string[] = [];
    page.on('request', (r) => { if (/\/api\/inbox\/conversations/.test(r.url())) orgFetches.push(r.url()); });
    await seed(page);
    await page.goto('/admin/inbox', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    // The disabled state must render (proves the flag resolved off + section handled it).
    await expect(page.getByText(/behind the/i).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500); // window for any (incorrect) fetch to fire
    expect(orgFetches, `inbox must NOT fetch org data when unified_inbox is off:\n${orgFetches.join('\n')}`).toEqual([]);
  });

  test('site-dna (flag off): no /api/site-dna fetch; disabled message shows (or skip without a site)', async ({ page }) => {
    test.setTimeout(60000);
    const orgFetches: string[] = [];
    page.on('request', (r) => { if (/\/api\/site-dna\//.test(r.url())) orgFetches.push(r.url()); });
    await seed(page);
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    const siteLink = page.locator('a[href^="/admin/sites/"]').first();
    await siteLink.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { /* may be empty */ });
    if ((await siteLink.count()) === 0) {
      test.skip(true, 'No site rows from the test token — site-dna param route needs a site id.');
      return;
    }
    const id = ((await siteLink.getAttribute('href')) ?? '').match(/\/admin\/sites\/([^/]+)/)?.[1];
    if (!id) { test.skip(true, 'Could not parse a site id.'); return; }

    await page.goto(`/admin/sites/${id}/dna`, { waitUntil: 'load' });
    await expect(page.getByText(/behind the/i).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500);
    expect(orgFetches, `site-dna must NOT fetch org data when the flag is off:\n${orgFetches.join('\n')}`).toEqual([]);
  });
});
