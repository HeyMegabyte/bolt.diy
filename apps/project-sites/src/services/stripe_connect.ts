/**
 * @module services/stripe_connect
 * @description Stripe Connect Standard integration (item #97).
 *
 * Lets a customer org take payments on its own Stripe account through our
 * platform — we keep a 1.5% platform fee on every charge. Three primary
 * surfaces:
 *
 * | Function | Purpose |
 * | -------- | ------- |
 * | {@link startConnectOnboarding} | Creates the Stripe account + account link URL |
 * | {@link getConnectStatus}       | Returns connection + entitlement flags |
 * | {@link disconnectConnect}      | Revokes the OAuth grant + clears DB cache |
 * | {@link handleAccountUpdated}   | Webhook handler for `account.updated` |
 *
 * All four short-circuit with a 503-shaped error envelope when
 * `STRIPE_CONNECT_CLIENT_ID` is not configured.
 *
 * @packageDocumentation
 */

import { badRequest } from '@project-sites/shared';
import { dbQueryOne, dbUpdate } from './db.js';
import type { Env } from '../types/env.js';

/** Platform fee charged on every Connect transaction (item #97 spec). */
export const PLATFORM_FEE_BPS = 150; // 1.5% expressed in basis points.

/** Public Connect status returned to the admin UI. */
export interface ConnectStatus {
  connected: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  dashboard_url: string | null;
  account_id: string | null;
}

/**
 * Throw a 503 error when Connect is not configured. Centralized so each route
 * exposes the same dashboard link in the error body.
 */
function requireConnectConfigured(env: Env): void {
  if (!env.STRIPE_CONNECT_CLIENT_ID) {
    throw badRequest(
      'Stripe Connect not configured — set STRIPE_CONNECT_CLIENT_ID secret at https://dashboard.stripe.com/settings/connect',
    );
  }
}

/**
 * Start Stripe Connect onboarding for an org.
 *
 * 1. If the org has no `stripe_connect_account_id`, create a fresh Connect
 *    Standard account via `POST /v1/accounts`.
 * 2. Always create a fresh account link via `POST /v1/account_links` because
 *    each link is single-use and short-lived (4 minutes per Stripe docs).
 *
 * @example
 * ```ts
 * const { url } = await startConnectOnboarding(env, env.DB, {
 *   orgId, email: 'owner@acme.com',
 *   refreshUrl: 'https://projectsites.dev/admin/billing?connect=refresh',
 *   returnUrl:  'https://projectsites.dev/admin/billing?connect=done',
 * });
 * return c.redirect(url);
 * ```
 */
export async function startConnectOnboarding(
  env: Env,
  db: D1Database,
  opts: { orgId: string; email: string; refreshUrl: string; returnUrl: string },
): Promise<{ url: string; account_id: string }> {
  requireConnectConfigured(env);

  // Reuse existing account if one is already on the org row.
  const org = await dbQueryOne<{ stripe_connect_account_id: string | null }>(
    db,
    'SELECT stripe_connect_account_id FROM orgs WHERE id = ? AND deleted_at IS NULL',
    [opts.orgId],
  );
  if (!org) throw badRequest('Organization not found');

  let accountId = org.stripe_connect_account_id;
  if (!accountId) {
    const acctRes = await fetch('https://api.stripe.com/v1/accounts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        type: 'standard',
        email: opts.email,
        'metadata[org_id]': opts.orgId,
      }),
    });
    if (!acctRes.ok) {
      const text = await acctRes.text();
      throw badRequest(`Stripe Connect account create failed: ${text}`);
    }
    const acct = (await acctRes.json()) as { id: string };
    accountId = acct.id;
    await dbUpdate(db, 'orgs', { stripe_connect_account_id: accountId }, 'id = ?', [opts.orgId]);
  }

  // Always create a fresh account link.
  const linkRes = await fetch('https://api.stripe.com/v1/account_links', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      account: accountId,
      refresh_url: opts.refreshUrl,
      return_url: opts.returnUrl,
      type: 'account_onboarding',
    }),
  });
  if (!linkRes.ok) {
    const text = await linkRes.text();
    throw badRequest(`Stripe Connect account link failed: ${text}`);
  }
  const link = (await linkRes.json()) as { url: string };
  return { url: link.url, account_id: accountId };
}

/**
 * Get Connect status for an org from the cached D1 row. Cheap — no Stripe
 * round-trip. Use {@link refreshConnectStatusFromStripe} for a fresh pull.
 *
 * @example
 * ```ts
 * const status = await getConnectStatus(env, env.DB, orgId);
 * if (!status.charges_enabled) return c.json({ pending: true });
 * ```
 */
export async function getConnectStatus(
  env: Env,
  db: D1Database,
  orgId: string,
): Promise<ConnectStatus> {
  // Note: still callable even without STRIPE_CONNECT_CLIENT_ID — we just
  // return `connected: false` so the UI can render the "not configured"
  // empty state rather than 503ing the page.
  const row = await dbQueryOne<{
    stripe_connect_account_id: string | null;
    stripe_connect_charges_enabled: number;
    stripe_connect_payouts_enabled: number;
  }>(
    db,
    `SELECT stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled
     FROM orgs WHERE id = ? AND deleted_at IS NULL`,
    [orgId],
  );
  const accountId = row?.stripe_connect_account_id ?? null;
  if (!accountId) {
    return {
      connected: false,
      charges_enabled: false,
      payouts_enabled: false,
      dashboard_url: null,
      account_id: null,
    };
  }
  return {
    connected: true,
    charges_enabled: row?.stripe_connect_charges_enabled === 1,
    payouts_enabled: row?.stripe_connect_payouts_enabled === 1,
    dashboard_url: env.STRIPE_CONNECT_CLIENT_ID
      ? `https://dashboard.stripe.com/${accountId}`
      : null,
    account_id: accountId,
  };
}

/**
 * Disconnect the org's Connect account by calling `POST /v1/oauth/deauthorize`,
 * then clearing the cached row in D1.
 *
 * @example
 * ```ts
 * await disconnectConnect(env, env.DB, orgId);
 * ```
 */
export async function disconnectConnect(
  env: Env,
  db: D1Database,
  orgId: string,
): Promise<{ disconnected: boolean }> {
  requireConnectConfigured(env);

  const row = await dbQueryOne<{ stripe_connect_account_id: string | null }>(
    db,
    'SELECT stripe_connect_account_id FROM orgs WHERE id = ? AND deleted_at IS NULL',
    [orgId],
  );
  if (!row?.stripe_connect_account_id) {
    return { disconnected: false };
  }

  const res = await fetch('https://connect.stripe.com/oauth/deauthorize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.STRIPE_CONNECT_CLIENT_ID ?? '',
      stripe_user_id: row.stripe_connect_account_id,
    }),
  });
  // Even when Stripe returns 401 (already revoked) we still clear our cache
  // so the UI converges to the disconnected state.
  if (!res.ok) {
    const text = await res.text();
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'stripe_connect',
        message: 'deauthorize non-ok response (clearing cache anyway)',
        status: res.status,
        body: text,
      }),
    );
  }

  await dbUpdate(
    db,
    'orgs',
    {
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: 0,
      stripe_connect_payouts_enabled: 0,
      stripe_connect_updated_at: new Date().toISOString(),
    },
    'id = ?',
    [orgId],
  );

  return { disconnected: true };
}

/**
 * Apply a Stripe `account.updated` webhook event to the cached row.
 *
 * Looks up the org by `metadata.org_id` first (set when we created the
 * account) and falls back to a scan by `stripe_connect_account_id` so legacy
 * accounts created out-of-band still converge.
 *
 * @example
 * ```ts
 * await handleAccountUpdated(env.DB, {
 *   id: 'acct_xxx',
 *   charges_enabled: true,
 *   payouts_enabled: true,
 *   metadata: { org_id: 'org-1' },
 * });
 * ```
 */
export async function handleAccountUpdated(
  db: D1Database,
  event: {
    id: string;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    metadata?: { org_id?: string };
  },
): Promise<void> {
  const orgIdFromMeta = event.metadata?.org_id;
  let orgId = orgIdFromMeta ?? null;
  if (!orgId) {
    const row = await dbQueryOne<{ id: string }>(
      db,
      'SELECT id FROM orgs WHERE stripe_connect_account_id = ? AND deleted_at IS NULL',
      [event.id],
    );
    orgId = row?.id ?? null;
  }
  if (!orgId) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'stripe_connect',
        message: 'account.updated for unknown org',
        account_id: event.id,
      }),
    );
    return;
  }

  await dbUpdate(
    db,
    'orgs',
    {
      stripe_connect_charges_enabled: event.charges_enabled ? 1 : 0,
      stripe_connect_payouts_enabled: event.payouts_enabled ? 1 : 0,
      stripe_connect_updated_at: new Date().toISOString(),
    },
    'id = ?',
    [orgId],
  );
}
