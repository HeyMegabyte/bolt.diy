/**
 * @module e2e/admin-social-campaign
 *
 * Authed prod E2E for the AI campaign generator at `/admin/social/campaign`
 * (feat(social) campaign generator + auto-fill). Proves against the LIVE bundle:
 *   - the page renders (section + heading + brief form)
 *   - the Generate button is GATED — disabled until a business name AND a
 *     selected account exist (business-name-only stays disabled)
 *   - the business field is present + editable (prefill round-trips; the field
 *     stays user-editable whether or not the test org has a site to prefill from)
 *
 * Sub-route under the router-outlet (NOT the iframe-covered `/admin` editor
 * route), so it is click-reachable for a real user. Seeds `ps_session` from
 * `E2E_API_KEY`. Run: `E2E_API_KEY=$(get-secret E2E_API_KEY) npm run test:e2e:prod`.
 */
import { test, expect } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

test.describe('AI campaign generator — /admin/social/campaign (authed, live)', () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((k: string) => {
      try {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }),
        );
      } catch {
        /* private-mode / quota — the app guards localStorage itself */
      }
    }, KEY);
  });

  test('renders the brief form and gates Generate until the brief is valid', async ({ page }) => {
    await page.goto('/admin/social/campaign', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('social-campaign-section')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /AI campaign generator/i })).toBeVisible();
    await expect(page.getByTestId('campaign-form')).toBeVisible();

    // Generate is disabled with an empty brief (no business name, no account).
    const generate = page.getByTestId('campaign-generate');
    await expect(generate).toBeDisabled();

    // A business name ALONE is not enough — still needs a selected account.
    await page.getByTestId('campaign-business').fill('E2E Test Salon');
    await expect(generate).toBeDisabled();
  });

  test('the business field is present and stays user-editable (prefill round-trip)', async ({
    page,
  }) => {
    await page.goto('/admin/social/campaign', { waitUntil: 'domcontentloaded' });
    const biz = page.getByTestId('campaign-business');
    await expect(biz).toBeVisible({ timeout: 20_000 });

    // Whether or not prefill populated it from the org's site, the user can
    // always override — assert the field round-trips a typed value.
    await biz.fill('Override Co');
    await expect(biz).toHaveValue('Override Co');
  });

  test('length presets are selectable', async ({ page }) => {
    await page.goto('/admin/social/campaign', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('social-campaign-section')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('campaign-len-7').click();
    await page.getByTestId('campaign-len-30').click();
    // No assertion on internal state from a black-box test — clicking must not
    // throw or navigate away; the section is still present.
    await expect(page.getByTestId('social-campaign-section')).toBeVisible();
  });
});
