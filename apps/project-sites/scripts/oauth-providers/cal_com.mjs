/**
 * @file scripts/oauth-providers/cal_com.mjs
 * @brief Provision a Cal.com OAuth Client.
 *
 * Portal: https://app.cal.com/settings/developer/api-keys (managed) OR
 *         /settings/organizations/{org}/oauth-clients (self-hosted)
 *
 * Cal.com Platform's hosted OAuth client creation lives at:
 *   https://app.cal.com/settings/organizations/oauth-clients
 *
 * For non-org accounts, Cal.com falls back to API-keys (paste-flow). Set
 * CAL_COM_OAUTH_ENABLED=true to attempt the OAuth flow; otherwise this module
 * skips and tells the user to use the paste-key flow in the admin UI.
 */

export const provider = {
  name: 'cal_com',
  portalUrl: 'https://app.cal.com/settings/organizations/oauth-clients',
  redirectUri: 'https://projectsites.dev/api/mcp/cal_com/callback',
  envKeys: {
    client_id: 'CAL_COM_OAUTH_CLIENT_ID',
    client_secret: 'CAL_COM_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/auth\/login/.test(page.url())) {
      console.log('  ! Sign in to Cal.com in the browser window, then resume.');
      await page.waitForURL(/oauth-clients|api-keys/, { timeout: 5 * 60_000 });
    }

    // OAuth clients require a Cal.com Platform / Organization plan.
    if (/api-keys/.test(page.url())) {
      throw new Error(
        'Cal.com account is not on Platform/Organization plan — OAuth clients unavailable. ' +
          'Use paste-key flow in admin UI with a personal API key from /settings/developer/api-keys.',
      );
    }

    await page.getByRole('button', { name: /add|create.*client|new client/i }).first().click();
    await page.getByLabel(/^name$/i).first().fill('Project Sites');
    await page.getByLabel(/redirect.*uri|callback/i).first().fill(redirectUri);
    await page
      .getByLabel(/permissions|scopes/i)
      .first()
      .click()
      .catch(() => {});

    await page.getByRole('button', { name: /^create|^save|^submit/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';
    await page.getByRole('button', { name: /reveal|show/i }).first().click().catch(() => {});
    const clientSecret = (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';

    if (!clientId || !clientSecret) throw new Error('Cal.com: could not scrape credentials.');
    return { client_id: clientId, client_secret: clientSecret };
  },
};
