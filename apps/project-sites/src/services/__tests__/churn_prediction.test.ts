/**
 * @module services/__tests__/churn_prediction.test
 * @description Tests for LOOP-ANALYTICS-016 churn-prediction signal.
 * Covers all risk bands, factor attribution, edge cases, and mitigating factors.
 */

import { type ChurnSignals, classifyRiskLevel, computeChurnRisk } from '../churn_prediction';

// ── Fixtures ───────────────────────────────────────────────────────────────

/** A perfectly healthy, engaged org. */
const HEALTHY: ChurnSignals = {
  dormancyDays: 1,
  activationTrend: 5,
  billingStatus: 'active',
  hasPublishedSite: true,
  hasTeammate: true,
  recentLogin: true,
};

/** Full churn: dormant, declining, past-due, no site, no teammate, no login. */
const DOOMED: ChurnSignals = {
  dormancyDays: 95,
  activationTrend: -15,
  billingStatus: 'past_due',
  hasPublishedSite: false,
  hasTeammate: false,
  recentLogin: false,
};

/** Neutral baseline — no risk factors, no mitigations. */
const NEUTRAL: ChurnSignals = {
  dormancyDays: 5,
  activationTrend: 0,
  billingStatus: 'active',
  hasPublishedSite: true,
  hasTeammate: false,
  recentLogin: true,
};

// ── classifyRiskLevel ─────────────────────────────────────────────────────

describe('classifyRiskLevel', () => {
  it('0 → low', () => expect(classifyRiskLevel(0)).toBe('low'));
  it('19 → low', () => expect(classifyRiskLevel(19)).toBe('low'));
  it('20 → medium', () => expect(classifyRiskLevel(20)).toBe('medium'));
  it('49 → medium', () => expect(classifyRiskLevel(49)).toBe('medium'));
  it('50 → high', () => expect(classifyRiskLevel(50)).toBe('high'));
  it('74 → high', () => expect(classifyRiskLevel(74)).toBe('high'));
  it('75 → critical', () => expect(classifyRiskLevel(75)).toBe('critical'));
  it('100 → critical', () => expect(classifyRiskLevel(100)).toBe('critical'));
});

// ── computeChurnRisk ──────────────────────────────────────────────────────

describe('computeChurnRisk', () => {
  // ── Healthy / low risk ────────────────────────────────────────────────

  it('scores a healthy org as low risk', () => {
    const result = computeChurnRisk(HEALTHY);
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
    // With all mitigation and no risk factors, score should hit 0
  });

  it('scores a free-tier engaged org as low risk', () => {
    const result = computeChurnRisk({
      dormancyDays: 3,
      activationTrend: 2,
      billingStatus: null,
      hasPublishedSite: true,
      hasTeammate: false,
      recentLogin: true,
    });
    expect(result.level).toBe('low');
    expect(result.score).toBeLessThan(20);
  });

  // ── Dormancy bands ────────────────────────────────────────────────────

  it('adds 10 for 14+ days dormant', () => {
    const result = computeChurnRisk({
      ...HEALTHY,
      dormancyDays: 20,
      hasTeammate: false,
      recentLogin: false,
    });
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.factors).toContain('Dormant 14+ days');
  });

  it('adds 20 for 30+ days dormant', () => {
    const result = computeChurnRisk({
      ...HEALTHY,
      dormancyDays: 45,
      hasTeammate: false,
      recentLogin: false,
    });
    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.factors).toContain('Dormant 30+ days');
  });

  it('adds 40 for 90+ days dormant', () => {
    const result = computeChurnRisk({
      ...HEALTHY,
      dormancyDays: 100,
      hasTeammate: false,
      recentLogin: false,
    });
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.factors).toContain('Dormant 90+ days');
  });

  it('picks the highest dormancy band only', () => {
    const result = computeChurnRisk({
      dormancyDays: 100,
      activationTrend: 0,
      billingStatus: 'active',
      hasPublishedSite: true,
      hasTeammate: true,
      recentLogin: true,
    });
    // Only the 90+ band, not all three
    const dormancyFactors = result.factors.filter((f) => f.startsWith('Dormant'));
    expect(dormancyFactors).toHaveLength(1);
    expect(dormancyFactors[0]).toBe('Dormant 90+ days');
  });

  // ── Activation trend ──────────────────────────────────────────────────

  it('adds 25 for sharply declining activation (< -10)', () => {
    const result = computeChurnRisk({
      ...NEUTRAL,
      activationTrend: -15,
    });
    expect(result.factors).toContain('Activation score declining sharply');
    expect(result.score).toBeGreaterThanOrEqual(15); // 25 - 10 (published+login mitigations)
  });

  it('adds 15 for slipping activation (-5 to -10)', () => {
    const result = computeChurnRisk({
      ...NEUTRAL,
      activationTrend: -7,
    });
    expect(result.factors).toContain('Activation score slipping');
    expect(result.score).toBeGreaterThanOrEqual(5); // 15 - 10
  });

  it('ignores flat or positive activation trend', () => {
    const result = computeChurnRisk({ ...HEALTHY, activationTrend: 3 });
    const activationFactors = result.factors.filter((f) => f.toLowerCase().includes('activation'));
    expect(activationFactors).toHaveLength(0);
  });

  // ── Billing signals ───────────────────────────────────────────────────

  it('adds 30 for past-due billing', () => {
    const result = computeChurnRisk({
      ...NEUTRAL,
      billingStatus: 'past_due',
    });
    expect(result.factors).toContain('Payment past due');
    expect(result.score).toBeGreaterThanOrEqual(20); // 30 - 10 (published+login)
  });

  it('adds 20 for canceled subscription', () => {
    const result = computeChurnRisk({
      ...NEUTRAL,
      billingStatus: 'canceled',
    });
    expect(result.factors).toContain('Subscription canceled');
    expect(result.score).toBeGreaterThanOrEqual(10); // 20 - 10 (published+login)
  });

  it('adds 15 for trialing without published site', () => {
    const result = computeChurnRisk({
      dormancyDays: 1,
      activationTrend: 0,
      billingStatus: 'trialing',
      hasPublishedSite: false,
      hasTeammate: false,
      recentLogin: true,
    });
    expect(result.factors).toContain('Trial ending without published site');
  });

  it('does not penalize trialing WITH a published site', () => {
    const result = computeChurnRisk({
      ...HEALTHY,
      billingStatus: 'trialing',
      hasPublishedSite: true,
    });
    const trialFactor = result.factors.find((f) => f.includes('Trial'));
    expect(trialFactor).toBeUndefined();
  });

  // ── Engagement gaps ───────────────────────────────────────────────────

  it('adds 10 for no published sites', () => {
    const result = computeChurnRisk({
      ...NEUTRAL,
      hasPublishedSite: false,
    });
    expect(result.factors).toContain('No published sites');
    expect(result.score).toBeGreaterThanOrEqual(5); // 10 - 5 (recentLogin mitigation)
  });

  it('adds 10 for no recent login', () => {
    const result = computeChurnRisk({
      ...NEUTRAL,
      recentLogin: false,
    });
    expect(result.factors).toContain('No recent login (7 days)');
    expect(result.score).toBeGreaterThanOrEqual(5); // 10 - 5 (hasPublishedSite mitigation)
  });

  // ── Mitigating factors ────────────────────────────────────────────────

  it('applies all three mitigations', () => {
    const result = computeChurnRisk({
      dormancyDays: 45,
      activationTrend: -7,
      billingStatus: 'past_due',
      hasPublishedSite: true,
      hasTeammate: true,
      recentLogin: true,
    });
    // Risk: 20 (dormant 30+) + 15 (slipping) + 30 (past due) = 65
    // Mitigation: 5 (teammate) + 5 (login) + 5 (published) = 15
    // Expected: 50
    expect(result.score).toBe(50);
    expect(result.factors).toContain('Has teammate (mitigating)');
    expect(result.factors).toContain('Recently active (mitigating)');
    expect(result.factors).toContain('Has published site (mitigating)');
  });

  it('sorts factors most-significant first', () => {
    const result = computeChurnRisk(DOOMED);
    // Dormant 90+ days = 40 pts, Payment past due = 30 pts
    // Dormant should be first (highest points)
    const first = result.factors[0];
    expect(first).toBe('Dormant 90+ days');
    const second = result.factors[1];
    expect(second).toBe('Payment past due');
  });

  // ── Score bounds ──────────────────────────────────────────────────────

  it('caps score at 100', () => {
    const result = computeChurnRisk(DOOMED);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('floors score at 0 (no negative risk)', () => {
    const result = computeChurnRisk({
      dormancyDays: 0,
      activationTrend: 10,
      billingStatus: 'active',
      hasPublishedSite: true,
      hasTeammate: true,
      recentLogin: true,
    });
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });

  it('returns factors array even at score 0', () => {
    const result = computeChurnRisk(HEALTHY);
    expect(Array.isArray(result.factors)).toBe(true);
  });

  // ── Critical risk ─────────────────────────────────────────────────────

  it('classifies doomed org as critical', () => {
    const result = computeChurnRisk(DOOMED);
    expect(result.level).toBe('critical');
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  it('handles free-tier null billing status', () => {
    const result = computeChurnRisk({
      dormancyDays: 60,
      activationTrend: -3,
      billingStatus: null,
      hasPublishedSite: false,
      hasTeammate: false,
      recentLogin: false,
    });
    expect(result.level).toBeDefined();
    expect(result.score).toBeGreaterThan(0);
  });

  it('handles zero dormancy', () => {
    const result = computeChurnRisk({
      dormancyDays: 0,
      activationTrend: 0,
      billingStatus: 'active',
      hasPublishedSite: true,
      hasTeammate: false,
      recentLogin: true,
    });
    expect(result.score).toBe(0);
    expect(result.level).toBe('low');
  });
});
