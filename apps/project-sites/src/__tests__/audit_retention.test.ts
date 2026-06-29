import {
  checkRetention,
  expiredEvents,
  policySummary,
  DEFAULT_RULES,
} from '../services/audit_retention.js';

describe('checkRetention (audit log retention policy engine)', () => {
  // Fixed reference timestamps (all UTC)
  const T0 = Date.parse('2026-06-01T12:00:00.000Z'); // epoch = 1748779200000
  const T0_PLUS_89D = Date.parse('2026-08-29T12:00:00.000Z');
  const T0_PLUS_90D = Date.parse('2026-08-30T12:00:00.000Z');
  const T0_PLUS_91D = Date.parse('2026-08-31T12:00:00.000Z');
  const T0_PLUS_180D = Date.parse('2026-11-28T12:00:00.000Z');
  const T0_PLUS_181D = Date.parse('2026-11-29T12:00:00.000Z');
  const T0_PLUS_365D = Date.parse('2027-06-01T12:00:00.000Z');
  const T0_PLUS_366D = Date.parse('2027-06-02T12:00:00.000Z');

  describe('default rules', () => {
    it('sign_in expires after 90 days (before = not expired)', () => {
      const r = checkRetention('sign_in', '2026-06-01T12:00:00.000Z', undefined, T0_PLUS_89D);
      expect(r.retainDays).toBe(90);
      expect(r.expired).toBe(false);
      expect(r.expiresAt).toBe('2026-08-30T12:00:00.000Z');
    });

    it('sign_in at exactly 90 days is not yet expired (expires after N days)', () => {
      const r = checkRetention('sign_in', '2026-06-01T12:00:00.000Z', undefined, T0_PLUS_90D);
      expect(r.expired).toBe(false);
    });

    it('sign_in expired after 90 days', () => {
      const r = checkRetention('sign_in', '2026-06-01T12:00:00.000Z', undefined, T0_PLUS_91D);
      expect(r.expired).toBe(true);
    });

    it('billing_change expires after 365 days', () => {
      const r1 = checkRetention(
        'billing_change',
        '2026-06-01T12:00:00.000Z',
        undefined,
        T0_PLUS_365D,
      );
      expect(r1.expired).toBe(false);
      expect(r1.retainDays).toBe(365);
      expect(r1.expiresAt).toBe('2027-06-01T12:00:00.000Z');

      const r2 = checkRetention(
        'billing_change',
        '2026-06-01T12:00:00.000Z',
        undefined,
        T0_PLUS_366D,
      );
      expect(r2.expired).toBe(true);
    });

    it('site_delete expires after 30 days', () => {
      const r = checkRetention('site_delete', '2026-06-01T12:00:00.000Z');
      expect(r.retainDays).toBe(30);
      expect(r.expiresAt).toBe('2026-07-01T12:00:00.000Z');
    });

    it('api_call expires after 30 days', () => {
      const r = checkRetention('api_call', '2026-06-01T12:00:00.000Z');
      expect(r.retainDays).toBe(30);
      expect(r.expiresAt).toBe('2026-07-01T12:00:00.000Z');
    });

    it('falls back to * default (180 days) for unmatched actions', () => {
      const r1 = checkRetention('site_create', '2026-06-01T12:00:00.000Z', undefined, T0_PLUS_180D);
      expect(r1.retainDays).toBe(180);
      expect(r1.expired).toBe(false);

      const r2 = checkRetention('site_create', '2026-06-01T12:00:00.000Z', undefined, T0_PLUS_181D);
      expect(r2.expired).toBe(true);
    });

    it('domain_add falls back to * default (180 days)', () => {
      const r = checkRetention('domain_add', '2026-06-01T12:00:00.000Z', undefined, T0_PLUS_180D);
      expect(r.retainDays).toBe(180);
      expect(r.expired).toBe(false);
    });

    it('flag_change falls back to * default (180 days)', () => {
      const r = checkRetention('flag_change', '2026-06-01T12:00:00.000Z', undefined, T0_PLUS_180D);
      expect(r.retainDays).toBe(180);
    });

    it('sign_out falls back to * default (180 days)', () => {
      const r = checkRetention('sign_out', '2026-06-01T12:00:00.000Z');
      expect(r.retainDays).toBe(180);
    });
  });

  describe('custom rules', () => {
    it('uses provided rules instead of defaults', () => {
      const rules = [
        { action: 'site_create' as const, retainDays: 7 },
        { action: '*' as const, retainDays: 14 },
      ];
      const r = checkRetention('site_create', '2026-06-01T12:00:00.000Z', rules);
      expect(r.retainDays).toBe(7);
      expect(r.expiresAt).toBe('2026-06-08T12:00:00.000Z');
    });

    it('falls back to * when action has no specific rule', () => {
      const rules = [
        { action: 'site_create' as const, retainDays: 7 },
        { action: '*' as const, retainDays: 14 },
      ];
      const r = checkRetention('sign_in', '2026-06-01T12:00:00.000Z', rules);
      expect(r.retainDays).toBe(14);
    });

    it('uses 180 default fallback when no * rule exists either', () => {
      const rules = [{ action: 'site_create' as const, retainDays: 7 }];
      const r = checkRetention('sign_in', '2026-06-01T12:00:00.000Z', rules);
      expect(r.retainDays).toBe(180);
    });

    it('handles empty rules array', () => {
      const rules: { action: '*'; retainDays: number }[] = [];
      const r = checkRetention('sign_in', '2026-06-01T12:00:00.000Z', rules);
      expect(r.retainDays).toBe(180);
    });
  });

  describe('retainDays=0 (delete immediately)', () => {
    it('expires immediately when retainDays is 0', () => {
      const rules = [{ action: 'temp_event' as never, retainDays: 0 }];
      const r = checkRetention('temp_event', '2026-06-01T12:00:00.000Z', rules);
      expect(r.retainDays).toBe(0);
      expect(r.expired).toBe(true);
      expect(r.expiresAt).toBe('2026-06-01T12:00:00.000Z');
    });
  });

  describe('nowMs determinism', () => {
    it('uses nowMs when provided (deterministic)', () => {
      const createdAt = '2026-06-01T12:00:00.000Z';
      // nowMs = createdAt — should NOT be expired
      const r = checkRetention('sign_in', createdAt, undefined, Date.parse(createdAt));
      expect(r.expired).toBe(false);
      expect(r.expiresAt).toBe('2026-08-30T12:00:00.000Z');
    });
  });

  describe('invalid createdAt handling (never throws)', () => {
    it('handles empty string — never expired', () => {
      const r = checkRetention('sign_in', '', undefined, T0_PLUS_366D);
      expect(r.expired).toBe(false);
      expect(r.expiresAt).toBe('2999-12-31T23:59:59.999Z');
      expect(r.retainDays).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('handles gibberish string — never expired', () => {
      const r = checkRetention('sign_in', 'not-a-date', undefined, T0_PLUS_366D);
      expect(r.expired).toBe(false);
      expect(r.expiresAt).toBe('2999-12-31T23:59:59.999Z');
    });

    it('handles null-like values — never expired', () => {
      const r = checkRetention('sign_in', String(null), undefined, T0_PLUS_366D);
      expect(r.expired).toBe(false);
    });
  });

  describe('RetentionCheck shape', () => {
    it('returns all required fields', () => {
      const r = checkRetention('sign_in', '2026-06-01T12:00:00.000Z');
      expect(r).toHaveProperty('action', 'sign_in');
      expect(r).toHaveProperty('createdAt', '2026-06-01T12:00:00.000Z');
      expect(r).toHaveProperty('expiresAt');
      expect(r).toHaveProperty('retainDays');
      expect(r).toHaveProperty('expired');
    });
  });
});

describe('expiredEvents', () => {
  const T0 = Date.parse('2026-06-01T12:00:00.000Z');
  const NOW = T0 + 100 * 86_400_000; // 100 days later — past 90d, before 180d

  it('returns indexes of expired events', () => {
    const events = [
      { action: 'sign_in', createdAt: '2026-06-01T12:00:00.000Z' }, // 90d → expired at 100d
      { action: 'billing_change', createdAt: '2026-06-01T12:00:00.000Z' }, // 365d → not expired
      { action: 'api_call', createdAt: '2026-06-01T12:00:00.000Z' }, // 30d → expired
    ];
    const indexes = expiredEvents(events, undefined, NOW);
    expect(indexes).toEqual([0, 2]);
  });

  it('returns empty array when nothing is expired', () => {
    const events = [
      { action: 'sign_in', createdAt: '2026-06-28T12:00:00.000Z' }, // just created
    ];
    const indexes = expiredEvents(events, undefined, Date.parse('2026-06-28T12:00:00.000Z'));
    expect(indexes).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const indexes = expiredEvents([], undefined, Date.now());
    expect(indexes).toEqual([]);
  });

  it('handles custom rules', () => {
    const rules = [{ action: 'site_create' as const, retainDays: 3 }];
    const events = [{ action: 'site_create', createdAt: '2026-06-01T12:00:00.000Z' }];
    const indexes = expiredEvents(events, rules, Date.parse('2026-06-10T12:00:00.000Z'));
    expect(indexes).toEqual([0]);
  });

  it('never expires an event with invalid createdAt', () => {
    const events = [
      { action: 'sign_in', createdAt: '' },
      { action: 'api_call', createdAt: 'not-a-date' },
    ];
    const indexes = expiredEvents(events, undefined, Date.now() + 999_999_999);
    expect(indexes).toEqual([]);
  });
});

describe('policySummary', () => {
  it('returns default rules summary', () => {
    const summary = policySummary();
    expect(summary).toContain('sign_in: 90 days');
    expect(summary).toContain('billing_change: 365 days');
    expect(summary).toContain('site_delete: 30 days');
    expect(summary).toContain('api_call: 30 days');
    expect(summary).toContain('default: 180 days');
  });

  it('formats custom rules', () => {
    const rules = [
      { action: 'site_create' as const, retainDays: 7 },
      { action: '*' as const, retainDays: 30 },
    ];
    const summary = policySummary(rules);
    expect(summary).toBe('site_create: 7 days | default: 30 days');
  });

  it('handles retainDays=0 in summary', () => {
    const rules = [
      { action: 'temp_event' as never, retainDays: 0 },
      { action: '*' as const, retainDays: 30 },
    ];
    const summary = policySummary(rules);
    expect(summary).toContain('temp_event: delete immediately');
  });

  it('handles retainDays=1 with singular "day"', () => {
    const rules = [
      { action: 'site_create' as const, retainDays: 1 },
      { action: '*' as const, retainDays: 30 },
    ];
    const summary = policySummary(rules);
    expect(summary).toContain('site_create: 1 day');
  });

  it('handles empty rules', () => {
    const summary = policySummary([]);
    expect(summary).toBe('');
  });

  it('lists default rules in correct order (specific before catch-all)', () => {
    const summary = policySummary();
    const defaultIdx = summary.indexOf('default:');
    const billingIdx = summary.indexOf('billing_change:');
    expect(billingIdx).toBeLessThan(defaultIdx); // specific before *
  });
});

describe('DEFAULT_RULES', () => {
  it('is frozen and immutable', () => {
    expect(Object.isFrozen(DEFAULT_RULES)).toBe(true);
    expect(DEFAULT_RULES).toHaveLength(5);
  });

  it('contains the expected rules', () => {
    const signIn = DEFAULT_RULES.find((r) => r.action === 'sign_in');
    expect(signIn?.retainDays).toBe(90);

    const billing = DEFAULT_RULES.find((r) => r.action === 'billing_change');
    expect(billing?.retainDays).toBe(365);

    const siteDel = DEFAULT_RULES.find((r) => r.action === 'site_delete');
    expect(siteDel?.retainDays).toBe(30);

    const apiCall = DEFAULT_RULES.find((r) => r.action === 'api_call');
    expect(apiCall?.retainDays).toBe(30);

    const fallback = DEFAULT_RULES.find((r) => r.action === '*');
    expect(fallback?.retainDays).toBe(180);
  });
});
