import {
  checkQuota,
  quotaSummary,
  FREE_QUOTAS,
  type Quota,
  type QuotaType,
} from '../services/quota_manager.js';

describe('checkQuota', () => {
  it('returns not exceeded when usage is below the limit', () => {
    const r = checkQuota({ type: 'builds', limit: 5, used: 3 });
    expect(r.exceeded).toBe(false);
    expect(r.remaining).toBe(2);
    expect(r.pctUsed).toBe(60);
  });

  it('returns exceeded when usage equals the limit', () => {
    const r = checkQuota({ type: 'sites', limit: 1, used: 1 });
    expect(r.exceeded).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.pctUsed).toBe(100);
  });

  it('returns exceeded when usage surpasses the limit', () => {
    const r = checkQuota({ type: 'emails', limit: 100, used: 150 });
    expect(r.exceeded).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.pctUsed).toBe(100);
  });

  it('returns zero remaining with no limit', () => {
    const r = checkQuota({ type: 'ai_calls', limit: 0, used: 5 });
    expect(r.exceeded).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.pctUsed).toBe(0);
  });

  it('handles zero usage', () => {
    const r = checkQuota({ type: 'storage_mb', limit: 10, used: 0 });
    expect(r.exceeded).toBe(false);
    expect(r.remaining).toBe(10);
    expect(r.pctUsed).toBe(0);
  });

  it('clamps negative limit to 0', () => {
    const r = checkQuota({ type: 'ai_calls', limit: -1, used: 0 });
    expect(r.exceeded).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.pctUsed).toBe(0);
  });

  it('clamps negative used to 0', () => {
    const r = checkQuota({ type: 'builds', limit: 5, used: -3 });
    expect(r.exceeded).toBe(false);
    expect(r.remaining).toBe(5);
    expect(r.pctUsed).toBe(0);
  });
});

describe('quotaSummary', () => {
  it('reports all quotas within limits', () => {
    const quotas: Quota[] = [
      { type: 'sites', limit: 1, used: 0 },
      { type: 'builds', limit: 5, used: 2 },
      { type: 'emails', limit: 100, used: 30 },
    ];
    const r = quotaSummary(quotas);
    expect(r.total).toBe(3);
    expect(r.exceeded).toBe(0);
    expect(r.worst?.type).toBe('builds');
    expect(r.worst?.pctUsed).toBe(40);
  });

  it('counts exceeded quotas', () => {
    const quotas: Quota[] = [
      { type: 'sites', limit: 1, used: 1 },
      { type: 'builds', limit: 5, used: 6 },
      { type: 'ai_calls', limit: 10, used: 3 },
    ];
    const r = quotaSummary(quotas);
    expect(r.total).toBe(3);
    expect(r.exceeded).toBe(2);
    expect(r.worst?.type).toBe('sites');
    expect(r.worst?.pctUsed).toBe(100);
  });

  it('identifies the worst-capped dimension', () => {
    const quotas: Quota[] = [
      { type: 'sites', limit: 1, used: 0 },
      { type: 'builds', limit: 5, used: 4 },
      { type: 'storage_mb', limit: 10, used: 10 },
    ];
    const r = quotaSummary(quotas);
    expect(r.worst?.type).toBe('storage_mb');
    expect(r.worst?.pctUsed).toBe(100);
  });

  it('returns worst as null when all limits are 0', () => {
    const r = quotaSummary([
      { type: 'ai_calls', limit: 0, used: 5 },
      { type: 'emails', limit: 0, used: 0 },
    ]);
    expect(r.worst).toBeNull();
  });

  it('returns worst as null for empty input', () => {
    const r = quotaSummary([]);
    expect(r.total).toBe(0);
    expect(r.exceeded).toBe(0);
    expect(r.worst).toBeNull();
  });

  it('never throws on null/undefined/malformed input', () => {
    const r = quotaSummary(undefined as unknown as Quota[]);
    expect(r.total).toBe(0);
    expect(r.exceeded).toBe(0);
    expect(r.worst).toBeNull();
  });

  it('skips malformed quota entries gracefully', () => {
    const quotas = [
      { type: 'sites', limit: 1, used: 0 },
      null,
      { type: 'builds', limit: 5, used: 3 },
      { type: undefined as unknown as QuotaType, limit: 10, used: 2 },
    ];
    const r = quotaSummary(quotas as unknown as Quota[]);
    expect(r.total).toBe(2);
    expect(r.exceeded).toBe(0);
  });
});

describe('FREE_QUOTAS', () => {
  it('defines all five quota types', () => {
    expect(FREE_QUOTAS.map((q) => q.type).sort()).toEqual([
      'ai_calls',
      'builds',
      'emails',
      'sites',
      'storage_mb',
    ]);
  });

  it('free tier has sites:1, builds:5, ai_calls:10, emails:100, storage_mb:10', () => {
    const byType = new Map(FREE_QUOTAS.map((q) => [q.type, q]));
    expect(byType.get('sites')?.limit).toBe(1);
    expect(byType.get('builds')?.limit).toBe(5);
    expect(byType.get('ai_calls')?.limit).toBe(10);
    expect(byType.get('emails')?.limit).toBe(100);
    expect(byType.get('storage_mb')?.limit).toBe(10);
  });

  it('all quotas start at zero used', () => {
    for (const q of FREE_QUOTAS) {
      expect(q.used).toBe(0);
    }
  });
});
