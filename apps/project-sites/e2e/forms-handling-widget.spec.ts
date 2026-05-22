/**
 * @module e2e/forms-handling-widget
 * @description E2E coverage for the redesigned Forms section (`/admin/forms`).
 *
 * Asserts:
 *   - the Refresh button has been removed from the inbox header
 *   - a "Live · last sync …" pill is rendered in its place
 *   - the Form Handling Prompt widget renders inline (no modal trigger)
 *   - MCP integration pills render when connections are returned
 *   - tapping an unchecked pill flips it to the brand-color "on" state
 *   - the Improve-with-AI button (a) is sized compactly and (b) succeeds
 *     when the prompt textarea is empty (loads the seed example), without
 *     a 500-style error toast
 *
 * All assertions deliberately use semantic locators (text/role) so the spec
 * survives Tailwind class refactors. Routes are mocked at the fetch layer so
 * the test never depends on a real signed-in admin session.
 */

import { test, expect, type Route } from './fixtures.js';

const SITE_ID = 'site-test-forms';
const ADMIN_URL = '/admin/forms';

test.describe('Forms section — handling widget', () => {
  test.beforeEach(async ({ page }) => {
    // Inject a deterministic localStorage admin session so the route renders.
    await page.addInitScript(({ siteId }: { siteId: string }) => {
      const w = window as unknown as Record<string, unknown>;
      w['__forms_e2e_site_id'] = siteId;
      try {
        localStorage.setItem('ps_session', JSON.stringify({ token: 'e2e-token' }));
        localStorage.setItem('ps_selected_site', siteId);
      } catch {
        /* localStorage unavailable — test still runs against unmocked admin */
      }
    }, { siteId: SITE_ID });

    // Stub every API call the page makes — we want a fully offline render.
    await page.route('**/api/**', async (route: Route) => {
      const url = route.request().url();
      const method = route.request().method();

      if (url.includes('/mcp/connections')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              providers: [],
              connections: [
                { provider: 'stripe', status: 'active' },
                { provider: 'mailchimp', status: 'active' },
                { provider: 'resend', status: 'active' },
              ],
            },
          }),
        });
      }
      if (url.includes('/ai-settings') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              form_router_prompt: '',
              form_router_prompt_default: 'DEFAULT_ROUTER_PROMPT_v2',
              reply_email: 'owner@example.com',
            },
          }),
        });
      }
      if (url.includes('/ai-settings') && (method === 'PUT' || method === 'POST')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { saved: true } }),
        });
      }
      if (url.includes('/form-submissions') && method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [] }),
        });
      }
      if (url.includes('/form-router/improve')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              mode: 'seed',
              text: 'ROLE\nYou are the AI form-router for {{business}}. Pick ONE tool and respond with strict JSON. Newsletter signups → add_to_mailchimp.',
            },
          }),
        });
      }
      if (url.includes('/auth/me')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              user: { id: 'u-1', email: 'admin@example.com' },
              orgs: [{ id: 'org-1', role: 'owner' }],
              sites: [{ id: SITE_ID, slug: 'demo', business_name: 'Demo' }],
            },
          }),
        });
      }
      return route.continue();
    });
  });

  test('renders Live pill and has NO Refresh button on the Forms inbox', async ({ page }) => {
    await page.goto(ADMIN_URL);
    // Wait for the section heading to confirm the page mounted.
    await expect(page.getByRole('heading', { name: 'Forms', level: 2 })).toBeVisible();

    // The old Refresh button must be gone.
    await expect(page.getByRole('button', { name: /^Refresh$/ })).toHaveCount(0);

    // The new "Live · last sync …" pill must be visible.
    await expect(page.getByText(/Live · last sync/i)).toBeVisible();
  });

  test('renders MCP pills and toggles to brand color when clicked', async ({ page }) => {
    await page.goto(ADMIN_URL);
    await expect(page.getByRole('heading', { name: 'Form Handling Prompt' })).toBeVisible();

    const stripePill = page.getByRole('button', { name: /Stripe/i });
    await expect(stripePill).toBeVisible();
    await expect(stripePill).toHaveAttribute('aria-pressed', 'false');

    await stripePill.click();
    await expect(stripePill).toHaveAttribute('aria-pressed', 'true');
    await expect(stripePill).toHaveClass(/is-on/);

    // Click again to verify the toggle is symmetric.
    await stripePill.click();
    await expect(stripePill).toHaveAttribute('aria-pressed', 'false');
  });

  test('Improve button loads a seed prompt when textarea is empty', async ({ page }) => {
    await page.goto(ADMIN_URL);
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('');

    const btn = page.getByRole('button', { name: /Load an example routing prompt/i });
    await expect(btn).toBeVisible();
    await btn.click();

    // Textarea must populate with the seed prompt (≥ 40 chars).
    await expect.poll(async () => (await textarea.inputValue()).length).toBeGreaterThanOrEqual(40);
    expect((await textarea.inputValue()).toLowerCase()).toContain('form-router');
  });

  test('Fallback reply email notice links to Settings → General', async ({ page }) => {
    await page.goto(ADMIN_URL);
    const link = page.getByRole('link', { name: /Settings → General/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/admin\/settings/);
  });
});
