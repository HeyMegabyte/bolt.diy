/**
 * Cloudflare Turnstile — server-side token verification.
 *
 * @remarks
 * Every form that collects a `cf-turnstile-response` token (signin, create,
 * claim, lead, newsletter, payment-sensitive) verifies it here against
 * Cloudflare's siteverify endpoint before trusting the submission. The `fetch`
 * is injected so every branch is unit-testable with no network, and the function
 * NEVER throws — it returns a typed result so the caller can degrade gracefully
 * (e.g. soft-allow + log when `not_configured`, hard-block on `verification_failed`).
 *
 * @example
 * ```ts
 * const v = await verifyTurnstileToken({
 *   token: form['cf-turnstile-response'],
 *   secret: env.TURNSTILE_SECRET_KEY,
 *   remoteIp: c.req.header('cf-connecting-ip'),
 *   expectedHostname: 'projectsites.dev',
 * });
 * if (!v.ok && v.reason !== 'not_configured') return badRequest('Captcha failed.');
 * ```
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Input to {@link verifyTurnstileToken}. */
export interface TurnstileVerifyInput {
  token: string | null | undefined;
  secret: string | null | undefined;
  remoteIp?: string | null;
  /** When set, the verified `action` must match (defence against token reuse across forms). */
  expectedAction?: string;
  /** When set, the verified `hostname` must match. */
  expectedHostname?: string;
  /** Injected for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Why a Turnstile verification did not pass. */
export type TurnstileFailReason =
  | 'not_configured'
  | 'missing_token'
  | 'verification_failed'
  | 'action_mismatch'
  | 'hostname_mismatch'
  | 'network_error';

/** Result of a verification attempt — never thrown. */
export type TurnstileResult =
  | { ok: true; action?: string; hostname?: string }
  | { ok: false; reason: TurnstileFailReason; errorCodes?: string[] };

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

/**
 * Verify a Turnstile token against Cloudflare siteverify.
 *
 * @param input - Token, secret, optional remote IP + expected action/hostname.
 * @returns A {@link TurnstileResult}; never throws.
 */
export async function verifyTurnstileToken(input: TurnstileVerifyInput): Promise<TurnstileResult> {
  // Graceful-degrade signal: an unconfigured secret reports rather than throwing,
  // so the caller can choose to soft-allow + log instead of hard-blocking users.
  if (!input.secret) return { ok: false, reason: 'not_configured' };
  if (!input.token) return { ok: false, reason: 'missing_token' };

  const body = new URLSearchParams({ secret: input.secret, response: input.token });
  if (input.remoteIp) body.append('remoteip', input.remoteIp);

  const doFetch = input.fetchImpl ?? fetch;
  let data: SiteverifyResponse;
  try {
    const res = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    data = (await res.json()) as SiteverifyResponse;
  } catch {
    return { ok: false, reason: 'network_error' };
  }

  if (!data.success) {
    return { ok: false, reason: 'verification_failed', errorCodes: data['error-codes'] ?? [] };
  }
  if (input.expectedAction !== undefined && data.action !== input.expectedAction) {
    return { ok: false, reason: 'action_mismatch' };
  }
  if (input.expectedHostname !== undefined && data.hostname !== input.expectedHostname) {
    return { ok: false, reason: 'hostname_mismatch' };
  }
  return {
    ok: true,
    ...(data.action !== undefined ? { action: data.action } : {}),
    ...(data.hostname !== undefined ? { hostname: data.hostname } : {}),
  };
}
