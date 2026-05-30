/**
 * @module libs/features/email_marketing/unsubscribe
 * @description Stateless, signed unsubscribe links for outbound campaigns —
 * the CAN-SPAM / GDPR requirement that gates `email_marketing` going live.
 *
 * A token is `base64url(siteId|email)` + an HMAC-SHA256 signature over the same
 * payload, so a link can't be forged to unsubscribe an address the sender
 * doesn't know. No schema change: verification recomputes the signature.
 *
 * @remarks The HMAC key is `env.STRIPE_WEBHOOK_SECRET` (a required, high-entropy
 * secret) used purely as a signing key here — NOT for any Stripe semantics. A
 * dedicated `UNSUBSCRIBE_SECRET` should be provisioned later (needs an env.ts
 * edit); tracked in the manifest risks.
 * @packageDocumentation
 */

import { hmacSha256, DOMAINS } from '@project-sites/shared';
import type { Env } from '../../../src/types/env.js';

/** URL-safe base64 of an ASCII string. */
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Inverse of {@link b64url}. Returns null on malformed input. */
function unb64url(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  } catch {
    return null;
  }
}

/** The signing key. Documented reuse of a required secret (see @module remarks). */
function signingKey(env: Env): string {
  return env.STRIPE_WEBHOOK_SECRET || 'unsubscribe-fallback-key';
}

/** Build the `{ u, s }` token pair for an (email, site) unsubscribe link. */
export async function signUnsubToken(
  env: Env,
  email: string,
  siteId: string,
): Promise<{ u: string; s: string }> {
  const payload = `${siteId}|${email.toLowerCase()}`;
  const s = await hmacSha256(signingKey(env), payload);
  return { u: b64url(payload), s };
}

/** Verify a token pair; returns `{ email, siteId }` or null if forged/malformed. */
export async function verifyUnsubToken(
  env: Env,
  u: string,
  s: string,
): Promise<{ email: string; siteId: string } | null> {
  const payload = unb64url(u);
  if (!payload || !payload.includes('|')) return null;
  const expected = await hmacSha256(signingKey(env), payload);
  if (expected.length !== s.length) return null;
  // constant-ish-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ s.charCodeAt(i);
  if (diff !== 0) return null;
  const [siteId, email] = payload.split('|');
  return siteId && email ? { siteId, email } : null;
}

/** Absolute unsubscribe URL for an (email, site). */
export async function unsubscribeUrl(env: Env, email: string, siteId: string): Promise<string> {
  const { u, s } = await signUnsubToken(env, email, siteId);
  return `https://${DOMAINS.SITES_BASE}/api/marketing/unsubscribe?u=${encodeURIComponent(u)}&s=${encodeURIComponent(s)}`;
}

/** CAN-SPAM footer appended to every campaign email body. */
export function unsubscribeFooterHtml(url: string): string {
  return (
    `<hr style="margin:32px 0 12px;border:none;border-top:1px solid #e2e8f0;">` +
    `<p style="font:12px/1.5 system-ui,sans-serif;color:#94a3b8;text-align:center;margin:0;">` +
    `You're receiving this because you opted in on our site. ` +
    `<a href="${url}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>.</p>`
  );
}
