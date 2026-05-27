/**
 * @file scripts/oauth-providers/airtable.mjs
 * @brief Provision an Airtable OAuth integration.
 *
 * Portal: https://airtable.com/create/oauth
 *
 * Flow:
 *   1. Navigate to /create/oauth
 *   2. Fill: Name, OAuth redirect URL, scopes (data.records:read/write, schema.bases:read)
 *   3. Submit → registration page renders Client ID + secret
 */

export const provider = {
  name: 'airtable',
  portalUrl: 'https://airtable.com/create/oauth',
  redirectUri: 'https://projectsites.dev/api/mcp/airtable/callback',
  envKeys: {
    client_id: 'AIRTABLE_OAUTH_CLIENT_ID',
    client_secret: 'AIRTABLE_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login/.test(page.url())) {
      console.log('  ! Sign in to Airtable in the browser window, then resume.');
      await page.waitForURL(/create\/oauth|developers/, { timeout: 5 * 60_000 });
    }

    await page.getByLabel(/integration name|^name$/i).first().fill('Project Sites');
    await page.getByLabel(/redirect.*url/i).first().fill(redirectUri);

    // Default scope set
    for (const scope of ['data.records:read', 'data.records:write', 'schema.bases:read']) {
      await page.getByLabel(scope, { exact: false }).check().catch(() => {});
    }

    await page.getByRole('button', { name: /^register|^create|^save/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';
    await page.getByRole('button', { name: /generate.*secret|create.*secret/i }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    const clientSecret = (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';

    if (!clientId || !clientSecret) throw new Error('Airtable: could not scrape credentials.');
    return { client_id: clientId, client_secret: clientSecret };
  },
};
