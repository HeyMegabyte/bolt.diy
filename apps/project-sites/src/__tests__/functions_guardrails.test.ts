/**
 * Stage 4.2 — Functions dispatch guardrails (pure helpers).
 *
 * Locks the body-cap threshold logic (`isBodyTooLarge`: under/at/over the cap,
 * missing + malformed Content-Length) and the per-IP rate-limit key derivation
 * (`rateLimitKey`, incl. the missing-IP `unknown` bucket). The impure wiring
 * (413/429 responses + the ratelimit binding call) is covered in
 * functions_dispatch_wiring.test.ts.
 */
import {
  isBodyTooLarge,
  rateLimitKey,
  FUNCTIONS_BODY_CAP_BYTES,
} from '../services/functions_guardrails.js';

function reqWithLen(len: string | null): Request {
  const headers = new Headers();
  if (len !== null) headers.set('content-length', len);
  return new Request('https://abc.projectsites.dev/api/upload', { headers });
}

describe('isBodyTooLarge', () => {
  it('cap constant is ~25 MB', () => {
    expect(FUNCTIONS_BODY_CAP_BYTES).toBe(25 * 1024 * 1024);
  });

  it('false at/under the cap', () => {
    expect(isBodyTooLarge(reqWithLen(String(FUNCTIONS_BODY_CAP_BYTES)))).toBe(false);
    expect(isBodyTooLarge(reqWithLen(String(FUNCTIONS_BODY_CAP_BYTES - 1)))).toBe(false);
    expect(isBodyTooLarge(reqWithLen('0'))).toBe(false);
  });

  it('true over the cap', () => {
    expect(isBodyTooLarge(reqWithLen(String(FUNCTIONS_BODY_CAP_BYTES + 1)))).toBe(true);
    expect(isBodyTooLarge(reqWithLen(String(99 * 1024 * 1024)))).toBe(true);
  });

  it('false (allow) on a missing or malformed Content-Length (errs open)', () => {
    expect(isBodyTooLarge(reqWithLen(null))).toBe(false);
    expect(isBodyTooLarge(reqWithLen('not-a-number'))).toBe(false);
    expect(isBodyTooLarge(reqWithLen(''))).toBe(false);
  });

  it('honours a custom cap', () => {
    expect(isBodyTooLarge(reqWithLen('2000'), 1000)).toBe(true);
    expect(isBodyTooLarge(reqWithLen('500'), 1000)).toBe(false);
  });
});

describe('rateLimitKey', () => {
  it('is <siteId>:<ip>', () => {
    expect(rateLimitKey('abc', '203.0.113.7')).toBe('abc:203.0.113.7');
  });
  it('collapses a missing IP to an <siteId>:unknown bucket', () => {
    expect(rateLimitKey('abc', null)).toBe('abc:unknown');
    expect(rateLimitKey('abc', '')).toBe('abc:unknown');
  });
});
