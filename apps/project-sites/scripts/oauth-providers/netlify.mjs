/**
 * @file scripts/oauth-providers/netlify.mjs
 * @brief Provision a Netlify OAuth application via Netlify's REST API.
 *
 * This is the only Tier-2 (API-based) module — no browser required.
 * Requires NETLIFY_AUTH_TOKEN (personal access token) in chezmoi.
 * Generate one at https://app.netlify.com/user/applications#personal-access-tokens
 * and store via: echo "VALUE" | chezmoi encrypt > ~/.local/share/chezmoi/home/.chezmoitemplates/secrets-$(hostname -s)/NETLIFY_AUTH_TOKEN
 *
 * Endpoint: POST https://api.netlify.com/api/v1/oauth/applications
 *
 * Returns: { id, secret, name, redirect_uri, ... }  — `id` is the client_id, `secret` is the client_secret.
 *
 * The framework only calls `provision(page, opts)` and expects a Playwright Page.
 * We accept it for signature compatibility but never navigate — we make HTTP calls instead.
 */

import { tryGetSecret } from '../lib/secrets.mjs';

export const provider = {
  name: 'netlify',
  apiOnly: true,
  portalUrl: 'https://api.netlify.com/api/v1/oauth/applications',
  redirectUri: 'https://projectsites.dev/api/mcp/netlify/callback',
  envKeys: {
    client_id: 'NETLIFY_OAUTH_CLIENT_ID',
    client_secret: 'NETLIFY_OAUTH_CLIENT_SECRET',
  },

  async provision(_page, { redirectUri }) {
    const token = tryGetSecret('NETLIFY_AUTH_TOKEN');
    if (!token) {
      throw new Error(
        'NETLIFY_AUTH_TOKEN not in chezmoi. Generate one at ' +
          'https://app.netlify.com/user/applications#personal-access-tokens',
      );
    }

    // Idempotency check — does an app with our name already exist?
    const list = await fetch('https://api.netlify.com/api/v1/oauth/applications', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (list.ok) {
      const apps = await list.json();
      const existing = apps.find((a) => a.name === 'Project Sites' && a.redirect_uri === redirectUri);
      if (existing?.id && existing?.secret) {
        return { client_id: existing.id, client_secret: existing.secret };
      }
    }

    const create = await fetch('https://api.netlify.com/api/v1/oauth/applications', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Sites', redirect_uri: redirectUri }),
    });
    if (!create.ok) {
      throw new Error(`Netlify API ${create.status}: ${await create.text()}`);
    }
    const app = await create.json();
    if (!app.id || !app.secret) {
      throw new Error(`Netlify response missing id/secret: ${JSON.stringify(app)}`);
    }
    return { client_id: app.id, client_secret: app.secret };
  },
};
