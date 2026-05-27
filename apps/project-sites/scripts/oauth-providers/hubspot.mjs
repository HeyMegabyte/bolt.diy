/**
 * @file scripts/oauth-providers/hubspot.mjs
 * @brief Provision a HubSpot OAuth app via a developer account.
 *
 * Portal: https://app.hubspot.com/developer/{developerHubId}/applications
 *
 * HubSpot requires a developer account distinct from a regular Hub. Sign up
 * for free at https://developers.hubspot.com/get-started — sign-up provisions
 * a Developer Test Account and a HubID.
 *
 * Flow:
 *   1. Navigate to developer applications list
 *   2. Click "Create app"
 *   3. Public app info: name, description, app URL
 *   4. Auth tab: redirect URL, scopes
 *   5. Save → Client ID + Client Secret visible
 */

export const provider = {
  name: 'hubspot',
  portalUrl: 'https://app.hubspot.com/developer/applications',
  redirectUri: 'https://projectsites.dev/api/mcp/hubspot/callback',
  envKeys: {
    client_id: 'HUBSPOT_OAUTH_CLIENT_ID',
    client_secret: 'HUBSPOT_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login/.test(page.url())) {
      console.log('  ! Sign in to HubSpot in the browser window, then resume.');
      await page.waitForURL(/developer.*applications/, { timeout: 5 * 60_000 });
    }

    await page.getByRole('button', { name: /create app|new app/i }).first().click();

    // App info
    await page.getByLabel(/^name|public app name/i).first().fill('Project Sites');
    await page
      .getByLabel(/description/i)
      .first()
      .fill('Project Sites MCP integration — agentic website builder.')
      .catch(() => {});
    await page
      .getByLabel(/app url|app website/i)
      .first()
      .fill('https://projectsites.dev')
      .catch(() => {});

    // Switch to Auth tab
    await page.getByRole('tab', { name: /auth/i }).click().catch(() => {});

    await page.getByLabel(/redirect url/i).first().fill(redirectUri);

    // Reasonable default scope set
    for (const scope of ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.schemas.contacts.read']) {
      await page.getByText(scope, { exact: false }).first().click().catch(() => {});
    }

    await page.getByRole('button', { name: /^create app|^save|^submit/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';
    await page.getByRole('button', { name: /show|reveal/i }).first().click().catch(() => {});
    const clientSecret = (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';

    if (!clientId || !clientSecret) throw new Error('HubSpot: could not scrape credentials.');
    return { client_id: clientId, client_secret: clientSecret };
  },
};
