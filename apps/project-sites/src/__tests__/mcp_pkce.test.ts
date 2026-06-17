/**
 * Tests for RFC 7636 PKCE helpers (mcp_pkce.ts).
 *
 * @remarks
 * All tests run against Node 22's globalThis.crypto + crypto.subtle — the same
 * API surface available in the Cloudflare Worker runtime.  No mocks, no network.
 *
 * RFC 7636 §4.1 test vector:
 *   verifier   = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
 *   challenge  = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
 */

import { generateCodeVerifier, codeChallengeS256, verifyPkce } from '../services/mcp_pkce';

// RFC 7636 §4.1 — Appendix B test vector
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** base64url alphabet as a regex — only [A-Za-z0-9-._~] are unreserved per RFC 7636. */
const VERIFIER_CHARS = /^[A-Za-z0-9\-._~]+$/;

describe('generateCodeVerifier', () => {
  it('returns a string whose length is within [43, 128]', () => {
    const v = generateCodeVerifier();
    expect(v.length >= 43).toBe(true);
    expect(v.length <= 128).toBe(true);
  });

  it('contains only characters from the unreserved set [A-Za-z0-9-._~]', () => {
    // Run a few times to avoid spurious pass from a lucky short string
    for (let i = 0; i < 10; i++) {
      const v = generateCodeVerifier();
      expect(VERIFIER_CHARS.test(v)).toBe(true);
    }
  });

  it('respects a custom length argument and stays within [43, 128]', () => {
    const v = generateCodeVerifier(96);
    expect(v.length >= 43).toBe(true);
    expect(v.length <= 128).toBe(true);
  });
});

describe('codeChallengeS256', () => {
  it('produces the RFC 7636 Appendix B test vector', async () => {
    const challenge = await codeChallengeS256(RFC_VERIFIER);
    expect(challenge).toBe(RFC_CHALLENGE);
  });

  it('returns a base64url string with no padding characters', async () => {
    const challenge = await codeChallengeS256(RFC_VERIFIER);
    // base64url has no '+', '/', or '=' padding
    expect(challenge.includes('+')).toBe(false);
    expect(challenge.includes('/')).toBe(false);
    expect(challenge.includes('=')).toBe(false);
  });
});

describe('verifyPkce', () => {
  it('returns true for the RFC 7636 Appendix B test vector', async () => {
    const result = await verifyPkce(RFC_VERIFIER, RFC_CHALLENGE);
    expect(result).toBe(true);
  });

  it('returns false when the challenge does not match the verifier', async () => {
    const tampered = RFC_CHALLENGE.slice(0, -1) + (RFC_CHALLENGE.endsWith('M') ? 'A' : 'M');
    const result = await verifyPkce(RFC_VERIFIER, tampered);
    expect(result).toBe(false);
  });

  it('returns false when the verifier is wrong for a given challenge', async () => {
    const result = await verifyPkce(
      'wrong-verifier-string-that-is-long-enough-to-pass',
      RFC_CHALLENGE,
    );
    expect(result).toBe(false);
  });

  it('round-trips: a freshly generated verifier verifies against its own challenge', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await codeChallengeS256(verifier);
    const result = await verifyPkce(verifier, challenge);
    expect(result).toBe(true);
  });

  it('returns false when the challenge is empty', async () => {
    const result = await verifyPkce(RFC_VERIFIER, '');
    expect(result).toBe(false);
  });
});
