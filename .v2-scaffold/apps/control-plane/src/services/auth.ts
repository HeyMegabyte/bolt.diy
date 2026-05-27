/**
 * Auth service: sessions, OAuth state, magic-link tokens, voice-OTP, passkey ceremony.
 */

import type { Env } from '../env.js';
import { dbInsert } from './db.js';
import { sha256Hex } from './crypto.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRecord {
  token: string;
  user_id: string;
  org_id: string | null;
  expires_at: number;
}

export async function createSession(
  env: Env,
  args: { userId: string; orgId: string | null; ip: string | null; ua: string | null },
): Promise<SessionRecord> {
  const token = crypto.randomUUID() + '.' + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  await dbInsert(env.DB, 'sessions', {
    id: crypto.randomUUID(),
    token,
    token_hash: tokenHash,
    user_id: args.userId,
    org_id: args.orgId,
    expires_at: expires,
    ip: args.ip,
    user_agent: args.ua,
  });
  return { token, user_id: args.userId, org_id: args.orgId, expires_at: expires };
}

export async function revokeSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE sessions SET revoked_at = ?1, updated_at = ?1 WHERE token = ?2`,
  )
    .bind(new Date().toISOString(), token)
    .run();
}

/** Issue an OAuth PKCE state row. Returns the verifier + challenge to drive the dance. */
export async function issueOAuthState(
  env: Env,
  args: { provider: string; redirectTo: string },
): Promise<{ state: string; codeVerifier: string; codeChallenge: string }> {
  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const challengeBytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  await dbInsert(env.DB, 'oauth_state', {
    id: crypto.randomUUID(),
    state,
    provider: args.provider,
    code_verifier: codeVerifier,
    redirect_to: args.redirectTo,
    expires_at: Date.now() + 30 * 60 * 1000,
  });
  return { state, codeVerifier, codeChallenge };
}

export async function issueMagicLink(
  env: Env,
  email: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = Date.now() + 15 * 60 * 1000;
  await dbInsert(env.DB, 'magic_links', {
    id: crypto.randomUUID(),
    token,
    email,
    expires_at: expires,
  });
  return { token, expiresAt: expires };
}
