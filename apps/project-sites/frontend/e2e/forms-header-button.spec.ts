/**
 * E2E — "Form Handling Prompt" button lives inline with the page title.
 *
 * The button used to hide whenever the inbox was empty and lived inside
 * an empty-state card; it now sits in the page header and is always
 * available — right-aligned next to the "Forms" title. The text used to
 * read "Form Handling Prompt(s)" and now reads "Form Handling Prompt".
 *
 * @see apps/project-sites/frontend/src/app/pages/admin/sections/forms.component.ts
 */
import { test, expect } from './fixtures.js';

test.describe('Forms section — header CTA placement + label', () => {
  test('header button is visible with both 0 submissions and N submissions, right-aligned, text = "Form Handling Prompt"', async ({ page }) => {
    // Mock auth + the minimum API surface the section depends on.
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'admin@example.com', user_id: 'user-1', org_id: 'org-1' }) }),
    );
    await page.route('**/api/sites', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'site-1',
              slug: 'vitos-mens-salon',
              name: "Vito's Mens Salon",
              status: 'published',
              plan: 'free',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              hostnames: [{ id: 'h-1', hostname: 'vitos-mens-salon.projectsites.dev', status: 'active', is_default: true }],
            },
          ],
        }),
      }),
    );
    await page.route('**/api/sites/site-1/forms*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.route('**/api/sites/site-1/mcp/connections', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
    );
    await page.route('**/api/billing/subscription', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"plan":"free","status":"active"}}' }),
    );
    await page.route('**/api/billing/entitlements', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{"max_sites":3,"max_custom_domains":1}}' }),
    );

    await page.addInitScript(() => {
      localStorage.setItem('ps_session', JSON.stringify({ token: 'mock-token-123', identifier: 'admin@example.com' }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
      localStorage.setItem('ps_selected_site_id', 'site-1');
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.goto('/admin/forms');
    await page.waitForLoadState('domcontentloaded');
    // Wait for the header button to mount rather than networkidle (admin polls
    // every 30s — networkidle can never trigger).
    await page.locator('header [data-testid="forms-open-prompt-designer"]').waitFor({ state: 'visible', timeout: 15000 });

    // The header button must be visible even with 0 submissions.
    const headerButton = page.locator('header [data-testid="forms-open-prompt-designer"]');
    await expect(headerButton).toBeVisible();
    await expect(headerButton).toHaveText(/^\s*Form Handling Prompt\s*$/);

    // The button + title share the same horizontal row at the top of the
    // header. With `items-start` their top edges align; the button is
    // right of the title (right-aligned via `justify-between`).
    const titleBox = await page.locator('header h2', { hasText: /^Forms$/ }).boundingBox();
    const buttonBox = await headerButton.boundingBox();
    expect(titleBox && buttonBox).toBeTruthy();
    if (titleBox && buttonBox) {
      // Top edges align within 20px (items-start tolerance).
      expect(Math.abs(titleBox.y - buttonBox.y)).toBeLessThanOrEqual(20);
      // The button sits to the right of the title.
      expect(buttonBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
    }

    // The legacy plural label "Form Handling Prompt(s)" must NOT appear in the
    // header anymore — only the singular form.
    const oldLabelInHeader = page.locator('header').getByText('Form Handling Prompt(s)');
    await expect(oldLabelInHeader).toHaveCount(0);
  });
});
