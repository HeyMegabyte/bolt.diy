/**
 * @module libs/features/stripe_marketplace/service
 * @description Service for the Stripe App Marketplace listing (idea #36).
 *
 * Persists install rows after a successful OAuth exchange. The refresh
 * token is encrypted via the existing `encrypt()` helper which uses
 * `MCP_ENCRYPTION_KEY` (Tier 1.5 data-at-rest secret).
 *
 * @packageDocumentation
 */

import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../../../src/services/db.js';
import { encrypt } from '../../../src/services/ai_crypto.js';
import type { Env } from '../../../src/types/env.js';
import type {
  InstallStatus,
  StripeMarketplaceInstall,
} from './schemas.js';

interface InstallRow {
  id: string;
  org_id: string;
  stripe_account_id: string;
  installer_user_id: string | null;
  scopes_json: string | null;
  livemode: number;
  status: string;
  installed_at: string;
  uninstalled_at: string | null;
}

function rowToInstall(row: InstallRow): StripeMarketplaceInstall {
  return {
    id: row.id,
    org_id: row.org_id,
    stripe_account_id: row.stripe_account_id,
    installer_user_id: row.installer_user_id,
    scopes: row.scopes_json ? (JSON.parse(row.scopes_json) as string[]) : [],
    livemode: row.livemode === 1,
    status: row.status as InstallStatus,
    installed_at: row.installed_at,
    uninstalled_at: row.uninstalled_at,
  };
}

/**
 * Persist a freshly-completed OAuth install. Idempotent on
 * `stripe_account_id` — if a row exists, we update it to `active` and
 * re-encrypt the new refresh token.
 */
export async function recordInstall(
  env: Env,
  args: {
    orgId: string;
    installerUserId: string | null;
    stripeAccountId: string;
    refreshToken: string;
    scopes: string[];
    livemode: boolean;
  },
): Promise<StripeMarketplaceInstall> {
  const cipherBlob = await encrypt(env, args.refreshToken);
  // The encrypt() helper packs iv + ciphertext into one base64 blob. We
  // still set `refresh_token_iv` to the empty string so the column is
  // non-null in environments that have it constrained.
  const now = new Date().toISOString();
  const existing = await dbQueryOne<InstallRow>(
    env.DB,
    `SELECT id, org_id, stripe_account_id, installer_user_id, scopes_json,
            livemode, status, installed_at, uninstalled_at
       FROM stripe_marketplace_installs
       WHERE stripe_account_id = ?
       LIMIT 1`,
    [args.stripeAccountId],
  );
  if (existing) {
    await dbUpdate(
      env.DB,
      'stripe_marketplace_installs',
      {
        org_id: args.orgId,
        installer_user_id: args.installerUserId,
        scopes_json: JSON.stringify(args.scopes),
        refresh_token_encrypted: cipherBlob,
        refresh_token_iv: '',
        livemode: args.livemode ? 1 : 0,
        status: 'active',
        installed_at: now,
        uninstalled_at: null,
      },
      'id = ?',
      [existing.id],
    );
    const refreshed = await getInstallByStripeAccount(env, args.stripeAccountId);
    if (!refreshed) throw new Error('refresh after upsert failed');
    return refreshed;
  }

  const id = crypto.randomUUID();
  const { error } = await dbInsert(env.DB, 'stripe_marketplace_installs', {
    id,
    org_id: args.orgId,
    stripe_account_id: args.stripeAccountId,
    installer_user_id: args.installerUserId,
    scopes_json: JSON.stringify(args.scopes),
    refresh_token_encrypted: cipherBlob,
    refresh_token_iv: '',
    livemode: args.livemode ? 1 : 0,
    status: 'active',
    installed_at: now,
  });
  if (error) throw new Error(`Failed to record install: ${error}`);
  const created = await getInstallByStripeAccount(env, args.stripeAccountId);
  if (!created) throw new Error('install row disappeared');
  return created;
}

export async function getInstallByStripeAccount(
  env: Env,
  stripeAccountId: string,
): Promise<StripeMarketplaceInstall | null> {
  const row = await dbQueryOne<InstallRow>(
    env.DB,
    `SELECT id, org_id, stripe_account_id, installer_user_id, scopes_json,
            livemode, status, installed_at, uninstalled_at
       FROM stripe_marketplace_installs
       WHERE stripe_account_id = ?
       LIMIT 1`,
    [stripeAccountId],
  );
  return row ? rowToInstall(row) : null;
}

export async function listInstallsForOrg(
  env: Env,
  orgId: string,
): Promise<StripeMarketplaceInstall[]> {
  const result = await dbQuery<InstallRow>(
    env.DB,
    `SELECT id, org_id, stripe_account_id, installer_user_id, scopes_json,
            livemode, status, installed_at, uninstalled_at
       FROM stripe_marketplace_installs
       WHERE org_id = ?
       ORDER BY installed_at DESC
       LIMIT 100`,
    [orgId],
  );
  return result.data.map(rowToInstall);
}

/**
 * Mark an install as uninstalled. Called from Stripe's
 * `account.application.deauthorized` webhook.
 */
export async function markUninstalled(
  env: Env,
  stripeAccountId: string,
): Promise<{ ok: true; updated: boolean }> {
  const existing = await getInstallByStripeAccount(env, stripeAccountId);
  if (!existing) return { ok: true, updated: false };
  if (existing.status === 'uninstalled') return { ok: true, updated: false };
  await dbUpdate(
    env.DB,
    'stripe_marketplace_installs',
    {
      status: 'uninstalled',
      uninstalled_at: new Date().toISOString(),
    },
    'id = ?',
    [existing.id],
  );
  return { ok: true, updated: true };
}
