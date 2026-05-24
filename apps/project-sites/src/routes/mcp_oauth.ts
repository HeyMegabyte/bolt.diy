/**
 * MCP OAuth start + callback for MailChimp, Stripe, Resend, HubSpot.
 *
 *   GET  /api/mcp/:provider/connect?site_id=…&return_url=…
 *   GET  /api/mcp/:provider/callback?code=…&state=…
 *
 * After a successful exchange, we encrypt + store the access token in
 * `mcp_connections` (one row per site+provider) and redirect the user
 * back to the dashboard MCP tab.
 *
 * Resend is special — it has no OAuth, so /connect returns a JSON form
 * spec the UI uses to render a paste-key form posting to
 * /api/mcp/resend/paste.
 *
 * For OAuth-supported providers that lack a configured client_id (i.e. no
 * `{PROVIDER}_OAUTH_CLIENT_ID` worker secret), /connect returns HTTP 501
 * `{ error: 'oauth_not_configured', provider }` so the admin UI can fall
 * back to the paste-API-key flow with a friendly toast instead of opening
 * a broken popup.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { getAdapter, type Provider } from '../services/mcp_client.js';
import { encrypt } from '../services/ai_crypto.js';
import * as auditService from '../services/audit.js';

export const mcpOauth = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Map of providers → the env-keys their authorize URL needs. When ALL
 * listed keys resolve to a non-empty string, we treat OAuth as configured
 * and let the adapter build the authorize URL. Providers that connect
 * exclusively via paste-key (Resend, internal webhooks) are omitted —
 * those still take the `__paste_key__` branch below.
 *
 * Naming convention going forward: `{PROVIDER}_OAUTH_CLIENT_ID` +
 * `{PROVIDER}_OAUTH_CLIENT_SECRET`. Historical keys
 * (`MAILCHIMP_CLIENT_ID`, `HUBSPOT_CLIENT_ID`, `STRIPE_CONNECT_CLIENT_ID`)
 * are kept as aliases so existing secrets keep working.
 */
const OAUTH_CLIENT_ID_ENV: Partial<Record<Provider, readonly (keyof Env)[]>> = {
  mailchimp: ['MAILCHIMP_CLIENT_ID', 'MAILCHIMP_OAUTH_CLIENT_ID' as keyof Env],
  hubspot: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_OAUTH_CLIENT_ID' as keyof Env],
  stripe: ['STRIPE_CONNECT_CLIENT_ID', 'STRIPE_OAUTH_CLIENT_ID' as keyof Env],
  slack: ['SLACK_OAUTH_CLIENT_ID' as keyof Env],
  notion: ['NOTION_OAUTH_CLIENT_ID' as keyof Env],
  github: ['GITHUB_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_ID' as keyof Env],
  linear: ['LINEAR_OAUTH_CLIENT_ID' as keyof Env],
  discord: ['DISCORD_OAUTH_CLIENT_ID' as keyof Env],
  google_calendar: ['GOOGLE_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID' as keyof Env],
  calendly: ['CALENDLY_OAUTH_CLIENT_ID' as keyof Env],
  // Turn 5 — additional providers flipped to OAuth-first in the catalogue.
  // All use the new `{PROVIDER}_OAUTH_CLIENT_ID` naming convention; no
  // historical aliases since none of these previously had a paste-key path.
  airtable: ['AIRTABLE_OAUTH_CLIENT_ID' as keyof Env],
  zapier: ['ZAPIER_OAUTH_CLIENT_ID' as keyof Env],
  cal_com: ['CAL_COM_OAUTH_CLIENT_ID' as keyof Env, 'CALCOM_OAUTH_CLIENT_ID' as keyof Env],
  sentry: ['SENTRY_OAUTH_CLIENT_ID' as keyof Env],
  pagerduty: ['PAGERDUTY_OAUTH_CLIENT_ID' as keyof Env],
  posthog: ['POSTHOG_OAUTH_CLIENT_ID' as keyof Env],
  vercel: ['VERCEL_OAUTH_CLIENT_ID' as keyof Env],
  netlify: ['NETLIFY_OAUTH_CLIENT_ID' as keyof Env],
};

function readEnvString(env: Env, key: keyof Env): string {
  const raw = (env as unknown as Record<string, unknown>)[key as string];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * `true` when at least one of the provider's expected client_id env keys
 * resolves to a non-empty string. Returns `true` for providers that don't
 * appear in {@link OAUTH_CLIENT_ID_ENV} so paste-key adapters still work.
 */
function isOauthConfigured(env: Env, provider: Provider): boolean {
  const keys = OAUTH_CLIENT_ID_ENV[provider];
  if (!keys) return true;
  return keys.some((k) => readEnvString(env, k).length > 0);
}

mcpOauth.get('/api/mcp/:provider/connect', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) return c.json({ error: { message: 'auth required' } }, 401);
  const provider = c.req.param('provider') as Provider;
  const adapter = getAdapter(provider);
  if (!adapter) return c.json({ error: { message: 'unknown provider' } }, 404);
  const siteId = c.req.query('site_id');
  if (!siteId) return c.json({ error: { message: 'site_id required' } }, 400);
  if (!isOauthConfigured(c.env, provider)) {
    return c.json({ error: 'oauth_not_configured', provider }, 501);
  }
  const returnUrl = c.req.query('return_url') ?? '/admin/mcp';
  const state = crypto.randomUUID().replace(/-/g, '');
  const codeVerifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))))
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 64);

  await c.env.DB.prepare(
    `INSERT INTO mcp_oauth_states (state, org_id, site_id, provider, code_verifier, return_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(state, orgId, siteId, provider, codeVerifier, returnUrl)
    .run();

  const url = adapter.authorizeUrl(c.env, {
    state,
    codeVerifier,
    returnUrl: `https://projectsites.dev${returnUrl}`,
  });
  if (url.startsWith('__paste_key__')) {
    // Provider has no OAuth — return paste-key spec.
    return c.json({
      data: {
        mode: 'paste_key',
        provider,
        state,
        post_to: `/api/mcp/${provider}/paste?state=${state}`,
        instructions:
          provider === 'resend'
            ? 'Paste your Resend API key (starts with re_). Find it at https://resend.com/api-keys.'
            : 'Paste the API key.',
      },
    });
  }
  return Response.redirect(url, 302);
});

mcpOauth.get('/api/mcp/:provider/callback', async (c) => {
  const provider = c.req.param('provider') as Provider;
  const adapter = getAdapter(provider);
  if (!adapter) return c.json({ error: { message: 'unknown provider' } }, 404);
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.json({ error: { message: 'code + state required' } }, 400);

  const stateRow = await c.env.DB.prepare(
    `SELECT org_id, site_id, code_verifier, return_url FROM mcp_oauth_states WHERE state = ?`,
  )
    .bind(state)
    .first<{ org_id: string; site_id: string; code_verifier: string; return_url: string }>();
  if (!stateRow) return c.json({ error: { message: 'invalid state' } }, 400);

  let exchange;
  try {
    exchange = await adapter.exchangeCode(c.env, {
      code,
      codeVerifier: stateRow.code_verifier,
      redirectUri: `https://projectsites.dev/api/mcp/${provider}/callback`,
    });
  } catch (err) {
    return c.json({ error: { message: err instanceof Error ? err.message : 'exchange failed' } }, 502);
  }
  const enc = await encrypt(c.env, exchange.access_token);
  const encRefresh = exchange.refresh_token ? await encrypt(c.env, exchange.refresh_token) : null;
  const expiresAt = exchange.expires_in
    ? new Date(Date.now() + exchange.expires_in * 1000).toISOString()
    : null;
  const id = crypto.randomUUID();
  // Upsert by (site_id, provider).
  await c.env.DB.prepare(
    `INSERT INTO mcp_connections (id, org_id, site_id, provider, display_name,
       access_token_encrypted, refresh_token_encrypted, token_expires_at, account_metadata_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
     ON CONFLICT(site_id, provider) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = excluded.refresh_token_encrypted,
       token_expires_at = excluded.token_expires_at,
       account_metadata_json = excluded.account_metadata_json,
       status = 'active',
       updated_at = datetime('now')`,
  )
    .bind(
      id,
      stateRow.org_id,
      stateRow.site_id,
      provider,
      `${provider} connection`,
      enc,
      encRefresh,
      expiresAt,
      exchange.metadata ? JSON.stringify(exchange.metadata) : null,
    )
    .run();
  await c.env.DB.prepare(`DELETE FROM mcp_oauth_states WHERE state = ?`).bind(state).run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: stateRow.org_id,
      actor_id: null,
      action: 'mcp.connected',
      message: `MCP '${provider}' connected via OAuth to site '${stateRow.site_id}'`,
      target_type: 'mcp_connection',
      target_id: stateRow.site_id,
      metadata_json: { provider, site_id: stateRow.site_id, flow: 'oauth' },
      request_id: c.get('requestId'),
    }),
  );

  return Response.redirect(`https://projectsites.dev${stateRow.return_url}?connected=${provider}`, 302);
});

// Paste-key flow for providers with no OAuth (Resend).
mcpOauth.post('/api/mcp/:provider/paste', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  if (!orgId) return c.json({ error: { message: 'auth required' } }, 401);
  const provider = c.req.param('provider') as Provider;
  const state = c.req.query('state');
  const { api_key } = (await c.req.json()) as { api_key: string };
  if (!api_key) return c.json({ error: { message: 'api_key required' } }, 400);
  const stateRow = state
    ? await c.env.DB.prepare(
        `SELECT site_id FROM mcp_oauth_states WHERE state = ? AND org_id = ?`,
      )
        .bind(state, orgId)
        .first<{ site_id: string }>()
    : null;
  const siteId = stateRow?.site_id ?? (c.req.query('site_id') as string | undefined);
  if (!siteId) return c.json({ error: { message: 'site_id required' } }, 400);
  const enc = await encrypt(c.env, api_key);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO mcp_connections (id, org_id, site_id, provider, display_name,
       access_token_encrypted, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')
     ON CONFLICT(site_id, provider) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       status = 'active',
       updated_at = datetime('now')`,
  )
    .bind(id, orgId, siteId, provider, `${provider} (pasted key)`, enc)
    .run();
  if (state) await c.env.DB.prepare(`DELETE FROM mcp_oauth_states WHERE state = ?`).bind(state).run();

  c.executionCtx.waitUntil(
    auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'mcp.connected',
      message: `MCP '${provider}' connected via pasted API key to site '${siteId}'`,
      target_type: 'mcp_connection',
      target_id: siteId,
      metadata_json: { provider, site_id: siteId, flow: 'paste_key' },
      request_id: c.get('requestId'),
    }),
  );

  return c.json({ data: { connected: true } });
});
