/**
 * RFC 7636 PKCE (Proof Key for Code Exchange) helpers for MCP OAuth flows.
 *
 * @remarks
 * Uses `globalThis.crypto` + `crypto.subtle` which are available both in the
 * Cloudflare Worker runtime (V8 isolate) and in Node 22 (global Web Crypto).
 * All functions are pure — no network, no D1, no KV — so they are trivially
 * unit-testable without mocks.  None of them throw; error cases return a typed
 * result (false / empty string) so callers can degrade gracefully.
 *
 * @example
 * ```ts
 * // Authorization-request leg
 * const verifier   = generateCodeVerifier();          // store in session
 * const challenge  = await codeChallengeS256(verifier);
 * const authUrl = `https://provider.example/oauth/authorize?
 *   code_challenge=${challenge}&code_challenge_method=S256&...`;
 *
 * // Token-exchange leg (server-side)
 * const ok = await verifyPkce(verifier, receivedChallenge);
 * if (!ok) return badRequest('PKCE verification failed');
 * ```
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc7636 | RFC 7636 — PKCE for OAuth}
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Encode a byte array as base64url (no padding) per RFC 4648 §5.
 *
 * @param bytes - Raw bytes to encode.
 * @returns Base64url string without trailing `=` padding.
 */
function toBase64Url(bytes: Uint8Array): string {
  // btoa needs a binary string — convert via fromCharCode
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random PKCE code verifier.
 *
 * @remarks
 * The verifier is a base64url-encoded random byte sequence.  The character set
 * `[A-Za-z0-9-._~]` is the unreserved set defined by RFC 7636 §4.1 and is
 * produced naturally by base64url encoding (base64url never emits `.` or `~`
 * though; the RFC allows them — the encoding is still spec-compliant because the
 * full unreserved set is a superset of base64url characters).
 *
 * The output length satisfies 43 ≤ len ≤ 128 chars as required by RFC 7636 §4.1.
 * With `length = 64` (default) input bytes → 86 output chars, well within range.
 *
 * @param length - Number of random bytes before encoding.  Clamped so the
 *   resulting base64url string lands in [43, 128].  Defaults to 64.
 * @returns A base64url string suitable for use as a PKCE code verifier.
 *
 * @example
 * ```ts
 * const verifier = generateCodeVerifier();        // 86-char base64url string
 * const short    = generateCodeVerifier(32);      // 43-char minimum
 * ```
 */
export function generateCodeVerifier(length = 64): string {
  // Clamp: 32 bytes → 43 base64url chars (floor), 96 bytes → 128 chars (ceil).
  const safeLength = Math.min(Math.max(length, 32), 96);
  const bytes = new Uint8Array(safeLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Compute the S256 PKCE code challenge for a given verifier.
 *
 * @remarks
 * `challenge = BASE64URL(SHA-256(ASCII(verifier)))` — RFC 7636 §4.2.
 *
 * Uses `crypto.subtle.digest` which is available in both the Cloudflare Worker
 * runtime and Node 22.  Never throws; returns an empty string on any unexpected
 * error so callers always get a string back.
 *
 * @param verifier - The code verifier produced by {@link generateCodeVerifier}.
 * @returns Base64url-encoded SHA-256 digest of the verifier (no padding).
 *
 * @throws Never — errors are swallowed and an empty string is returned.
 *
 * @example
 * ```ts
 * const challenge = await codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
 * // → 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
 * ```
 */
export async function codeChallengeS256(verifier: string): Promise<string> {
  try {
    const encoded = new TextEncoder().encode(verifier);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return toBase64Url(new Uint8Array(hashBuffer));
  } catch {
    return '';
  }
}

/**
 * Verify a PKCE exchange: recompute the S256 challenge from `verifier` and
 * compare it to `challenge` in a timing-safe manner.
 *
 * @remarks
 * The comparison uses a constant-time loop over every character position to
 * prevent timing attacks that could reveal partial matches.  Both strings must
 * have the same length for a true result; mismatched lengths short-circuit to
 * false immediately (the lengths themselves are not secret in PKCE).
 *
 * @param verifier  - The original code verifier from the authorization request.
 * @param challenge - The base64url challenge received from the client (or stored
 *   from the authorization request, depending on flow direction).
 * @returns `true` if and only if `codeChallengeS256(verifier) === challenge`.
 *
 * @throws Never — always returns a boolean.
 *
 * @example
 * ```ts
 * const ok = await verifyPkce(sessionVerifier, clientChallenge);
 * if (!ok) return c.json({ error: 'pkce_verification_failed' }, 400);
 * ```
 */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  try {
    const expected = await codeChallengeS256(verifier);
    if (expected.length === 0 || challenge.length === 0) return false;
    if (expected.length !== challenge.length) return false;

    // Constant-ish comparison — accumulate XOR over all positions so every
    // character is always evaluated regardless of early mismatch.
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ challenge.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
