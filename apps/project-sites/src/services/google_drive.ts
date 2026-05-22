/**
 * @module services/google_drive
 *
 * Google Drive read-only integration for per-site AI Chat context. Handles
 * OAuth URL generation, code-for-tokens exchange, folder listing, file
 * download, and idempotent folder sync. Tokens are encrypted at rest via
 * {@link ai_crypto.encrypt}.
 */
import type { Env } from '../types/env.js';
import { encrypt, decrypt } from './ai_crypto.js';

/** Google OAuth scope for read-only Drive access. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Result shape from Google's token exchange / refresh endpoints. */
export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

/** Public folder shape returned by /drive/folders. */
export interface DriveFolder {
  id: string;
  name: string;
  modified_time: string;
}

/** Drive file shape used during sync. */
export interface DriveFile {
  id: string;
  name: string;
  mime_type: string;
  modified_time: string;
  size: number;
}

/**
 * Build the Google OAuth consent URL for a per-site Drive connection.
 *
 * @param env         - Worker env (provides GOOGLE_CLIENT_ID).
 * @param state       - Opaque CSRF state stored in the DB.
 * @param redirectUri - Absolute callback URL (must match Google console).
 * @returns Fully-qualified consent URL.
 */
export function buildAuthUrl(env: Env, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 *
 * @param env         - Worker env.
 * @param code        - Auth code returned to the callback.
 * @param redirectUri - Same redirect_uri as used in {@link buildAuthUrl}.
 * @returns The token response from Google.
 * @throws Error if the exchange fails or returns a non-200.
 */
export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`google_token_exchange_failed: ${res.status} ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Refresh an expired access token using a stored refresh token.
 *
 * @param env          - Worker env.
 * @param refreshToken - Previously-issued refresh token.
 * @returns Fresh access token (refresh_token is usually omitted by Google).
 */
export async function refreshAccessToken(
  env: Env,
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`google_token_refresh_failed: ${res.status}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Encrypt+persist Drive tokens onto the ai_site_settings row.
 *
 * @param env       - Worker env (for encryption key).
 * @param db        - D1 binding.
 * @param siteId    - Site ID.
 * @param tokens    - Token bundle from Google.
 */
export async function persistTokens(
  env: Env,
  db: D1Database,
  siteId: string,
  tokens: GoogleTokenResponse,
): Promise<void> {
  const accessEnc = await encrypt(env, tokens.access_token);
  const refreshEnc = tokens.refresh_token ? await encrypt(env, tokens.refresh_token) : null;
  const existing = await db
    .prepare(`SELECT 1 FROM ai_site_settings WHERE site_id = ?`)
    .bind(siteId)
    .first();
  if (existing) {
    if (refreshEnc) {
      await db
        .prepare(
          `UPDATE ai_site_settings SET drive_access_token_enc = ?, drive_refresh_token_enc = ?, updated_at = datetime('now') WHERE site_id = ?`,
        )
        .bind(accessEnc, refreshEnc, siteId)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE ai_site_settings SET drive_access_token_enc = ?, updated_at = datetime('now') WHERE site_id = ?`,
        )
        .bind(accessEnc, siteId)
        .run();
    }
  } else {
    await db
      .prepare(
        `INSERT INTO ai_site_settings (site_id, drive_access_token_enc, drive_refresh_token_enc) VALUES (?, ?, ?)`,
      )
      .bind(siteId, accessEnc, refreshEnc)
      .run();
  }
}

/**
 * Load and decrypt the access token (refreshing if necessary) for a site.
 *
 * @param env    - Worker env.
 * @param db     - D1 binding.
 * @param siteId - Site ID.
 * @returns Plaintext access token, or null when no connection exists.
 */
export async function getAccessToken(
  env: Env,
  db: D1Database,
  siteId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT drive_access_token_enc, drive_refresh_token_enc FROM ai_site_settings WHERE site_id = ?`,
    )
    .bind(siteId)
    .first<{ drive_access_token_enc: string | null; drive_refresh_token_enc: string | null }>();
  if (!row || !row.drive_access_token_enc) return null;
  try {
    return await decrypt(env, row.drive_access_token_enc);
  } catch {
    if (!row.drive_refresh_token_enc) return null;
    const refresh = await decrypt(env, row.drive_refresh_token_enc);
    const fresh = await refreshAccessToken(env, refresh);
    await persistTokens(env, db, siteId, fresh);
    return fresh.access_token;
  }
}

/**
 * List folders the user has access to. Optional `query` is matched against
 * the folder name.
 *
 * @param accessToken - Plaintext Drive access token.
 * @param query       - Optional substring filter.
 * @returns Up to 100 folders ordered by recent modification.
 */
export async function listFolders(
  accessToken: string,
  query: string | undefined,
): Promise<DriveFolder[]> {
  const q = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `trashed = false`,
    query ? `name contains '${query.replace(/'/g, "\\'")}'` : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const params = new URLSearchParams({
    q,
    pageSize: '100',
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`drive_list_folders_failed: ${res.status}`);
  const j = (await res.json()) as {
    files: Array<{ id: string; name: string; modifiedTime: string }>;
  };
  return j.files.map((f) => ({ id: f.id, name: f.name, modified_time: f.modifiedTime }));
}

/**
 * List the files inside a folder (non-recursive). Filters to PDF and image
 * MIME types so non-extractable types (Google Docs native, video, etc.)
 * don't pollute the context store.
 *
 * @param accessToken - Plaintext Drive access token.
 * @param folderId    - Drive folder ID to enumerate.
 * @returns Files eligible for context ingest.
 */
export async function listFolderFiles(
  accessToken: string,
  folderId: string,
): Promise<DriveFile[]> {
  const q = [
    `'${folderId}' in parents`,
    `trashed = false`,
    `(mimeType = 'application/pdf' or mimeType contains 'image/')`,
  ].join(' and ');
  const params = new URLSearchParams({
    q,
    pageSize: '200',
    fields: 'files(id,name,mimeType,modifiedTime,size)',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`drive_list_files_failed: ${res.status}`);
  const j = (await res.json()) as {
    files: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime: string;
      size?: string;
    }>;
  };
  return j.files.map((f) => ({
    id: f.id,
    name: f.name,
    mime_type: f.mimeType,
    modified_time: f.modifiedTime,
    size: Number(f.size ?? 0),
  }));
}

/**
 * Download a single Drive file's binary content.
 *
 * @param accessToken - Plaintext Drive access token.
 * @param fileId      - Drive file ID.
 * @returns Raw file bytes.
 * @throws Error on non-200 response.
 */
export async function downloadFile(accessToken: string, fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`drive_download_failed: ${res.status}`);
  return res.arrayBuffer();
}
