/**
 * @module services/__tests__/activation_scoring.test
 * @description Tests for LOOP-ANALYTICS-009 activation scoring primitive.
 */

import { type ActivationMilestone, classifyActivationLevel, computeActivationScore } from '../activation_scoring';

// ── classifyActivationLevel ───────────────────────────────────────────────

describe('classifyActivationLevel', () => {
  it('0 → cold', () => expect(classifyActivationLevel(0)).toBe('cold'));
  it('14 → cold', () => expect(classifyActivationLevel(14)).toBe('cold'));
  it('15 → warming', () => expect(classifyActivationLevel(15)).toBe('warming'));
  it('39 → warming', () => expect(classifyActivationLevel(39)).toBe('warming'));
  it('40 → engaged', () => expect(classifyActivationLevel(40)).toBe('engaged'));
  it('69 → engaged', () => expect(classifyActivationLevel(69)).toBe('engaged'));
  it('70 → activated', () => expect(classifyActivationLevel(70)).toBe('activated'));
  it('89 → activated', () => expect(classifyActivationLevel(89)).toBe('activated'));
  it('90 → power', () => expect(classifyActivationLevel(90)).toBe('power'));
  it('100 → power', () => expect(classifyActivationLevel(100)).toBe('power'));
});

// ── computeActivationScore ────────────────────────────────────────────────

describe('computeActivationScore', () => {
  it('returns 0 for no milestones', () => {
    const result = computeActivationScore([]);
    expect(result.score).toBe(0);
    expect(result.level).toBe('cold');
    expect(result.completed).toEqual([]);
    expect(result.remaining.length).toBe(12);
    expect(result.nextBestAction).toBe('published_first_site'); // highest weight (20)
  });

  it('returns 5 for signed_up only', () => {
    const result = computeActivationScore(['signed_up']);
    expect(result.score).toBe(5);
    expect(result.level).toBe('cold');
    expect(result.completed).toEqual(['signed_up']);
    expect(result.nextBestAction).toBe('published_first_site');
  });

  it('returns 10 for signed_up + verified_email (5+5)', () => {
    const result = computeActivationScore(['signed_up', 'verified_email']);
    expect(result.score).toBe(10);
    expect(result.level).toBe('cold');
  });

  it('returns 25 for signed_up + verified_email + created_first_site', () => {
    const result = computeActivationScore([
      'signed_up',
      'verified_email',
      'created_first_site',
    ]);
    expect(result.score).toBe(25);
    expect(result.level).toBe('warming');
    expect(result.nextBestAction).toBe('published_first_site');
  });

  it('returns 45 after publishing first site (25+20)', () => {
    const result = computeActivationScore([
      'signed_up',
      'verified_email',
      'created_first_site',
      'published_first_site',
    ]);
    expect(result.score).toBe(45);
    expect(result.level).toBe('engaged');
    expect(result.nextBestAction).toBe('claimed_custom_domain');
  });

  it('returns 60 after custom domain', () => {
    const result = computeActivationScore([
      'signed_up',
      'verified_email',
      'created_first_site',
      'published_first_site',
      'claimed_custom_domain',
    ]);
    expect(result.score).toBe(60);
    expect(result.level).toBe('engaged');
    expect(result.nextBestAction).toBe('invited_teammate');
  });

  it('returns 70 after inviting teammate', () => {
    const result = computeActivationScore([
      'signed_up',
      'verified_email',
      'created_first_site',
      'published_first_site',
      'claimed_custom_domain',
      'invited_teammate',
    ]);
    expect(result.score).toBe(70);
    expect(result.level).toBe('activated');
  });

  it('returns 100 when all milestones complete', () => {
    const all: ActivationMilestone[] = [
      'signed_up',
      'verified_email',
      'created_first_site',
      'published_first_site',
      'claimed_custom_domain',
      'invited_teammate',
      'connected_social',
      'viewed_analytics',
      'started_checkout',
      'completed_checkout',
      'received_first_lead',
      'shared_site',
    ];
    const result = computeActivationScore(all);
    expect(result.score).toBe(100);
    expect(result.level).toBe('power');
    expect(result.remaining).toEqual([]);
    expect(result.nextBestAction).toBeNull();
  });

  it('dedupes duplicate milestones', () => {
    const result = computeActivationScore([
      'signed_up',
      'signed_up',
      'signed_up',
      'verified_email',
    ]);
    expect(result.score).toBe(10); // 5+5, not 5+5+5+5
    expect(result.completed).toHaveLength(2);
  });

  it('ignores unknown milestone strings gracefully', () => {
    const result = computeActivationScore([
      'signed_up' as string,
      'bogus_milestone' as string,
      'verified_email' as string,
    ]);
    expect(result.score).toBe(10);
    expect(result.completed).toEqual(['signed_up', 'verified_email']);
  });

  it('sorts remaining by weight descending', () => {
    const result = computeActivationScore(['signed_up']);
    const weights = result.remaining.map((m) => {
      const w: Record<string, number> = { published_first_site: 20, created_first_site: 15, claimed_custom_domain: 15, invited_teammate: 10, completed_checkout: 10 };
      return w[m] ?? 0;
    });
    // First remaining should be highest weight (20 = published_first_site)
    expect(result.remaining[0]).toBe('published_first_site');
    // Weights should be descending
    for (let i = 1; i < Math.min(weights.length, 5); i++) {
      expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
    }
  });

  it('nextBestAction is the highest-weight remaining', () => {
    const result = computeActivationScore([
      'signed_up',
      'verified_email',
      'published_first_site',
    ]);
    // Remaining highest: created_first_site (15) or claimed_custom_domain (15)
    expect(['created_first_site', 'claimed_custom_domain']).toContain(
      result.nextBestAction,
    );
  });
});
