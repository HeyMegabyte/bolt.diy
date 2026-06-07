import { test, expect, type Page } from '@playwright/test';

/**
 * Prod regression lock for the per-site detail pages (sites/:id/* + swarm/:siteId)
 * after the reliability fixes:
 *  - site-copilot (403c4461): siteId resolved from the route param → no perpetual
 *    loading skeleton (the @Input-only siteId stayed '' → ngOnInit early-returned
 *    → loading() stuck true).
 *  - swarm (776caa72): when the swarm surface is unavailable (404 → flag off /
 *    foreign site) the Start Swarm + Connect-live-stream actions disable instead
 *    of POSTing → 404 → error toast (dead button).
 *
 * Seeds `ps_session` from E2E_API_KEY as `brian@megabyte.space` (operator) so
 * flag-gated surfaces render their real component, not a hidden state.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts admin-site-detail
 */
const KEY = process.env.E2E_API_KEY ?? '';
const SID = 'e2e-site-3';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'brian@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — per-site detail reliability (prod lock)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  // Every per-site detail route must RESOLVE — never sit on a perpetual loading
  // skeleton (the site-copilot bug class: siteId never populated → stuck loading).
  for (const route of [
    `/admin/sites/${SID}/copilot`,
    `/admin/sites/${SID}/dna`,
    `/admin/sites/${SID}/branches`,
    `/admin/sites/${SID}/mcp-server`,
    `/admin/swarm/${SID}`,
  ]) {
    test(`resolves (no stuck loading skeleton): ${route}`, async ({ page }) => {
      await seed(page);
      await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => {});
      // Give the SPA bootstrap + the (real) config/data fetches time to settle.
      await page.waitForTimeout(6000);
      // No element should still claim aria-busy after the load resolves.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    });
  }

  test('swarm: when unavailable for the site, Start Swarm + Connect-stream are disabled (no dead button)', async ({ page }) => {
    await seed(page);
    await page.goto(`/admin/swarm/${SID}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(5000);
    const body = await page.locator('body').innerText();
    if (/isn.t available|not available/i.test(body)) {
      await expect(page.locator('.swarm-header__start')).toBeDisabled();
      await expect(page.locator('.swarm-preview__connect')).toBeDisabled();
    } else {
      // Swarm IS available for this site → the launch button must be enabled.
      await expect(page.locator('.swarm-header__start')).toBeEnabled();
    }
  });
});
