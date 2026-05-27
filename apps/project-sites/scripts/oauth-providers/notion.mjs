/**
 * @file scripts/oauth-providers/notion.mjs
 * @brief Provision a Notion **public integration** (OAuth client_id + client_secret).
 *
 * Portal: https://www.notion.so/profile/integrations
 *
 * Notion has two integration types:
 *   - Internal — single-workspace, returns a token (NOT OAuth)
 *   - Public   — OAuth flow, returns client_id + client_secret (what we want)
 *
 * Flow:
 *   1. Navigate to /profile/integrations
 *   2. Click "New integration"
 *   3. Select "Public integration" tab (toggle)
 *   4. Fill: name, associated workspace, capabilities, OAuth redirect URI
 *   5. Save → integration detail page renders with client_id + client_secret
 *   6. Reveal secret + scrape both values
 *
 * Auth prerequisite: user must be signed in to Notion in the Playwright context.
 * On first run with --headed --launch, sign in manually; the persistent profile
 * remembers the session for subsequent runs.
 */

export const provider = {
  name: 'notion',
  portalUrl: 'https://www.notion.so/profile/integrations',
  redirectUri: 'https://projectsites.dev/api/mcp/notion/callback',
  envKeys: {
    client_id: 'NOTION_OAUTH_CLIENT_ID',
    client_secret: 'NOTION_OAUTH_CLIENT_SECRET',
  },

  async provision(page, { redirectUri }) {
    // Notion sometimes redirects to login. Wait for whichever URL settles.
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login/.test(page.url())) {
      console.log('  ! Sign in to Notion in the browser window, then resume.');
      await page.waitForURL(/integrations|my-integrations/, { timeout: 5 * 60_000 });
    }

    // "New integration" CTA
    await page.getByRole('button', { name: /new integration/i }).first().click();

    // Switch to Public integration tab when present
    const publicTab = page.getByRole('tab', { name: /public/i }).first();
    if (await publicTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await publicTab.click();
    }

    // Fill name
    await page.getByLabel(/integration name|name/i).first().fill('Project Sites');

    // Associated workspace — accept default (first option). If a combobox appears, choose first.
    const wsCombo = page.getByLabel(/workspace/i).first();
    if (await wsCombo.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await wsCombo.click();
      await page.getByRole('option').first().click().catch(() => {});
    }

    // Redirect URI
    const redirectInput = page.getByLabel(/redirect uri|callback url/i).first();
    await redirectInput.fill(redirectUri);

    // Submit
    await page.getByRole('button', { name: /save|submit|create/i }).first().click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});

    // Capture client_id (always visible)
    const clientId = await page
      .getByLabel(/oauth client id|client id/i)
      .first()
      .inputValue();

    // Reveal + capture secret
    await page.getByRole('button', { name: /show|reveal/i }).first().click().catch(() => {});
    const clientSecret = await page
      .getByLabel(/oauth client secret|client secret/i)
      .first()
      .inputValue();

    return { client_id: clientId.trim(), client_secret: clientSecret.trim() };
  },
};
