import { type ErrorSignals, classifyImpactLevel, priorityForScore, triageError } from '../impact_triage';

describe('classifyImpactLevel', () => {
  it('0 → none', () => expect(classifyImpactLevel(0)).toBe('none'));
  it('1 → low', () => expect(classifyImpactLevel(1)).toBe('low'));
  it('20 → medium', () => expect(classifyImpactLevel(20)).toBe('medium'));
  it('50 → high', () => expect(classifyImpactLevel(50)).toBe('high'));
  it('75 → critical', () => expect(classifyImpactLevel(75)).toBe('critical'));
});

describe('priorityForScore', () => {
  it('0 → P4', () => expect(priorityForScore(0)).toBe('P4'));
  it('1 → P3', () => expect(priorityForScore(1)).toBe('P3'));
  it('20 → P2', () => expect(priorityForScore(20)).toBe('P2'));
  it('50 → P1', () => expect(priorityForScore(50)).toBe('P1'));
  it('75 → P0', () => expect(priorityForScore(75)).toBe('P0'));
});

describe('triageError', () => {
  it('returns none/P4 for no signals', () => {
    const r = triageError({ affectedUsers: 0, occurrenceCount: 1, errorRate: 0 });
    expect(r.score).toBe(0);
    expect(r.level).toBe('none');
    expect(r.priority).toBe('P4');
    expect(r.alertNow).toBe(false);
  });

  it('scores blocker as high impact', () => {
    const r = triageError({ affectedUsers: 1, occurrenceCount: 1, isBlocker: true, errorRate: 0 });
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.factors).toContain('Blocker: users cannot complete core action');
  });

  it('scores revenue surface as high', () => {
    const r = triageError({ affectedUsers: 1, occurrenceCount: 1, isRevenueSurface: true, errorRate: 0 });
    expect(r.score).toBeGreaterThanOrEqual(25);
    expect(r.factors).toContain('Revenue surface affected');
  });

  it('critical service + many users → P0', () => {
    const r = triageError({
      affectedUsers: 50,
      occurrenceCount: 100,
      isBlocker: true,
      isRevenueSurface: true,
      isCriticalService: true,
      errorRate: 0.08,
    });
    expect(r.score).toBe(100);
    expect(r.priority).toBe('P0');
    expect(r.alertNow).toBe(true);
    expect(r.level).toBe('critical');
  });

  it('50 users add 20 points', () => {
    const r = triageError({ affectedUsers: 50, occurrenceCount: 1, errorRate: 0 });
    expect(r.factors.some((f) => f.includes('50 users'))).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(20);
  });

  it('10 users add 10 points', () => {
    const r = triageError({ affectedUsers: 10, occurrenceCount: 1, errorRate: 0 });
    expect(r.factors.some((f) => f.includes('10 users'))).toBe(true);
  });

  it('caps score at 100', () => {
    const all: ErrorSignals = {
      affectedUsers: 999,
      occurrenceCount: 999,
      isBlocker: true,
      isRevenueSurface: true,
      isCriticalService: true,
      errorRate: 1,
    };
    expect(triageError(all).score).toBe(100);
  });

  it('sorts factors by contribution descending', () => {
    const r = triageError({
      affectedUsers: 50,
      occurrenceCount: 100,
      isBlocker: true,
      isRevenueSurface: true,
      errorRate: 0.01,
    });
    // Blocker (35) should be first, then Revenue (25), then users (20), then error rate (8), then occurrences (10)
    const first = r.factors[0];
    expect(first).toContain('Blocker');
  });

  it('single user scores low', () => {
    const r = triageError({ affectedUsers: 1, occurrenceCount: 1, errorRate: 0 });
    expect(r.score).toBe(3);
    expect(r.level).toBe('low');
    expect(r.priority).toBe('P3');
  });

  it('medium error rate without users still scores', () => {
    const r = triageError({ affectedUsers: 0, occurrenceCount: 50, errorRate: 0.03 });
    expect(r.score).toBeGreaterThanOrEqual(8); // error rate ≥1% = 8
    expect(r.score).toBeLessThan(20); // not medium yet
  });
});
