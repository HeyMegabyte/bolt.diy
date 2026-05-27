/**
 * @file scripts/oauth-providers/pagerduty.mjs
 * @brief Provision a PagerDuty OAuth client.
 *
 * Portal: https://developer.pagerduty.com/ → My Apps → Create New App
 *
 * PagerDuty requires registering an "app" before creating an OAuth client.
 * After the app exists, "Functionality → Add OAuth 2.0 functionality" gives
 * Client ID + Client Secret.
 */

export const provider = {
  name: 'pagerduty',
  portalUrl: 'https://developer.pagerduty.com/my-apps/',
  redirectUri: 'https://projectsites.dev/api/mcp/pagerduty/callback',
  envKeys: {
    client_id: 'PAGERDUTY_OAUTH_CLIENT_ID',
    client_secret: 'PAGERDUTY_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login|\/sign_in/.test(page.url())) {
      console.log('  ! Sign in to PagerDuty (developer portal) in the browser window, then resume.');
      await page.waitForURL(/my-apps/, { timeout: 5 * 60_000 });
    }

    await page.getByRole('button', { name: /create new app|new app/i }).first().click();
    await page.getByLabel(/^name/i).first().fill('Project Sites');
    await page
      .getByLabel(/description/i)
      .first()
      .fill('Project Sites MCP integration')
      .catch(() => {});
    await page
      .getByLabel(/category/i)
      .first()
      .selectOption({ label: 'Other' })
      .catch(() => {});

    await page.getByRole('button', { name: /^save|^create/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // Add OAuth 2.0 functionality
    await page.getByRole('button', { name: /add oauth|add.*oauth 2/i }).first().click();
    await page.getByLabel(/redirect url|callback url/i).first().fill(redirectUri);
    await page.getByRole('button', { name: /^save|^register/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';
    const clientSecret = (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';

    if (!clientId || !clientSecret) throw new Error('PagerDuty: could not scrape credentials.');
    return { client_id: clientId, client_secret: clientSecret };
  },
};
