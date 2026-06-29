/**
 * Monthly quota reset helpers. Pure functions — every test asserts the same
 * inputs produce the same outputs without I/O or clock side-effects.
 */
import {
  daysUntilReset,
  QuotaWithPeriod,
  quotaResetSummary,
  resetQuotas,
} from '../services/quota_reset.js';

/** Helper: epoch ms for a given UTC date. */
function utcMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day);
}

/** A fresh quota that started at the beginning of the current period. */
function makeQuota(
  type: string,
  limit: number,
  used: number,
  periodMonthDay: [number, number, number],
): QuotaWithPeriod {
  return { limit, periodStartMs: utcMs(...periodMonthDay), type, used };
}

/* ------------------------------------------------------------------ */
/*  daysUntilReset                                                     */
/* ------------------------------------------------------------------ */

describe('daysUntilReset', () => {
  it('returns 4 for June 26 (4 days left: 27, 28, 29, 30)', () => {
    expect(daysUntilReset(utcMs(2026, 5, 26))).toBe(4);
  });

  it('returns 0 on the last day of the month', () => {
    expect(daysUntilReset(utcMs(2026, 5, 30))).toBe(0);
  });

  it('returns 27 for February 1 in a non-leap year', () => {
    // 2027-02-01 → Feb has 28 days → 27 remaining
    expect(daysUntilReset(utcMs(2027, 1, 1))).toBe(27);
  });

  it('returns 28 for February 1 in a leap year', () => {
    // 2028-02-01 → Feb has 29 days → 28 remaining
    expect(daysUntilReset(utcMs(2028, 1, 1))).toBe(28);
  });

  it('returns 30 for December 1', () => {
    expect(daysUntilReset(utcMs(2026, 11, 1))).toBe(30);
  });

  it('returns 0 for December 31', () => {
    expect(daysUntilReset(utcMs(2026, 11, 31))).toBe(0);
  });

  it('handles a 31-day month mid-month', () => {
    // January 15 → last day is 31 → 16 remaining
    expect(daysUntilReset(utcMs(2026, 0, 15))).toBe(16);
  });
});

/* ------------------------------------------------------------------ */
/*  resetQuotas                                                        */
/* ------------------------------------------------------------------ */

describe('resetQuotas', () => {
  it('resets only quotas whose 30-day period has elapsed', () => {
    // periodStartMs = June 1 → 30 days = June 30 23:59:59.999 UTC
    // nowMs = July 2 → period has elapsed
    const quotas = [
      makeQuota('builds', 5, 3, [2026, 5, 1]),
      makeQuota('ai_calls', 10, 2, [2026, 6, 1]), // period starts July 1, hasn't elapsed
    ];

    const result = resetQuotas(quotas, utcMs(2026, 6, 2));

    // builds was reset
    expect(result[0].used).toBe(0);
    expect(result[0].periodStartMs).toBe(utcMs(2026, 6, 1));
    expect(result[0].limit).toBe(5);
    // ai_calls unchanged
    expect(result[1].used).toBe(2);
    expect(result[1].periodStartMs).toBe(utcMs(2026, 6, 1));
  });

  it('resets when nowMs exactly equals periodStartMs + 30 days', () => {
    const quotas = [makeQuota('builds', 5, 3, [2026, 5, 1])];
    // 30 days after June 1 = 2592000000 ms
    const periodEnd = utcMs(2026, 5, 1) + 30 * 24 * 60 * 60 * 1000;

    const result = resetQuotas(quotas, periodEnd);

    expect(result[0].used).toBe(0);
  });

  it('does NOT reset a quota whose 30-day period has NOT elapsed', () => {
    const quotas = [makeQuota('ai_calls', 10, 1, [2026, 5, 28])];
    // nowMs = June 29 (1 day after periodStartMs)
    const result = resetQuotas(quotas, utcMs(2026, 5, 29));

    expect(result[0].used).toBe(1);
    expect(result[0].periodStartMs).toBe(utcMs(2026, 5, 28));
  });

  it('handles an empty array', () => {
    expect(resetQuotas([], utcMs(2026, 6, 1))).toEqual([]);
  });

  it('handles null / undefined gracefully', () => {
    // @ts-expect-error — deliberate invalid input for defensive coverage
    const result = resetQuotas(null, utcMs(2026, 6, 1));
    expect(result).toEqual([]);

    // @ts-expect-error — same
    const result2 = resetQuotas(undefined, utcMs(2026, 6, 1));
    expect(result2).toEqual([]);
  });

  it('passes through malformed entries unchanged', () => {
    const quotas = [
      // @ts-expect-error — missing periodStartMs
      { type: 'broken', limit: 5, used: 2 },
    ];
    const result = resetQuotas(quotas, utcMs(2026, 6, 1));
    expect((result[0] as Record<string, unknown>).used).toBe(2);
  });

  it('does not mutate the input array', () => {
    const quotas = [makeQuota('builds', 5, 3, [2026, 4, 1])];
    const original = { ...quotas[0] };
    resetQuotas(quotas, utcMs(2026, 6, 1));
    expect(quotas[0].used).toBe(original.used);
    expect(quotas[0].periodStartMs).toBe(original.periodStartMs);
  });

  it('resets all quotas whose period has lapsed', () => {
    const quotas = [
      makeQuota('builds', 5, 3, [2026, 3, 1]),   // April 1
      makeQuota('ai_calls', 10, 8, [2026, 4, 1]), // May 1
      makeQuota('emails', 100, 50, [2026, 5, 1]), // June 1
    ];
    // nowMs = July 15 — all three periods have elapsed
    const result = resetQuotas(quotas, utcMs(2026, 6, 15));
    expect(result[0].used).toBe(0);
    expect(result[1].used).toBe(0);
    expect(result[2].used).toBe(0);
  });

  it('keeps limit, type, and shape intact after reset', () => {
    const quotas = [makeQuota('builds', 5, 3, [2026, 5, 1])];
    const result = resetQuotas(quotas, utcMs(2026, 6, 2));
    expect(result[0].limit).toBe(5);
    expect(result[0].type).toBe('builds');
    expect(Object.keys(result[0]).sort()).toEqual(
      ['limit', 'periodStartMs', 'type', 'used'].sort(),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  quotaResetSummary                                                  */
/* ------------------------------------------------------------------ */

describe('quotaResetSummary', () => {
  it('counts reset quotas and gives earliest next reset', () => {
    const quotas = [
      makeQuota('builds', 5, 0, [2026, 4, 1]),
      makeQuota('ai_calls', 10, 5, [2026, 5, 1]),
    ];
    const summary = quotaResetSummary(quotas);
    expect(summary.resetCount).toBe(1);
    // periodStartMs + 30 days for the earlier-starting quota
    expect(summary.nextReset).toBe(utcMs(2026, 4, 1) + 30 * 24 * 60 * 60 * 1000);
  });

  it('counts zero when no quotas have used===0', () => {
    const quotas = [
      makeQuota('builds', 5, 1, [2026, 5, 1]),
      makeQuota('ai_calls', 10, 2, [2026, 5, 1]),
    ];
    const summary = quotaResetSummary(quotas);
    expect(summary.resetCount).toBe(0);
  });

  it('returns nextReset=0 for an empty array', () => {
    const summary = quotaResetSummary([]);
    expect(summary.resetCount).toBe(0);
    expect(summary.nextReset).toBe(0);
  });

  it('handles null / undefined gracefully', () => {
    // @ts-expect-error — deliberate invalid input
    const r1 = quotaResetSummary(null);
    expect(r1.resetCount).toBe(0);
    expect(r1.nextReset).toBe(0);

    // @ts-expect-error — same
    const r2 = quotaResetSummary(undefined);
    expect(r2.resetCount).toBe(0);
    expect(r2.nextReset).toBe(0);
  });

  it('skips malformed entries in summary', () => {
    const quotas = [
      makeQuota('builds', 5, 0, [2026, 5, 1]),
      // @ts-expect-error — missing periodStartMs
      { type: 'broken', limit: 5, used: 0 },
    ];
    const summary = quotaResetSummary(quotas);
    // Only the valid build quota, which has used===0
    expect(summary.resetCount).toBe(1);
  });

  it('identifies the earliest upcoming reset across quotas', () => {
    const quotas = [
      makeQuota('builds', 5, 3, [2026, 4, 15]),
      makeQuota('ai_calls', 10, 0, [2026, 5, 10]),
      makeQuota('emails', 100, 20, [2026, 4, 1]),
    ];
    const summary = quotaResetSummary(quotas);
    // Earliest periodEnd is from the 2026-04-01 quota (already passed) or 2026-04-15
    expect(summary.nextReset).toBe(utcMs(2026, 3, 1) + 30 * 24 * 60 * 60 * 1000);
    expect(summary.resetCount).toBe(1);
  });
});
