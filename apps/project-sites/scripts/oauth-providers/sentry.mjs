/**
 * @file scripts/oauth-providers/sentry.mjs
 * @brief Provision a Sentry OAuth Application (custom integration).
 *
 * Portal: https://sentry.io/settings/{org-slug}/developer-settings/
 *
 * The org slug is required. Set SENTRY_ORG env var or pass --sentry-org=<slug>
 * when invoking the orchestrator. Defaults to "megabyte-labs".
 *
 * Flow:
 *   1. Navigate to developer-settings page (or new-public-integration if empty)
 *   2. Click "Create New Integration" → choose "Public Integration"
 *   3. Fill: name, author, webhook URL, redirect URL, scopes
 *   4. Save → detail page renders Client ID + Client Secret in plaintext
 *   5. Scrape both
 */

const ORG = process.env.SENTRY_ORG ?? 'megabyte-labs';

export const provider = {
  name: 'sentry',
  portalUrl: `https://sentry.io/settings/${ORG}/developer-settings/`,
  redirectUri: 'https://projectsites.dev/api/mcp/sentry/callback',
  envKeys: {
    client_id: 'SENTRY_OAUTH_CLIENT_ID',
    client_secret: 'SENTRY_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/auth\/login/.test(page.url())) {
      console.log('  ! Sign in to Sentry in the browser window, then resume.');
      await page.waitForURL(/developer-settings/, { timeout: 5 * 60_000 });
    }

    // Open create-new-integration modal/page
    await page
      .getByRole('button', { name: /create new integration|create integration/i })
      .first()
      .click();

    // Choose Public integration option
    await page
      .getByRole('button', { name: /public integration/i })
      .first()
      .click()
      .catch(() => {});

    // Fill name
    await page.getByLabel(/^name$/i).first().fill('Project Sites');
    await page
      .getByLabel(/author/i)
      .first()
      .fill('Megabyte Labs')
      .catch(() => {});

    // Webhook + redirect — Sentry requires webhook even if we don't use it
    await page
      .getByLabel(/webhook url/i)
      .first()
      .fill('https://projectsites.dev/api/mcp/sentry/webhook')
      .catch(() => {});
    await page.getByLabel(/redirect url/i).first().fill(redirectUri);

    // Submit
    await page
      .getByRole('button', { name: /^save|create|submit$/i })
      .first()
      .click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // Sentry shows credentials in copyable boxes after creation
    const clientId = (await page.getByText(/client id/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';
    const clientSecret =
      (await page.getByText(/client secret/i).locator('xpath=following::*[1]').first().textContent())?.trim() ?? '';

    if (!clientId || !clientSecret) {
      throw new Error('Could not scrape Sentry credentials; the developer-settings UI may have changed.');
    }
    return { client_id: clientId, client_secret: clientSecret };
  },
};
