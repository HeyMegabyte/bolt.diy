/**
 * @file scripts/oauth-providers/posthog.mjs
 * @brief PostHog is a paste-key provider — it does NOT use OAuth client_id/secret.
 *
 * PostHog authenticates via a Personal API Key (paste-flow), not OAuth.
 * The `mcp_oauth.ts` entry for `posthog` is a placeholder; this module
 * surfaces a clear error pointing to the paste-key flow.
 *
 * To connect PostHog in Project Sites:
 *   1. Generate a Personal API Key at https://us.posthog.com/settings/user-api-keys
 *   2. Paste it into the admin UI's MCP "Connect PostHog" panel
 *      (the UI falls back to paste-key when /connect returns 501)
 */

export const provider = {
  name: 'posthog',
  portalUrl: 'https://us.posthog.com/settings/user-api-keys',
  redirectUri: 'https://projectsites.dev/api/mcp/posthog/callback',
  envKeys: {
    client_id: 'POSTHOG_OAUTH_CLIENT_ID',
    client_secret: 'POSTHOG_OAUTH_CLIENT_SECRET',
  },

  async provision(_page) {
    throw new Error(
      'PostHog uses Personal API Keys (paste-flow), not OAuth. ' +
        'Generate a key at https://us.posthog.com/settings/user-api-keys and paste it ' +
        'via the admin UI MCP panel — it will fall back to paste-key automatically.',
    );
  },
};
