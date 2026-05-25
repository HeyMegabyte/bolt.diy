/**
 * Cloudflare credential storage + resolution.
 *
 * Stores per-org `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` AES-GCM
 * encrypted in `cf_credentials`. When an org has its own credentials, the
 * analytics aggregator uses them; otherwise it falls back to the worker's
 * bundled `CF_API_TOKEN` (account-scoped to Megabyte Labs only).
 *
 * Auth precedence (highest → lowest):
 * 1. Per-org global-key from `cf_credentials` (email + API key).
 * 2. Worker-bundled `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` env vars.
 * 3. Worker-bundled `CF_API_TOKEN` (Bearer token, account-scoped).
 *
 * @see {@link ./multi_url_analytics.ts} for the consumer.
 */
import type { Env } from '../types/env.js';

import { decrypt, encrypt } from './ai_crypto.js';
import { dbExecute, dbQueryOne } from './db.js';

/** Auth strategy for a Cloudflare API call. */
export type CfAuth =
  | { readonly kind: 'global'; readonly email: string; readonly apiKey: string }
  | { readonly kind: 'token'; readonly token: string };

/** Stored credential row (decrypted shape). */
export interface CfCredentialRecord {
  readonly id: string;
  readonly org_id: string;
  readonly email: string;
  readonly api_key: string;
  readonly last_validated_at: string | null;
  readonly last_validated_account_id: string | null;
}

/**
 * Build the HTTP headers for a Cloudflare API call based on the auth strategy.
 *
 * Global-key auth uses the legacy `X-Auth-Email` + `X-Auth-Key` header pair
 * (gives access to every zone the user can see in the dashboard).
 * Token auth uses the standard `Authorization: Bearer` header.
 */
export function cfAuthHeaders(auth: CfAuth): Record<string, string> {
  if (auth.kind === 'global') {
    return {
      'X-Auth-Email': auth.email,
      'X-Auth-Key': auth.apiKey,
    };
  }
  return {
    Authorization: `Bearer ${auth.token}`,
  };
}

/**
 * Resolve the best available CF auth for an org.
 *
 * Returns `null` when no credentials are available at any tier — the caller
 * should fall back to an empty analytics envelope with a "connect
 * Cloudflare" CTA in the UI.
 */
export async function resolveCfCredentials(env: Env, orgId: string | null): Promise<CfAuth | null> {
  if (orgId) {
    const stored = await loadCfCredentials(env, orgId);
    if (stored) {
      return { apiKey: stored.api_key, email: stored.email, kind: 'global' };
    }
  }
  // Worker-bundled global key (deploy uses this; analytics inherits).
  // CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL would need to be set as worker
  // secrets via `wrangler secret put`. Optional today — we type-guard.
  const bundledEmail = (env as unknown as { CLOUDFLARE_EMAIL?: string }).CLOUDFLARE_EMAIL;
  const bundledKey = (env as unknown as { CLOUDFLARE_API_KEY?: string }).CLOUDFLARE_API_KEY;
  if (bundledEmail && bundledKey) {
    return { apiKey: bundledKey, email: bundledEmail, kind: 'global' };
  }
  if (env.CF_API_TOKEN) {
    return { kind: 'token', token: env.CF_API_TOKEN };
  }
  return null;
}

/** Load + decrypt the stored credentials for an org. Returns `null` if absent. */
export async function loadCfCredentials(env: Env, orgId: string): Promise<CfCredentialRecord | null> {
  const row = await dbQueryOne<{
    id: string;
    org_id: string;
    encrypted_blob: string;
    iv: string;
    last_validated_at: string | null;
    last_validated_account_id: string | null;
  }>(
    env.DB,
    `SELECT id, org_id, encrypted_blob, iv, last_validated_at, last_validated_account_id
     FROM cf_credentials WHERE org_id = ? AND deleted_at IS NULL`,
    [orgId],
  );
  if (!row) return null;
  try {
    const plaintext = await decrypt(env, row.encrypted_blob);
    const parsed = JSON.parse(plaintext) as { email: string; api_key: string };
    return {
      api_key: parsed.api_key,
      email: parsed.email,
      id: row.id,
      last_validated_account_id: row.last_validated_account_id,
      last_validated_at: row.last_validated_at,
      org_id: row.org_id,
    };
  } catch (err) {
    console.warn(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      level: 'warn',
      op: 'loadCfCredentials',
      org_id: orgId,
      service: 'cf_credentials',
    }));
    return null;
  }
}

/** Upsert credentials for an org (encrypts before write). */
export async function saveCfCredentials(
  env: Env,
  orgId: string,
  email: string,
  apiKey: string,
  accountId: string | null,
): Promise<void> {
  const encrypted = await encrypt(env, JSON.stringify({ api_key: apiKey, email }));
  // SQLite UPSERT via INSERT ... ON CONFLICT — `org_id` is UNIQUE.
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await dbExecute(
    env.DB,
    `INSERT INTO cf_credentials
       (id, org_id, encrypted_blob, iv, last_validated_at, last_validated_account_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET
       encrypted_blob = excluded.encrypted_blob,
       iv = excluded.iv,
       last_validated_at = excluded.last_validated_at,
       last_validated_account_id = excluded.last_validated_account_id,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
    [id, orgId, encrypted, 'inline', now, accountId, now, now],
  );
}

/** Soft-delete the stored credentials for an org. */
export async function deleteCfCredentials(env: Env, orgId: string): Promise<void> {
  await dbExecute(
    env.DB,
    `UPDATE cf_credentials SET deleted_at = ?, updated_at = ? WHERE org_id = ?`,
    [new Date().toISOString(), new Date().toISOString(), orgId],
  );
}

/**
 * Hit `GET /zones?per_page=1` to confirm the credentials are valid. Returns
 * the first account_id we see (for caching) or `null` when the call fails.
 *
 * Used by both the "Validate now" button and the implicit validation on
 * credential save.
 */
export async function validateCfCredentials(
  email: string,
  apiKey: string,
): Promise<{ ok: true; account_id: string | null } | { ok: false; status: number; message: string }> {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=1', {
      headers: cfAuthHeaders({ apiKey, email, kind: 'global' }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { message: body.slice(0, 300), ok: false, status: res.status };
    }
    const json = (await res.json()) as { result?: Array<{ account?: { id?: string } }>; success?: boolean };
    if (!json.success) {
      return { message: 'Cloudflare API returned success=false', ok: false, status: res.status };
    }
    const account_id = json.result?.[0]?.account?.id ?? null;
    return { account_id, ok: true };
  } catch (err) {
    return {
      message: err instanceof Error ? err.message : 'Network error contacting Cloudflare',
      ok: false,
      status: 0,
    };
  }
}
