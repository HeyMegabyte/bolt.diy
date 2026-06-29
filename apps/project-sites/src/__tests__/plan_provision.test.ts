import {
  planFeatures,
  provision,
  PLAN_FEATURES,
  ALL_FEATURES,
  type ProvisionRequest,
} from '../services/plan_provision.js';

describe('PlanProvision (A8 — plan-based feature provisioning matrix)', () => {
  describe('ALL_FEATURES', () => {
    it('contains exactly 7 features', () => {
      expect(ALL_FEATURES).toHaveLength(7);
    });

    it('includes all expected feature keys', () => {
      expect(ALL_FEATURES).toEqual(
        expect.arrayContaining([
          'custom_domain',
          'analytics_export',
          'remove_branding',
          'priority_build',
          'advanced_seo',
          'premium_support',
          'form_builder',
        ]),
      );
    });
  });

  describe('PLAN_FEATURES matrix', () => {
    it('free has no features', () => {
      expect(PLAN_FEATURES.free).toEqual([]);
    });

    it('starter has exactly 2 features', () => {
      expect(PLAN_FEATURES.starter).toEqual(['custom_domain', 'analytics_export']);
    });

    it('pro has all 7 features', () => {
      expect(PLAN_FEATURES.pro).toHaveLength(7);
      expect(PLAN_FEATURES.pro).toEqual(expect.arrayContaining(ALL_FEATURES));
    });

    it('every pro feature is a valid ProvisionFeature', () => {
      for (const f of PLAN_FEATURES.pro) {
        expect(ALL_FEATURES).toContain(f);
      }
    });
  });

  describe('planFeatures', () => {
    it('returns empty array for free', () => {
      expect(planFeatures('free')).toEqual([]);
    });

    it('returns starter features for "starter" (case-insensitive)', () => {
      expect(planFeatures('starter')).toEqual(['custom_domain', 'analytics_export']);
      expect(planFeatures('Starter')).toEqual(['custom_domain', 'analytics_export']);
      expect(planFeatures('STARTER')).toEqual(['custom_domain', 'analytics_export']);
    });

    it('returns all 7 pro features for "pro" (case-insensitive)', () => {
      const result = planFeatures('pro');
      expect(result).toHaveLength(7);
      expect(planFeatures('Pro')).toEqual(result);
      expect(planFeatures('PRO')).toEqual(result);
    });

    it('returns empty array for unknown plans', () => {
      expect(planFeatures('enterprise')).toEqual([]);
      expect(planFeatures('premium')).toEqual([]);
      expect(planFeatures('team')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(planFeatures('')).toEqual([]);
    });
  });

  describe('provision', () => {
    const orgA = 'org_a';
    const orgB = 'org_b';

    it('provisions all requested features when every feature is on the plan (pro)', () => {
      const result = provision({
        plan: 'pro',
        features: ['custom_domain', 'analytics_export', 'advanced_seo'],
        orgId: orgA,
      });
      expect(result.provisioned).toEqual(
        expect.arrayContaining(['custom_domain', 'analytics_export', 'advanced_seo']),
      );
      expect(result.provisioned).toHaveLength(3);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('provisions matching features and skips non-plan features (starter)', () => {
      const result = provision({
        plan: 'starter',
        features: ['custom_domain', 'advanced_seo', 'premium_support'],
        orgId: orgA,
      });
      expect(result.provisioned).toEqual(['custom_domain']);
      expect(result.skipped).toEqual(['advanced_seo', 'premium_support']);
      expect(result.errors).toEqual([]);
    });

    it('skips everything on the free plan', () => {
      const result = provision({
        plan: 'free',
        features: ['custom_domain', 'analytics_export'],
        orgId: orgA,
      });
      expect(result.provisioned).toEqual([]);
      expect(result.skipped).toEqual(['custom_domain', 'analytics_export']);
      expect(result.errors).toEqual([]);
    });

    it('skips unknown feature keys regardless of plan', () => {
      const result = provision({
        plan: 'pro',
        features: ['custom_domain', 'unknown_feature', 'nonexistent'],
        orgId: orgA,
      });
      expect(result.provisioned).toEqual(['custom_domain']);
      expect(result.skipped).toEqual(['unknown_feature', 'nonexistent']);
    });

    it('handles empty feature list gracefully', () => {
      const result = provision({ plan: 'pro', features: [], orgId: orgA });
      expect(result.provisioned).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('handles unknown plan by falling back to free (skip everything)', () => {
      const result = provision({
        plan: 'enterprise',
        features: ['custom_domain', 'analytics_export'],
        orgId: orgB,
      });
      expect(result.provisioned).toEqual([]);
      expect(result.skipped).toEqual(['custom_domain', 'analytics_export']);
    });

    it('provisions all 7 pro features when requested', () => {
      const result = provision({
        plan: 'pro',
        features: [
          'custom_domain',
          'analytics_export',
          'remove_branding',
          'priority_build',
          'advanced_seo',
          'premium_support',
          'form_builder',
        ],
        orgId: orgA,
      });
      expect(result.provisioned).toHaveLength(7);
      expect(result.skipped).toEqual([]);
    });

    it('returns frozen arrays (immutability contract)', () => {
      const result = provision({ plan: 'free', features: ['custom_domain'], orgId: orgA });
      expect(Object.isFrozen(result.provisioned)).toBe(true);
      expect(Object.isFrozen(result.skipped)).toBe(true);
      expect(Object.isFrozen(result.errors)).toBe(true);
    });
  });
});
