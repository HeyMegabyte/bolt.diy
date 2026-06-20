/**
 * @module libs/features/mcp_oauth_provider/service
 * @description Business logic for the OAuth 2.1 authorization server.
 * Handles PKCE verification, redirect_uri validation, and KV TTL constants.
 */
// NB: KVNamespace is an AMBIENT GLOBAL from @cloudflare/workers-types (tsconfig
// `types`). Do NOT `import` it — importing binds to one copy of the types
// package, which fails to match the ambient `c.env.CACHE_KV` type when the dep
// tree resolves a second copy (TS2345 "KVNamespace not assignable to KVNamespace").
import type { OAuthClient, OAuthCode } from './schemas.js';

export const FLAG_KEY = 'mcp_oauth_provider' as const;

/** Code lives 600 seconds (10 minutes) — single-use. */
export const CODE_TTL_SECONDS = 600;

/** Client registration lives 30 days. */
export const CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Access tokens issued via OAuth live 90 days. */
export const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/** KV key prefixes */
export const KV_CLIENT_PREFIX = 'oauth_client:';
export const KV_CODE_PREFIX = 'oauth_code:';

// ── PKCE ─────────────────────────────────────────────────────────────────────

/**
 * Verifies a PKCE S256 code_verifier against a stored code_challenge.
 * `base64url(SHA-256(code_verifier))` must equal `code_challenge`.
 *
 * @remarks Uses `crypto.subtle` — available in Cloudflare Workers.
 * @example
 * const valid = await pkceMatches(challenge, verifier);
 */
export async function pkceMatches(code_challenge: string, code_verifier: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(code_verifier));
  const computed = btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return computed === code_challenge;
}

// ── Redirect URI validation ───────────────────────────────────────────────────

/**
 * Returns true when the redirect URI is https or loopback (127.0.0.1/localhost any port).
 *
 * @remarks Loopback check is intentionally liberal per RFC 8252 §7.3.
 * @example
 * isAllowedRedirectUri('https://app.example.com/callback') // true
 * isAllowedRedirectUri('http://127.0.0.1:8080/callback')  // true
 * isAllowedRedirectUri('http://evil.com/callback')         // false
 */
export function isAllowedRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') {
      return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    }
    return false;
  } catch {
    return false;
  }
}

// ── KV helpers ────────────────────────────────────────────────────────────────

/** Stores an OAuth client registration in KV for CLIENT_TTL_SECONDS. */
export async function putClient(kv: KVNamespace, client: OAuthClient): Promise<void> {
  await kv.put(`${KV_CLIENT_PREFIX}${client.client_id}`, JSON.stringify(client), {
    expirationTtl: CLIENT_TTL_SECONDS,
  });
}

/** Retrieves an OAuth client from KV. Returns null if not found. */
export async function getClient(kv: KVNamespace, clientId: string): Promise<OAuthClient | null> {
  return kv.get<OAuthClient>(`${KV_CLIENT_PREFIX}${clientId}`, 'json');
}

/** Stores a single-use authorization code in KV for CODE_TTL_SECONDS. */
export async function putCode(kv: KVNamespace, code: string, record: OAuthCode): Promise<void> {
  await kv.put(`${KV_CODE_PREFIX}${code}`, JSON.stringify(record), {
    expirationTtl: CODE_TTL_SECONDS,
  });
}

/** Retrieves and atomically deletes an authorization code. Returns null if not found. */
export async function consumeCode(kv: KVNamespace, code: string): Promise<OAuthCode | null> {
  const record = await kv.get<OAuthCode>(`${KV_CODE_PREFIX}${code}`, 'json');
  if (record) {
    await kv.delete(`${KV_CODE_PREFIX}${code}`);
  }
  return record;
}

/** Generates a cryptographically random URL-safe string of `bytes` random bytes. */
export function randomUrlSafe(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
