/**
 * @module routes/auth_idp
 *
 * @description
 * Login routes for the §27/§28 IdPs (ADR-0006): `GET /api/auth/logto/login` +
 * `/api/auth/logto/callback` (default), and `GET /api/auth/workos/login` +
 * `/api/auth/workos/callback` (enterprise SSO). Mirrors the magic-link/Google
 * session handoff: IdP callback → `findOrCreateUser` → `createSession` → 302 to
 * the homepage with the session token.
 *
 * Ships dark: when `getIdentityProvider(env)` returns null (no `LOGTO_*`/`WORKOS_*`)
 * these routes 404, so the custom magic-link/Google auth stays the live path.
 *
 * Security: a random `state` is stored in KV (10-min TTL) and verified+consumed on
 * the callback (CSRF / one-time use). The post-login redirect targets only the
 * app's own apex (open-redirect guard).
 *
 * @see middleware/identity.ts · services/logto_provider.ts · services/workos_provider.ts
 */
import { Hono } from 'hono';
import { DOMAINS, randomHex } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';
import { getIdentityProvider } from '../middleware/identity.js';
import * as authService from '../services/auth.js';
import * as auditService from '../services/audit.js';

export const authIdp = new Hono<{ Bindings: Env; Variables: Variables }>();

const STATE_TTL_SEC = 600;
const PROVIDERS = new Set(['logto', 'workos']);

function callbackUri(reqUrl: string, provider: string): string {
  return `${new URL(reqUrl).origin}/api/auth/${provider}/callback`;
}

/** Start an IdP login → 302 to the provider authorize URL. */
authIdp.get('/api/auth/:provider/login', async (c, next) => {
  const provider = c.req.param('provider');
  // Only Logto/WorkOS are handled here. Any other provider (e.g. google, github)
  // must fall through to its dedicated handler in the `api` router — this route's
  // `:provider` wildcard would otherwise shadow them (registered first wins in Hono).
  if (!PROVIDERS.has(provider)) return next();
  const idp = getIdentityProvider(c.env, { enterprise: provider === 'workos' });
  if (!idp) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `${provider} auth not configured` } },
      404,
    );
  }
  const state = randomHex(16);
  await c.env.CACHE_KV.put(`authstate:${state}`, provider, { expirationTtl: STATE_TTL_SEC });
  const url = await idp.createLoginUrl({
    redirectUri: callbackUri(c.req.url, provider),
    state,
    organizationId: c.req.query('org') ?? null,
  });
  return c.redirect(url);
});

/** IdP callback → verify state → exchange code → issue our D1 session. */
authIdp.get('/api/auth/:provider/callback', async (c, next) => {
  const provider = c.req.param('provider');
  // Fall through (don't 404) for non-Logto/WorkOS providers so the dedicated
  // Google/GitHub OAuth callbacks in the `api` router can handle them. This route
  // is mounted before `api`, so returning here would shadow `/api/auth/google/callback`.
  if (!PROVIDERS.has(provider)) return next();
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.redirect('/?error=missing_code');

  // Verify + consume the one-time CSRF state.
  const stored = await c.env.CACHE_KV.get(`authstate:${state}`);
  if (stored !== provider) return c.redirect('/?error=invalid_state');
  await c.env.CACHE_KV.delete(`authstate:${state}`);

  const idp = getIdentityProvider(c.env, { enterprise: provider === 'workos' });
  if (!idp) return c.redirect('/?error=provider_unconfigured');

  try {
    const ext = await idp.handleCallback({ code, redirectUri: callbackUri(c.req.url, provider) });
    const user = await authService.findOrCreateUser(c.env.DB, {
      email: ext.email ?? undefined,
      display_name: ext.name ?? undefined,
    });
    const session = await authService.createSession(c.env.DB, user.user_id, provider);

    await auditService.writeAuditLog(c.env.DB, {
      org_id: user.org_id,
      actor_id: user.user_id,
      action: 'auth.idp_login',
      message: `Signed in via ${provider} (${ext.email ?? ext.subject})`,
      target_type: 'user',
      target_id: user.user_id,
      metadata_json: {
        method: provider,
        subject: ext.subject,
        organization_id: ext.organizationId ?? null,
      },
      request_id: c.get('requestId'),
    });

    const base = `https://${DOMAINS.SITES_BASE}`;
    const params = new URLSearchParams({ token: session.token, auth_callback: provider });
    if (ext.email) params.set('email', ext.email);
    return c.redirect(`${base}/?${params.toString()}`);
  } catch {
    return c.redirect('/?error=auth_failed');
  }
});
