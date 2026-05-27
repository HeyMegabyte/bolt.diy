/**
 * @file scripts/oauth-providers/stripe.mjs
 * @brief Provision Stripe Connect platform credentials (STRIPE_CONNECT_CLIENT_ID).
 *
 * Portal: https://dashboard.stripe.com/settings/connect/onboarding-options/oauth
 *
 * Stripe Connect uses a single platform-level Client ID (no client_secret —
 * the platform's STRIPE_SECRET_KEY plays that role at token exchange time).
 *
 * Per ~/.claude/.../rules/payments-routing.md: Stripe Connect is the PAYOUTS
 * rail (vendor/contractor reimbursement), Square is the accept-money default.
 * Only provision this when payouts are in scope.
 *
 * Flow:
 *   1. Navigate to /settings/connect/onboarding-options/oauth
 *   2. If Connect not enabled yet → click "Get started with Connect"
 *   3. Add redirect URI under "Redirects" → Save
 *   4. The platform's Client ID is shown at the top of the page
 *
 * The mcp_oauth.ts contract is `STRIPE_CONNECT_CLIENT_ID` (single key).
 * We store an empty secret value to satisfy the framework contract and
 * mirror Stripe's API.
 */

export const provider = {
  name: 'stripe',
  portalUrl: 'https://dashboard.stripe.com/settings/connect/onboarding-options/oauth',
  redirectUri: 'https://projectsites.dev/api/mcp/stripe/callback',
  envKeys: {
    client_id: 'STRIPE_CONNECT_CLIENT_ID',
    client_secret: 'STRIPE_CONNECT_CLIENT_SECRET', // unused — Stripe uses SECRET_KEY
  },

  async provision(page, { redirectUri }) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    if (/\/login/.test(page.url())) {
      console.log('  ! Sign in to Stripe in the browser window, then resume.');
      await page.waitForURL(/dashboard\.stripe\.com/, { timeout: 5 * 60_000 });
    }

    // Enable Connect if needed
    const getStartedBtn = page.getByRole('button', { name: /get started|enable connect/i }).first();
    if (await getStartedBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await getStartedBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // Add redirect URI
    await page.getByRole('button', { name: /add redirect|add uri/i }).first().click().catch(() => {});
    await page.getByLabel(/redirect uri|url/i).first().fill(redirectUri).catch(() => {});
    await page.getByRole('button', { name: /^save|^add/i }).first().click().catch(() => {});

    // Scrape platform client_id (`ca_...`)
    const clientId = (await page.getByText(/^ca_[A-Za-z0-9]+/).first().textContent())?.trim() ?? '';
    if (!clientId) throw new Error('Stripe: could not scrape platform client_id (`ca_…`).');

    // No secret — Stripe Connect uses STRIPE_SECRET_KEY at token exchange.
    // Store a sentinel so the framework's contract is satisfied. The Worker
    // adapter at services/mcp_client.ts already knows to use STRIPE_SECRET_KEY.
    return { client_id: clientId, client_secret: 'USE_STRIPE_SECRET_KEY' };
  },
};
