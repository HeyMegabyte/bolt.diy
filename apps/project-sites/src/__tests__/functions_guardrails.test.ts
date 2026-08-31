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
  FUNCTIONS_DISPATCH_LIMITS,
  FUNCTIONS_DAILY_CAP,
  FUNCTIONS_DISPATCH_EVENT,
  overCapKey,
  secondsUntilUtcMidnight,
  functionsDailyCapCountSql,
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

describe('FUNCTIONS_DISPATCH_LIMITS (Stage 4.2d — per-invocation WfP custom limits)', () => {
  it('caps CPU at 50 ms and subrequests at 50 per invocation (ADR §10)', () => {
    expect(FUNCTIONS_DISPATCH_LIMITS).toEqual({ cpuMs: 50, subRequests: 50 });
  });
});

describe('daily-cap pure helpers (Stage 4.2c)', () => {
  it('cap is 100k/day and the AE event tag is fn_dispatch', () => {
    expect(FUNCTIONS_DAILY_CAP).toBe(100_000);
    expect(FUNCTIONS_DISPATCH_EVENT).toBe('fn_dispatch');
  });

  it('overCapKey is fn_overcap:<siteId>', () => {
    expect(overCapKey('abc')).toBe('fn_overcap:abc');
    expect(overCapKey('f84f5ab1-df49')).toBe('fn_overcap:f84f5ab1-df49');
  });

  it('secondsUntilUtcMidnight counts down to 00:00 UTC (floored at 60)', () => {
    expect(secondsUntilUtcMidnight(new Date('2026-01-01T23:59:00Z'))).toBe(60);
    expect(secondsUntilUtcMidnight(new Date('2026-01-01T00:00:00Z'))).toBe(86400);
    expect(secondsUntilUtcMidnight(new Date('2026-01-01T12:00:00Z'))).toBe(43200);
    // sub-60 remainder floors to 60 (KV rejects a shorter TTL)
    expect(secondsUntilUtcMidnight(new Date('2026-01-01T23:59:30Z'))).toBe(60);
  });

  it('functionsDailyCapCountSql isolates fn_dispatch rows, sums since UTC midnight, filters ≥ cap', () => {
    const sql = functionsDailyCapCountSql(100_000);
    expect(sql).toContain("blob1 = 'fn_dispatch'");
    expect(sql).toContain('SUM(_sample_interval) AS n');
    expect(sql).toContain('blob3 AS site_id');
    expect(sql).toContain('timestamp >= toStartOfDay(NOW())');
    expect(sql).toContain('HAVING n >= 100000');
    expect(sql).toContain('projectsites_admin_v1');
  });

  it('functionsDailyCapCountSql clamps a bogus cap to ≥ 1 (never emits HAVING n >= 0)', () => {
    expect(functionsDailyCapCountSql(0)).toContain('HAVING n >= 1');
    expect(functionsDailyCapCountSql(-5)).toContain('HAVING n >= 1');
  });
});
