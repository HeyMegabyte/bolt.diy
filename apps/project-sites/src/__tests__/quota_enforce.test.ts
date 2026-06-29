/**
 * Quota enforcement toolkit — pure helpers for runtime quota checks,
 * human-readable messages, and RFC7807-style block envelopes.
 */
import {
  checkQuota,
  exceededMessage,
  quotaBlock,
  type QuotaType,
  type PlanTier,
} from '../services/quota_enforce.js';

describe('checkQuota', () => {
  it('returns isExceeded=true when used >= limit', () => {
    expect(checkQuota(10, 10).isExceeded).toBe(true);
    expect(checkQuota(12, 10).isExceeded).toBe(true);
    expect(checkQuota(0, 0).isExceeded).toBe(false); // limit 0 → not exceeded
  });

  it('returns isExceeded=false when used < limit', () => {
    expect(checkQuota(0, 10).isExceeded).toBe(false);
    expect(checkQuota(4, 10).isExceeded).toBe(false);
    expect(checkQuota(9, 10).isExceeded).toBe(false);
  });

  it('computes remaining units correctly', () => {
    expect(checkQuota(3, 10).remaining).toBe(7);
    expect(checkQuota(10, 10).remaining).toBe(0);
    expect(checkQuota(15, 10).remaining).toBe(0);
    expect(checkQuota(0, 5).remaining).toBe(5);
  });

  it('computes utilizationPercent correctly', () => {
    expect(checkQuota(0, 10).utilizationPercent).toBe(0);
    expect(checkQuota(5, 10).utilizationPercent).toBe(50);
    expect(checkQuota(10, 10).utilizationPercent).toBe(100);
    expect(checkQuota(15, 10).utilizationPercent).toBe(100);
    expect(checkQuota(1, 3).utilizationPercent).toBeCloseTo(33.33, 1);
  });

  it('clamps negative used to 0', () => {
    const r = checkQuota(-5, 10);
    expect(r.used).toBe(0);
    expect(r.remaining).toBe(10);
    expect(r.isExceeded).toBe(false);
  });

  it('treats zero or negative limit as unlimited (never exceeded)', () => {
    expect(checkQuota(100, 0).isExceeded).toBe(false);
    expect(checkQuota(100, 0).limit).toBe(0);
    expect(checkQuota(100, -1).isExceeded).toBe(false);
    expect(checkQuota(100, -1).limit).toBe(0);
  });

  it('handles non-finite inputs gracefully', () => {
    expect(checkQuota(Infinity, 10).isExceeded).toBe(true);
    expect(checkQuota(NaN, 10).isExceeded).toBe(false);
    expect(checkQuota(5, NaN).isExceeded).toBe(false);
    expect(checkQuota(5, Infinity).limit).toBe(Infinity);
  });

  it('returns all expected fields', () => {
    const r = checkQuota(7, 10);
    expect(r).toHaveProperty('isExceeded');
    expect(r).toHaveProperty('used');
    expect(r).toHaveProperty('limit');
    expect(r).toHaveProperty('remaining');
    expect(r).toHaveProperty('utilizationPercent');
  });
});

describe('exceededMessage', () => {
  it('generates a past-limit message when at capacity', () => {
    const msg = exceededMessage('sites', 5, 3);
    expect(msg).toContain("You've used 5 of 3 sites");
    expect(msg).toContain('Upgrade your plan');
  });

  it('generates a past-limit message when exactly at limit', () => {
    const msg = exceededMessage('images', 10, 10);
    expect(msg).toContain("You've used 10 of 10 images");
    expect(msg).toContain('Upgrade your plan');
  });

  it('generates a purely informational message when under limit', () => {
    const msg = exceededMessage('pages', 2, 10);
    expect(msg).toContain("You've used 2 of 10 pages");
    expect(msg).not.toContain('Upgrade your plan');
  });

  it('reports unlimited when limit is 0', () => {
    const msg = exceededMessage('storage_mb', 50, 0);
    expect(msg).toContain('unlimited');
    expect(msg).toContain('Storage');
  });

  it('reports unlimited when limit is negative', () => {
    const msg = exceededMessage('api_tokens', 10, -1);
    expect(msg).toContain('unlimited');
  });

  it('handles all QuotaType labels gracefully', () => {
    const types: QuotaType[] = [
      'sites',
      'pages',
      'images',
      'storage_mb',
      'custom_domains',
      'team_members',
      'builds_per_day',
      'emails_per_day',
      'api_tokens',
    ];
    for (const t of types) {
      const msg = exceededMessage(t, 1, 5);
      expect(msg).toBeTruthy();
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(10);
    }
  });

  it('clamps negative used to 0 for the message', () => {
    const msg = exceededMessage('sites', -3, 10);
    expect(msg).toContain("You've used 0 of 10 sites");
  });

  it('handles non-finite used gracefully', () => {
    const msg = exceededMessage('pages', NaN, 10);
    expect(msg).toContain("You've used 0 of 10 pages");
  });

  it('capitalizes the first word in the unlimited message', () => {
    const msg = exceededMessage('team_members', 0, 0);
    expect(msg[0]).toBe('T'); // "Team members is unlimited..."
  });
});

describe('quotaBlock', () => {
  it('returns an RFC7807-style error envelope', () => {
    const block = quotaBlock('sites', 'free');
    expect(block).toHaveProperty('error');
    expect(block.error).toHaveProperty('code', 'QUOTA_EXCEEDED');
    expect(block.error).toHaveProperty('message');
    expect(block.error).toHaveProperty('type');
    expect(block.error).toHaveProperty('used');
    expect(block.error).toHaveProperty('limit');
    expect(block.error).toHaveProperty('plan');
    expect(block.error).toHaveProperty('suggestion');
  });

  it('includes the resource type and plan in the envelope', () => {
    const block = quotaBlock('custom_domains', 'starter');
    expect(block.error.type).toBe('custom_domains');
    expect(block.error.plan).toBe('starter');
  });

  it('suggests upgrading for non-enterprise plans', () => {
    const free = quotaBlock('pages', 'free');
    expect(free.error.suggestion).toContain('Upgrade your plan');

    const starter = quotaBlock('pages', 'starter');
    expect(starter.error.suggestion).toContain('Upgrade your plan');

    const pro = quotaBlock('pages', 'pro');
    expect(pro.error.suggestion).toContain('Upgrade your plan');
  });

  it('suggests contacting support for enterprise plans', () => {
    const block = quotaBlock('storage_mb', 'enterprise');
    expect(block.error.suggestion).toContain('Contact support');
  });

  it('handles every PlanTier without throwing', () => {
    const tiers: PlanTier[] = ['free', 'starter', 'pro', 'enterprise'];
    for (const plan of tiers) {
      expect(() => quotaBlock('sites', plan)).not.toThrow();
    }
  });

  it('handles every QuotaType without throwing', () => {
    const types: QuotaType[] = [
      'sites',
      'pages',
      'images',
      'storage_mb',
      'custom_domains',
      'team_members',
      'builds_per_day',
      'emails_per_day',
      'api_tokens',
    ];
    for (const t of types) {
      expect(() => quotaBlock(t, 'free')).not.toThrow();
    }
  });
});
