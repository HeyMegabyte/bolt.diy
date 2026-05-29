/**
 * @module libs/features/stripe_marketplace/handlers
 * @description Hono routes for the Stripe App Marketplace listing (idea #36).
 *
 * | Method | Path                                            | Purpose                          |
 * | ------ | ----------------------------------------------- | -------------------------------- |
 * | GET    | /api/stripe-marketplace/manifest                | Public Stripe app manifest JSON  |
 * | GET    | /api/stripe-marketplace/oauth/callback          | OAuth code → access token        |
 * | POST   | /api/stripe-marketplace/uninstall               | Webhook: account deauthorized    |
 * | GET    | /api/stripe-marketplace/installs                | List installs for caller's org   |
 *
 * The OAuth callback exchanges `code` for an access + refresh token via
 * Stripe's `/v1/oauth/token` endpoint. The refresh token is encrypted
 * with `MCP_ENCRYPTION_KEY` and stored. Stripe access tokens are short-
 * lived; we re-mint when we need them (out of scope for this scaffold).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { OAuthCallbackQuerySchema, UninstallRequestSchema } from './schemas.js';
import {
  listInstallsForOrg,
  markUninstalled,
  recordInstall,
} from './service.js';

export const FLAG_KEY = 'stripe_marketplace';

type AppContext = { Bindings: Env; Variables: Variables };

export const stripeMarketplace = new Hono<AppContext>();

async function gate(env: Env, scope: { userId?: string; orgId?: string }) {
  return isFlagOn(env, FLAG_KEY, scope);
}

stripeMarketplace.get('/api/stripe-marketplace/manifest', async (c) => {
  // Public — Stripe fetches this to verify the listing. Still 404 when
  // the flag is off so we don't expose an unfinished app surface.
  const on = await gate(c.env, {});
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    id: 'com.projectsites.app',
    version: '0.1.0',
    name: 'projectsites',
    icon: `${baseUrl}/icons/stripe-app-icon.png`,
    permissions: [
      { permission: 'customer_read', purpose: 'Display the customer behind a published projectsites site.' },
      { permission: 'charge_read', purpose: 'Surface a quick revenue snapshot on the dashboard.' },
    ],
    app_url: `${baseUrl}/stripe-app`,
    post_install_url: `${baseUrl}/admin?stripe_installed=1`,
    distribution_type: 'public',
  });
});

stripeMarketplace.get('/api/stripe-marketplace/oauth/callback', async (c) => {
  const userId = c.get('userId');
  if (!userId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  const on = await gate(c.env, { userId, orgId: c.get('orgId') });
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

  const parsed = OAuthCallbackQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'Invalid OAuth callback',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }

  const secret = c.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Stripe credentials not configured',
        },
      },
      500,
    );
  }

  // Exchange code for token via Stripe's OAuth endpoint.
  const tokenRes = await fetch('https://connect.stripe.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_secret: secret,
      code: parsed.data.code,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return c.json(
      {
        error: {
          code: 'STRIPE_ERROR',
          message: `Stripe token exchange failed (HTTP ${tokenRes.status})`,
        },
      },
      502,
    );
  }
  const tokenJson = (await tokenRes.json()) as {
    stripe_user_id?: string;
    refresh_token?: string;
    scope?: string;
    livemode?: boolean;
  };
  if (!tokenJson.stripe_user_id || !tokenJson.refresh_token) {
    return c.json(
      {
        error: {
          code: 'STRIPE_ERROR',
          message: 'Stripe token response missing required fields',
        },
      },
      502,
    );
  }
  const install = await recordInstall(c.env, {
    orgId: (c.get('orgId') as string | undefined) ?? userId,
    installerUserId: userId,
    stripeAccountId: tokenJson.stripe_user_id,
    refreshToken: tokenJson.refresh_token,
    scopes: (tokenJson.scope ?? '').split(/[\s,]+/).filter(Boolean),
    livemode: !!tokenJson.livemode,
  });
  return c.json({ ok: true, install });
});

stripeMarketplace.post('/api/stripe-marketplace/uninstall', async (c) => {
  // Webhook — no caller auth, only the flag gate. Signature verification
  // is handled upstream by the central webhooks module before this runs.
  const on = await gate(c.env, {});
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = UninstallRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid uninstall payload' } },
      400,
    );
  }
  const result = await markUninstalled(c.env, parsed.data.stripe_account_id);
  return c.json(result);
});

stripeMarketplace.get('/api/stripe-marketplace/installs', async (c) => {
  const userId = c.get('userId');
  if (!userId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  const on = await gate(c.env, { userId, orgId: c.get('orgId') });
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const orgId = (c.get('orgId') as string | undefined) ?? userId;
  const installs = await listInstallsForOrg(c.env, orgId);
  return c.json({ installs });
});
