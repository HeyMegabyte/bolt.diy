/**
 * @file scripts/oauth-providers/calendly.mjs
 * @brief Provision a Calendly OAuth application.
 *
 * Portal: https://calendly.com/integrations/api_webhooks → "OAuth Apps" tab
 * (alternate: https://developer.calendly.com/ for the developer portal)
 *
 * Note: Calendly OAuth requires a paid plan (Standard, Teams, or Enterprise).
 * Free accounts cannot create OAuth apps and must use Personal Access Tokens.
 */

export const provider = {
  name: 'calendly',
  portalUrl: 'https://calendly.com/integrations/api_webhooks',
  redirectUri: 'https://projectsites.dev/api/mcp/calendly/callback',
  envKeys: {
    client_id: 'CALENDLY_OAUTH_CLIENT_ID',
    client_secret: 'CALENDLY_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login/.test(page.url())) {
      console.log('  ! Sign in to Calendly in the browser window, then resume.');
      await page.waitForURL(/api_webhooks|developer/, { timeout: 5 * 60_000 });
    }

    await page.getByRole('tab', { name: /oauth/i }).click().catch(() => {});
    await page.getByRole('button', { name: /create.*application|new.*application/i }).first().click();

    await page.getByLabel(/^name|application name/i).first().fill('Project Sites');
    await page.getByLabel(/redirect.*uri|callback/i).first().fill(redirectUri);
    await page
      .getByLabel(/description/i)
      .first()
      .fill('Project Sites MCP integration')
      .catch(() => {});

    await page.getByRole('button', { name: /^create|^save|^register/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';
    await page.getByRole('button', { name: /show|reveal/i }).first().click().catch(() => {});
    const clientSecret = (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';

    if (!clientId || !clientSecret) {
      throw new Error('Calendly: could not scrape credentials (paid plan required for OAuth apps).');
    }
    return { client_id: clientId, client_secret: clientSecret };
  },
};
