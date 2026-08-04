/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the AI Endpoints registry
 * (`/admin/ai-endpoints`, `AdminAiEndpointsComponent`). Coverage gap closed this
 * fire — the section (restored to a standalone route in P0.79) had no admin-verify
 * E2E.
 *
 * Enumerated read-only (directive #1). Gates are org-agnostic (E2E_API_KEY ≠
 * brian's org, gotcha #4): the page renders one honest state (list / empty /
 * no-filter-match / load-error / loading), the section's `/ai-endpoints` fetch does
 * NOT 4xx/5xx (a flag-dark endpoint would surface here per
 * [[flag-gated-fetch-gate-on-ison-not-silent]]), 0 console errors, no error-boundary
 * crash. The filter is exercised across the value-domain (a no-match query →
 * clear). Non-mutating: never creates/deploys/deletes an endpoint.
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const NOISE = /Failed to load resource|net::ERR|google-analytics|\/g\/collect|posthog/i;

test.describe('Admin · AI Endpoints registry (P0-ADMIN)', () => {
  test('renders an honest state with 0 console errors + 0 failed section requests', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const consoleErrors: string[] = [];
    const failed: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) consoleErrors.push(m.text().slice(0, 140));
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 140)));
    page.on('response', (res) => {
      const u = res.url();
      if (res.status() >= 400 && u.includes('/api/') && /ai-endpoints/.test(u)) {
        failed.push(`${res.status()} ${u.replace('https://projectsites.dev', '').slice(0, 70)}`);
      }
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/ai-endpoints', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="ai-endpoints-page"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2500); // let the endpoints fetch resolve

    const info = await page.evaluate(() => ({
      isAdmin404: /doesn.t exist/i.test(document.body.innerText || ''),
      crashed: /ran into a problem|something went wrong/i.test(document.body.innerText || ''),
      mainLen: (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length,
    }));
    expect(info.isAdmin404, '/admin/ai-endpoints must not be an admin-404').toBe(false);
    expect(info.crashed, 'must not hit the error boundary').toBe(false);
    expect(info.mainLen, 'renders real content').toBeGreaterThan(80);
    expect(failed, `the /ai-endpoints fetch must resolve (no 4xx/5xx) — saw ${failed.join(' | ')}`).toEqual([]);
    expect(consoleErrors, `0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);

    // One honest data state is showing (never a blank panel).
    const states = [
      '[data-testid="ai-endpoints-list-card"]',
      '[data-testid="ai-endpoints-load-error"]',
      '[data-testid="ai-endpoints-nomatch"]',
    ];
    const anyState =
      (await page.locator(states.join(', ')).count()) > 0 ||
      /build your first|no endpoints|create/i.test(await page.locator('main').innerText().catch(() => ''));
    expect(anyState, 'an honest AI-endpoints state renders (list / empty / error)').toBe(true);
  });

  test('the filter narrows to a no-match state and clears back', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/ai-endpoints', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="ai-endpoints-page"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(2000);

    const cards = page.locator('[data-testid="ai-endpoints-list-card"]');
    const filter = page.locator('[data-testid="ai-endpoints-filter"]');
    if ((await cards.count()) === 0 || (await filter.count()) === 0) {
      // No endpoints on this org → the empty state IS the correct surface. Assert it.
      expect(
        /build your first|no endpoints|create/i.test(await page.locator('main').innerText()),
        'with no endpoints the empty state renders',
      ).toBe(true);
      return;
    }

    // With endpoints present: a gibberish filter → the no-match notice → clear restores.
    await filter.fill('zzzqqq-no-endpoint-matches');
    await expect(
      page.locator('[data-testid="ai-endpoints-nomatch"]'),
      'a no-filter-match notice shows',
    ).toBeVisible({ timeout: 5000 });
    await page.locator('[data-testid="ai-endpoints-clear-filters"]').click();
    await expect(page.locator('[data-testid="ai-endpoints-nomatch"]'), 'clearing restores the list').toBeHidden({
      timeout: 5000,
    });
    expect(await cards.count(), 'endpoint cards return after clearing the filter').toBeGreaterThan(0);
  });
});
