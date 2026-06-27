/**
 * @module lib/jwt
 *
 * @description
 * Minimal HS256 JWT signer built on Web Crypto — no external dependency, runs in
 * the Workers runtime. Used to mint short-TTL signed tokens (e.g. the super-admin
 * impersonation token) whose payload + expiry are tamper-evident.
 *
 * Verification lives alongside issuance; until a consumer is wired, `signHs256`
 * produces a standard compact JWS that any HS256 verifier (jose, the worker's own
 * future middleware) can validate against the same secret.
 */

/** base64url-encode raw bytes (RFC 7515 — no padding, URL-safe alphabet). */
function b64urlBytes(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url-encode a UTF-8 string. */
function b64urlString(str: string): string {
  return b64urlBytes(new TextEncoder().encode(str));
}

/**
 * Sign a compact HS256 JWT. `iat` + `exp` are injected automatically from `ttlSeconds`.
 *
 * @param payload - claims to embed (e.g. `{ sub, impersonator_id, mode }`); `iat`/`exp` are added.
 * @param secret - the HMAC signing secret (≥32 bytes recommended).
 * @param ttlSeconds - token lifetime; `exp = now + ttlSeconds`.
 * @returns the signed `header.payload.signature` compact JWS string.
 *
 * @example
 * const token = await signHs256({ sub: 'u_1', impersonator_id: 'u_op' }, secret, 1800);
 * // → "eyJhbG….eyJzdWI….K3p…"  (verifiable with the same secret)
 *
 * @remarks Impure — reads Web Crypto RNG-free HMAC + the wall clock (`Date.now`).
 */
export async function signHs256(
  payload: Readonly<Record<string, unknown>>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims = { ...payload, iat: now, exp: now + ttlSeconds };
  const signingInput = `${b64urlString(JSON.stringify(header))}.${b64urlString(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;
}

/** base64url-decode to bytes (ArrayBuffer-backed, for Web Crypto BufferSource). */
function b64urlToBytes(seg: string): Uint8Array<ArrayBuffer> {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

/** A verified token's claims (whatever was signed, plus the injected iat/exp). */
export type VerifiedClaims = Record<string, unknown> & { iat: number; exp: number };

/**
 * Verify a compact HS256 JWT against `secret` and check expiry. Returns the claims
 * when the signature is valid AND `exp` is in the future; returns `null` on ANY
 * failure (bad shape, wrong alg, bad signature, expired) — never throws.
 *
 * @param token - the compact `header.payload.signature` string.
 * @param secret - the HMAC secret the token was signed with.
 * @param nowSeconds - current Unix seconds (injectable for tests); defaults to `Date.now()`.
 * @returns the verified claims, or `null` if the token is invalid/expired.
 *
 * @example
 * const claims = await verifyHs256(token, secret);
 * if (claims) impersonate(claims.sub as string); // safe: signature + exp checked
 *
 * @remarks Constant-time-ish: relies on Web Crypto `verify` for the signature compare.
 */
export async function verifyHs256(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<VerifiedClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(headerB64))) as {
      alg?: string;
    };
    if (header.alg !== 'HS256') return null;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    if (!valid) return null;
    const claims = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(payloadB64)),
    ) as VerifiedClaims;
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}
