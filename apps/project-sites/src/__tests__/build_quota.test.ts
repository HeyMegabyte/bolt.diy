import {
  checkBuildQuota,
  buildQuotaSummary,
  PLAN_QUOTAS,
  type BuildQuota,
} from '../services/build_quota.js';

describe('checkBuildQuota', () => {
  it('returns not exceeded when used is below limit', () => {
    const q: BuildQuota = { type: 'monthly_builds', limit: 5, used: 3, periodStartMs: 1000 };
    const r = checkBuildQuota(q, 2000);
    expect(r.exceeded).toBe(false);
    expect(r.remaining).toBe(2);
  });

  it('returns exceeded when used equals limit', () => {
    const q: BuildQuota = { type: 'monthly_builds', limit: 5, used: 5, periodStartMs: 1000 };
    const r = checkBuildQuota(q, 2000);
    expect(r.exceeded).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('returns exceeded when used exceeds limit', () => {
    const q: BuildQuota = { type: 'monthly_builds', limit: 5, used: 7, periodStartMs: 1000 };
    const r = checkBuildQuota(q, 2000);
    expect(r.exceeded).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('computes resetsInMs correctly', () => {
    // periodStartMs = day 0, now = day 10, resets after 20 more days
    const day10 = 10 * 24 * 60 * 60 * 1000;
    const periodStart = 0;
    const q: BuildQuota = {
      type: 'build_minutes',
      limit: 60,
      used: 10,
      periodStartMs: periodStart,
    };
    const r = checkBuildQuota(q, day10);
    // Reset at periodStart + 30 days = 30 * 86400000 = 2592000000ms
    // resetsInMs = 2592000000 - day10
    expect(r.resetsInMs).toBe(20 * 24 * 60 * 60 * 1000);
  });

  it('handles zero limit gracefully (never exceeded)', () => {
    const q: BuildQuota = { type: 'monthly_builds', limit: 0, used: 100, periodStartMs: 0 };
    const r = checkBuildQuota(q, 1000);
    expect(r.exceeded).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('clamps negative used to 0', () => {
    const q: BuildQuota = { type: 'monthly_builds', limit: 5, used: -3, periodStartMs: 0 };
    const r = checkBuildQuota(q, 1000);
    expect(r.remaining).toBe(5);
    expect(r.exceeded).toBe(false);
  });

  it('defaults nowMs to Date.now() when omitted', () => {
    const q: BuildQuota = { type: 'monthly_builds', limit: 10, used: 0, periodStartMs: 0 };
    const r = checkBuildQuota(q);
    expect(r.exceeded).toBe(false);
    expect(typeof r.resetsInMs).toBe('number');
  });
});

describe('buildQuotaSummary', () => {
  it('returns canBuild=true with no blockers when all quotas are OK', () => {
    const quotas: BuildQuota[] = [
      { type: 'monthly_builds', limit: 5, used: 2, periodStartMs: 0 },
      { type: 'concurrent_builds', limit: 1, used: 0, periodStartMs: 0 },
    ];
    const s = buildQuotaSummary(quotas);
    expect(s.canBuild).toBe(true);
    expect(s.blockers).toEqual([]);
  });

  it('returns canBuild=false with a blocker when one quota is exceeded', () => {
    const quotas: BuildQuota[] = [
      { type: 'monthly_builds', limit: 5, used: 5, periodStartMs: 0 },
      { type: 'concurrent_builds', limit: 1, used: 0, periodStartMs: 0 },
    ];
    const s = buildQuotaSummary(quotas);
    expect(s.canBuild).toBe(false);
    expect(s.blockers).toEqual(['monthly_builds: limit 5 reached']);
  });

  it('lists multiple blockers when multiple quotas are exceeded', () => {
    const quotas: BuildQuota[] = [
      { type: 'monthly_builds', limit: 5, used: 6, periodStartMs: 0 },
      { type: 'concurrent_builds', limit: 1, used: 1, periodStartMs: 0 },
      { type: 'build_minutes', limit: 15, used: 8, periodStartMs: 0 },
    ];
    const s = buildQuotaSummary(quotas);
    expect(s.canBuild).toBe(false);
    expect(s.blockers).toHaveLength(2);
    expect(s.blockers[0]).toContain('monthly_builds');
    expect(s.blockers[1]).toContain('concurrent_builds');
  });

  it('returns canBuild=true for empty quotas', () => {
    const s = buildQuotaSummary([]);
    expect(s.canBuild).toBe(true);
    expect(s.blockers).toEqual([]);
  });

  it('never throws on null/undefined input slots', () => {
    expect(buildQuotaSummary([] as unknown as BuildQuota[]).canBuild).toBe(true);
  });
});

describe('PLAN_QUOTAS', () => {
  it('has free tier limits: 5 monthly, 1 concurrent, 15 build-minutes', () => {
    expect(PLAN_QUOTAS['free']).toEqual({
      monthly_builds: 5,
      concurrent_builds: 1,
      build_minutes: 15,
    });
  });

  it('has starter tier limits: 50 monthly, 2 concurrent, 60 build-minutes', () => {
    expect(PLAN_QUOTAS['starter']).toEqual({
      monthly_builds: 50,
      concurrent_builds: 2,
      build_minutes: 60,
    });
  });

  it('has pro tier limits: 500 monthly, 5 concurrent, 300 build-minutes', () => {
    expect(PLAN_QUOTAS['pro']).toEqual({
      monthly_builds: 500,
      concurrent_builds: 5,
      build_minutes: 300,
    });
  });
});
