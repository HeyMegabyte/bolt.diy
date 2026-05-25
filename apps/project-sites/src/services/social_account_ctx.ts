/**
 * @module services/social_account_ctx
 * @description Helpers to load + decrypt social_accounts rows into
 * `SocialAccountCtx` and persist refreshed tokens back. Wraps ai_crypto so
 * publishers stay decoupled from D1 details.
 */
import type { Env } from '../types/env.js';
import { decrypt, encrypt } from './ai_crypto.js';
import { dbQuery, dbQueryOne, dbUpdate } from './db.js';
import type { Platform, SocialAccountCtx } from './social_publishers/index.js';

interface SocialAccountRow {
  id: string;
  org_id: string;
  platform: string;
  external_id: string | null;
  handle: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  metadata_json: string | null;
  status: string;
}

export async function loadAccount(env: Env, id: string): Promise<SocialAccountCtx | null> {
  const row = await dbQueryOne<SocialAccountRow>(
    env.DB,
    `SELECT id, org_id, platform, external_id, handle, access_token_encrypted,
            refresh_token_encrypted, token_expires_at, scopes, metadata_json, status
       FROM social_accounts WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row || !row.access_token_encrypted) return null;
  return buildCtx(env, row);
}

export async function loadAccountsByIds(env: Env, ids: readonly string[]): Promise<SocialAccountCtx[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { data } = await dbQuery<SocialAccountRow>(
    env.DB,
    `SELECT id, org_id, platform, external_id, handle, access_token_encrypted,
            refresh_token_encrypted, token_expires_at, scopes, metadata_json, status
       FROM social_accounts
      WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    [...ids],
  );
  const out: SocialAccountCtx[] = [];
  for (const row of data) {
    if (!row.access_token_encrypted) continue;
    out.push(await buildCtx(env, row));
  }
  return out;
}

async function buildCtx(env: Env, row: SocialAccountRow): Promise<SocialAccountCtx> {
  const access_token = await decrypt(env, row.access_token_encrypted!);
  const refresh_token = row.refresh_token_encrypted ? await decrypt(env, row.refresh_token_encrypted) : null;
  const metadata = row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {};
  const accountId = row.id;
  return {
    id: row.id,
    org_id: row.org_id,
    platform: row.platform as Platform,
    external_id: row.external_id,
    handle: row.handle,
    access_token,
    refresh_token,
    token_expires_at: row.token_expires_at,
    scopes: row.scopes,
    metadata,
    onTokenRefresh: async (next) => {
      const updates: Record<string, unknown> = {
        access_token_encrypted: await encrypt(env, next.access_token),
        token_expires_at: next.expires_at ?? null,
      };
      if (next.refresh_token) {
        updates.refresh_token_encrypted = await encrypt(env, next.refresh_token);
      }
      await dbUpdate(env.DB, 'social_accounts', updates, 'id = ?', [accountId]);
    },
  };
}

/** Mark account as error (e.g. invalid token) with a human-readable reason. */
export async function markAccountError(env: Env, accountId: string, reason: string): Promise<void> {
  await dbUpdate(env.DB, 'social_accounts', { status: 'error', last_error: reason.slice(0, 500) }, 'id = ?', [accountId]);
}
