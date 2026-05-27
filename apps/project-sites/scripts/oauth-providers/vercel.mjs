/**
 * @file scripts/oauth-providers/vercel.mjs
 * @brief Provision a Vercel Integration (OAuth client_id + client_secret).
 *
 * Portal: https://vercel.com/dashboard/integrations/console
 *
 * Vercel integrations require a "Developer" account (free). The integration
 * console lets you create both OAuth-app-style integrations and full marketplace
 * integrations — we only need OAuth.
 *
 * Flow:
 *   1. Navigate to dashboard/integrations/console
 *   2. Click "Create" → choose "OAuth Application" (or "Custom Integration")
 *   3. Fill: name, slug, redirect URLs, webhook URL (optional)
 *   4. Save → detail page renders Client ID + Client Secret
 */

export const provider = {
  name: 'vercel',
  portalUrl: 'https://vercel.com/dashboard/integrations/console',
  redirectUri: 'https://projectsites.dev/api/mcp/vercel/callback',
  envKeys: {
    client_id: 'VERCEL_OAUTH_CLIENT_ID',
    client_secret: 'VERCEL_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login/.test(page.url())) {
      console.log('  ! Sign in to Vercel in the browser window, then resume.');
      await page.waitForURL(/integrations\/console/, { timeout: 5 * 60_000 });
    }

    await page.getByRole('button', { name: /create integration|create|new/i }).first().click();
    await page.getByRole('button', { name: /oauth application|custom integration/i }).first().click().catch(() => {});

    await page.getByLabel(/^name$/i).first().fill('Project Sites');
    await page.getByLabel(/slug/i).first().fill('project-sites').catch(() => {});
    await page.getByLabel(/redirect url|callback/i).first().fill(redirectUri);

    await page.getByRole('button', { name: /^create|^save|^submit/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page
      .getByText(/client id/i)
      .locator('xpath=following::input[1]')
      .first()
      .inputValue()
      .catch(async () => (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent()) ?? '')).trim();
    await page.getByRole('button', { name: /show|reveal/i }).first().click().catch(() => {});
    const clientSecret = (await page
      .getByText(/client secret/i)
      .locator('xpath=following::input[1]')
      .first()
      .inputValue()
      .catch(async () => (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent()) ?? '')).trim();

    if (!clientId || !clientSecret) throw new Error('Vercel: could not scrape credentials.');
    return { client_id: clientId, client_secret: clientSecret };
  },
};
