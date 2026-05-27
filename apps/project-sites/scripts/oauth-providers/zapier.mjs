/**
 * @file scripts/oauth-providers/zapier.mjs
 * @brief Provision a Zapier Platform OAuth integration.
 *
 * Portal: https://developer.zapier.com/app/new
 *
 * Zapier OAuth requires a Platform UI integration. This is a multi-step process:
 *   1. Create a new integration (name, description)
 *   2. Configure Authentication → "OAuth v2"
 *   3. Enter Authorization URL, Access Token URL, Refresh URL, redirect_uri
 *   4. Save → Client ID + Client Secret are issued
 *
 * Zapier integrations are typically published to the marketplace (review process).
 * For internal MCP, an unpublished integration works fine for development.
 */

export const provider = {
  name: 'zapier',
  portalUrl: 'https://developer.zapier.com/app/new',
  redirectUri: 'https://projectsites.dev/api/mcp/zapier/callback',
  envKeys: {
    client_id: 'ZAPIER_OAUTH_CLIENT_ID',
    client_secret: 'ZAPIER_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login/.test(page.url())) {
      console.log('  ! Sign in to Zapier Platform in the browser window, then resume.');
      await page.waitForURL(/developer.zapier.com\/app/, { timeout: 5 * 60_000 });
    }

    await page.getByLabel(/title|^name/i).first().fill('Project Sites');
    await page
      .getByLabel(/description/i)
      .first()
      .fill('Project Sites MCP integration')
      .catch(() => {});
    await page
      .getByLabel(/role/i)
      .first()
      .selectOption({ label: 'I am an employee of the company' })
      .catch(() => {});
    await page
      .getByLabel(/category/i)
      .first()
      .selectOption({ label: 'Marketing' })
      .catch(() => {});

    await page.getByRole('button', { name: /^create|^save/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // Navigate to Authentication
    await page.getByRole('link', { name: /authentication/i }).first().click();
    await page.getByText(/OAuth v2/i).first().click().catch(() => {});

    // Fill redirect (the rest of the OAuth flow URLs are filled later by user)
    await page.getByLabel(/redirect uri/i).first().fill(redirectUri).catch(() => {});

    await page.getByRole('button', { name: /^save|^submit/i }).first().click().catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';
    const clientSecret = (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';

    if (!clientId || !clientSecret) {
      throw new Error('Zapier: OAuth flow not fully configured. Open the integration in the Platform UI to complete it manually.');
    }
    return { client_id: clientId, client_secret: clientSecret };
  },
};
