/**
 * @file scripts/oauth-providers/linear.mjs
 * @brief Provision a Linear OAuth2 application.
 *
 * Portal: https://linear.app/settings/api/applications
 *
 * Flow:
 *   1. Navigate to settings/api/applications
 *   2. Click "Create new" (or "Create an OAuth application")
 *   3. Fill: name, description, developer URL, callback URL, icon (optional)
 *   4. Save → application detail page shows Client ID
 *   5. Click "Generate new client secret" → modal reveals secret once
 *   6. Scrape both
 */

export const provider = {
  name: 'linear',
  portalUrl: 'https://linear.app/settings/api/applications',
  redirectUri: 'https://projectsites.dev/api/mcp/linear/callback',
  envKeys: {
    client_id: 'LINEAR_OAUTH_CLIENT_ID',
    client_secret: 'LINEAR_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/login|signin/.test(page.url())) {
      console.log('  ! Sign in to Linear in the browser window, then resume.');
      await page.waitForURL(/settings\/api/, { timeout: 5 * 60_000 });
    }

    await page
      .getByRole('button', { name: /create new|new application|create an oauth/i })
      .first()
      .click();

    await page.getByLabel(/^name$|application name/i).first().fill('Project Sites');
    await page
      .getByLabel(/description/i)
      .first()
      .fill('Project Sites MCP integration — agentic website builder.');
    await page
      .getByLabel(/developer url|website|company website/i)
      .first()
      .fill('https://projectsites.dev')
      .catch(() => {});
    await page.getByLabel(/callback url|redirect/i).first().fill(redirectUri);

    await page.getByRole('button', { name: /create|save|submit/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    const clientId = (await page.getByText(/^[a-f0-9]{32,64}$/).first().textContent())?.trim() ?? '';

    // Generate secret
    await page
      .getByRole('button', { name: /generate.*secret|create.*secret|new.*secret/i })
      .first()
      .click();
    await page.waitForTimeout(500);

    // Secret is shown in a modal — pull it from any input or code block
    const secretInput = page.locator('input[readonly], code, pre').filter({ hasText: /^[a-zA-Z0-9_-]{30,}$/ }).first();
    const clientSecret = (await secretInput.textContent())?.trim()
      ?? (await secretInput.inputValue().catch(() => '')).trim();

    if (!clientId || !clientSecret) {
      throw new Error('Could not scrape Linear credentials; the portal may have changed.');
    }
    return { client_id: clientId, client_secret: clientSecret };
  },
};
