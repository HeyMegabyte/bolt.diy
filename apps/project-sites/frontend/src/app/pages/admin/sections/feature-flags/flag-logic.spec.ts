import {
  bucketFor,
  isInRollout,
  evaluateEnabled,
  evaluationTrace,
  classifyChange,
  validateConstraints,
  entitlementFor,
  planRank,
} from './flag-logic';

describe('feature-flag flag-logic (pure)', () => {
  describe('bucketFor', () => {
    it('returns a stable integer in [0,99]', () => {
      const a = bucketFor('multi_model_router', 'org-1');
      const b = bucketFor('multi_model_router', 'org-1');
      expect(a).toBe(b);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(99);
    });

    it('varies by flag key and subject', () => {
      const sameSubjectDifferentFlag =
        bucketFor('flag_a', 'org-1') !== bucketFor('flag_b', 'org-1');
      const sameFlagDifferentSubject =
        bucketFor('flag_a', 'org-1') !== bucketFor('flag_a', 'org-2');
      // At least one of the two must differ (collisions are possible but rare).
      expect(sameSubjectDifferentFlag || sameFlagDifferentSubject).toBe(true);
    });
  });

  describe('isInRollout', () => {
    it('0% is never in, 100% is always in', () => {
      expect(isInRollout('f', 's', 0)).toBe(false);
      expect(isInRollout('f', 's', 100)).toBe(false === false ? true : false);
      expect(isInRollout('f', 's', 100)).toBe(true);
    });

    it('clamps out-of-range percentages', () => {
      expect(isInRollout('f', 's', -10)).toBe(false);
      expect(isInRollout('f', 's', 250)).toBe(true);
    });

    it('roughly distributes across the population at 50%', () => {
      let inside = 0;
      const N = 1000;
      for (let i = 0; i < N; i++) {
        if (isInRollout('dist_flag', `user-${i}`, 50)) inside += 1;
      }
      // Expect ~500; allow generous slack for hash distribution.
      expect(inside).toBeGreaterThan(380);
      expect(inside).toBeLessThan(620);
    });
  });

  describe('evaluateEnabled', () => {
    const base = { enabled: true, killSwitch: false, rolloutPercent: 100, flagKey: 'f', subject: 's' };

    it('kill switch forces off regardless of enabled/rollout', () => {
      expect(evaluateEnabled({ ...base, killSwitch: true })).toBe(false);
    });

    it('disabled forces off', () => {
      expect(evaluateEnabled({ ...base, enabled: false })).toBe(false);
    });

    it('enabled + 100% is on', () => {
      expect(evaluateEnabled(base)).toBe(true);
    });

    it('enabled + 0% is off', () => {
      expect(evaluateEnabled({ ...base, rolloutPercent: 0 })).toBe(false);
    });
  });

  describe('evaluationTrace', () => {
    it('ends with final-off on kill switch and stops early', () => {
      const t = evaluationTrace({ enabled: true, killSwitch: true, rolloutPercent: 100, flagKey: 'f', subject: 's' });
      expect(t[t.length - 1].outcome).toBe('final-off');
      expect(t.some((s) => s.label === 'Kill switch' && s.outcome === 'block')).toBe(true);
      // Should NOT have evaluated rollout once kill switch blocked.
      expect(t.some((s) => s.label === 'Rollout')).toBe(false);
    });

    it('ends with final-on when fully enabled at 100%', () => {
      const t = evaluationTrace({ enabled: true, killSwitch: false, rolloutPercent: 100, flagKey: 'f', subject: 's' });
      expect(t[t.length - 1].outcome).toBe('final-on');
    });

    it('explains the rollout bucket decision for a partial rollout', () => {
      const t = evaluationTrace({ enabled: true, killSwitch: false, rolloutPercent: 50, flagKey: 'f', subject: 's' });
      const rollout = t.find((s) => s.label === 'Rollout');
      expect(rollout).toBeTruthy();
      expect(rollout!.detail).toContain('bucket');
    });
  });

  describe('classifyChange', () => {
    const cur = { enabled: false, killSwitch: false, rolloutPercent: 0 };

    it('enabling from off is dangerous', () => {
      expect(classifyChange(cur, { enabled: true })).toBe('dangerous');
    });

    it('flipping kill switch on is dangerous', () => {
      expect(classifyChange(cur, { killSwitch: true })).toBe('dangerous');
    });

    it('a large rollout jump (>=25) is dangerous', () => {
      expect(classifyChange({ ...cur, enabled: true, rolloutPercent: 10 }, { rolloutPercent: 60 })).toBe('dangerous');
    });

    it('a small rollout nudge (<25) is review', () => {
      expect(classifyChange({ ...cur, enabled: true, rolloutPercent: 10 }, { rolloutPercent: 20 })).toBe('review');
    });

    it('disabling is review, restore is review', () => {
      expect(classifyChange({ ...cur, enabled: true, rolloutPercent: 100 }, { enabled: false })).toBe('review');
      expect(classifyChange({ ...cur, killSwitch: true }, { killSwitch: false })).toBe('review');
    });

    it('a no-op is safe', () => {
      expect(classifyChange(cur, {})).toBe('safe');
    });
  });

  describe('validateConstraints', () => {
    const constraints = [
      { key: 'crdt_coedit', requires: ['tenant_hot_state'] },
      { key: 'native_editor', conflictsWith: ['ide_sandbox'] },
    ];

    it('flags a missing dependency', () => {
      const v = validateConstraints({ crdt_coedit: true, tenant_hot_state: false }, constraints);
      expect(v.length).toBe(1);
      expect(v[0].kind).toBe('missing-dependency');
      expect(v[0].other).toBe('tenant_hot_state');
    });

    it('is clean when the dependency is satisfied', () => {
      const v = validateConstraints({ crdt_coedit: true, tenant_hot_state: true }, constraints);
      expect(v).toEqual([]);
    });

    it('flags an incompatibility when both are on', () => {
      const v = validateConstraints({ native_editor: true, ide_sandbox: true }, constraints);
      expect(v.length).toBe(1);
      expect(v[0].kind).toBe('incompatible');
    });

    it('ignores constraints for flags that are off', () => {
      const v = validateConstraints({ crdt_coedit: false, tenant_hot_state: false }, constraints);
      expect(v).toEqual([]);
    });
  });

  describe('entitlementFor', () => {
    it('is available when plan meets the requirement', () => {
      expect(entitlementFor({ plan: 'business', requiredPlan: 'pro' })).toBe('available');
      expect(entitlementFor({ plan: 'pro', requiredPlan: 'pro' })).toBe('available');
    });

    it('requires upgrade when plan is below requirement', () => {
      expect(entitlementFor({ plan: 'free', requiredPlan: 'pro' })).toBe('upgrade-required');
    });

    it('requires add-on when below requirement and feature is an add-on', () => {
      expect(entitlementFor({ plan: 'free', requiredPlan: 'business', isAddon: true })).toBe('addon-required');
    });
  });

  describe('planRank', () => {
    it('orders tiers free < pro < business < enterprise', () => {
      expect(planRank('free')).toBeLessThan(planRank('pro'));
      expect(planRank('pro')).toBeLessThan(planRank('business'));
      expect(planRank('business')).toBeLessThan(planRank('enterprise'));
    });
  });
});
