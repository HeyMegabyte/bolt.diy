import {
  FEATURE_MATRIX,
  getLimit,
  getFeatureLabel,
  isFeatureAvailable,
  usageDescription,
  normalizePlan,
} from '../services/plan_entitlement.js';

describe('PlanEntitlement (A7 — plan entitlement matrix)', () => {
  /* ------------------------------------------------------------------ */
  /*  Matrix shape                                                      */
  /* ------------------------------------------------------------------ */

  describe('FEATURE_MATRIX', () => {
    it('exports exactly 10 features', () => {
      expect(FEATURE_MATRIX).toHaveLength(10);
    });

    it('every entry has all required fields', () => {
      for (const f of FEATURE_MATRIX) {
        expect(f).toHaveProperty('key');
        expect(f).toHaveProperty('label');
        expect(typeof f.free).toBe('number');
        expect(typeof f.starter).toBe('number');
        expect(typeof f.pro).toBe('number');
        expect(f).toHaveProperty('unit');
        expect(f).toHaveProperty('upgradeDescription');
      }
    });

    it('every entry has a non-empty label', () => {
      for (const f of FEATURE_MATRIX) {
        expect(f.label.length).toBeGreaterThan(0);
      }
    });

    it('every entry has a non-empty upgradeDescription', () => {
      for (const f of FEATURE_MATRIX) {
        expect(f.upgradeDescription.length).toBeGreaterThan(0);
      }
    });

    it('contains all expected feature keys', () => {
      const keys = FEATURE_MATRIX.map((f) => f.key).sort();
      expect(keys).toEqual([
        'ai_credits',
        'analytics_history_days',
        'builds_per_month',
        'custom_domain',
        'email_sends_per_month',
        'media_storage_mb',
        'priority_build',
        'remove_branding',
        'sites',
        'team_seats',
      ]);
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(FEATURE_MATRIX)).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getLimit                                                          */
  /* ------------------------------------------------------------------ */

  describe('getLimit', () => {
    it('returns 1 site for free', () => {
      expect(getLimit('sites', 'free')).toBe(1);
    });

    it('returns 3 sites for starter', () => {
      expect(getLimit('sites', 'starter')).toBe(3);
    });

    it('returns -1 (unlimited) sites for pro', () => {
      expect(getLimit('sites', 'pro')).toBe(-1);
    });

    it('returns 0 custom domain for free (unavailable)', () => {
      expect(getLimit('custom_domain', 'free')).toBe(0);
    });

    it('returns 1 custom domain for starter', () => {
      expect(getLimit('custom_domain', 'starter')).toBe(1);
    });

    it('returns -1 custom domains for pro', () => {
      expect(getLimit('custom_domain', 'pro')).toBe(-1);
    });

    it('returns 5 monthly builds for free', () => {
      expect(getLimit('builds_per_month', 'free')).toBe(5);
    });

    it('returns 0 remove_branding for free (unavailable)', () => {
      expect(getLimit('remove_branding', 'free')).toBe(0);
    });

    it('returns 0 remove_branding for starter (unavailable)', () => {
      expect(getLimit('remove_branding', 'starter')).toBe(0);
    });

    it('returns 1 remove_branding for pro', () => {
      expect(getLimit('remove_branding', 'pro')).toBe(1);
    });

    it('returns 0 priority_build for free', () => {
      expect(getLimit('priority_build', 'free')).toBe(0);
    });

    it('returns 1 priority_build for pro', () => {
      expect(getLimit('priority_build', 'pro')).toBe(1);
    });

    it('returns 0 for unknown feature key', () => {
      // @ts-expect-error — testing runtime resilience for unknown keys
      expect(getLimit('nonexistent_feature', 'free')).toBe(0);
    });

    describe('analytics_history_days', () => {
      it('free = 7 days', () => expect(getLimit('analytics_history_days', 'free')).toBe(7));
      it('starter = 90 days', () => expect(getLimit('analytics_history_days', 'starter')).toBe(90));
      it('pro = 730 days', () => expect(getLimit('analytics_history_days', 'pro')).toBe(730));
    });

    describe('media_storage_mb', () => {
      it('free = 10 MB', () => expect(getLimit('media_storage_mb', 'free')).toBe(10));
      it('starter = 500 MB', () => expect(getLimit('media_storage_mb', 'starter')).toBe(500));
      it('pro = 5000 MB', () => expect(getLimit('media_storage_mb', 'pro')).toBe(5000));
    });

    describe('team_seats', () => {
      it('free = 1 seat', () => expect(getLimit('team_seats', 'free')).toBe(1));
      it('starter = 2 seats', () => expect(getLimit('team_seats', 'starter')).toBe(2));
      it('pro = 10 seats', () => expect(getLimit('team_seats', 'pro')).toBe(10));
    });

    describe('email_sends_per_month', () => {
      it('free = 100 sends', () => expect(getLimit('email_sends_per_month', 'free')).toBe(100));
      it('starter = 1000 sends', () =>
        expect(getLimit('email_sends_per_month', 'starter')).toBe(1000));
      it('pro = 50000 sends', () => expect(getLimit('email_sends_per_month', 'pro')).toBe(50000));
    });

    describe('ai_credits', () => {
      it('free = 10', () => expect(getLimit('ai_credits', 'free')).toBe(10));
      it('starter = 500', () => expect(getLimit('ai_credits', 'starter')).toBe(500));
      it('pro = 10000', () => expect(getLimit('ai_credits', 'pro')).toBe(10000));
    });
  });

  /* ------------------------------------------------------------------ */
  /*  getFeatureLabel                                                    */
  /* ------------------------------------------------------------------ */

  describe('getFeatureLabel', () => {
    it('returns "Sites" for sites', () => {
      expect(getFeatureLabel('sites')).toBe('Sites');
    });

    it('returns "AI Credits" for ai_credits', () => {
      expect(getFeatureLabel('ai_credits')).toBe('AI Credits');
    });

    it('returns "Analytics History" for analytics_history_days', () => {
      expect(getFeatureLabel('analytics_history_days')).toBe('Analytics History');
    });

    it('falls back to the key itself for unknown features', () => {
      // @ts-expect-error — testing runtime resilience
      expect(getFeatureLabel('unknown_key')).toBe('unknown_key');
    });

    it('all labels are non-empty', () => {
      for (const f of FEATURE_MATRIX) {
        expect(getFeatureLabel(f.key).length).toBeGreaterThan(0);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  isFeatureAvailable                                                 */
  /* ------------------------------------------------------------------ */

  describe('isFeatureAvailable', () => {
    it('custom_domain is unavailable on free', () => {
      expect(isFeatureAvailable('custom_domain', 'free')).toBe(false);
    });

    it('custom_domain is available on starter', () => {
      expect(isFeatureAvailable('custom_domain', 'starter')).toBe(true);
    });

    it('custom_domain is available on pro', () => {
      expect(isFeatureAvailable('custom_domain', 'pro')).toBe(true);
    });

    it('remove_branding is unavailable on free', () => {
      expect(isFeatureAvailable('remove_branding', 'free')).toBe(false);
    });

    it('remove_branding is available on pro', () => {
      expect(isFeatureAvailable('remove_branding', 'pro')).toBe(true);
    });

    it('sites is available on all plans (free=1, starter=3, pro=-1)', () => {
      expect(isFeatureAvailable('sites', 'free')).toBe(true);
      expect(isFeatureAvailable('sites', 'starter')).toBe(true);
      expect(isFeatureAvailable('sites', 'pro')).toBe(true);
    });

    it('returns false for unknown features', () => {
      // @ts-expect-error — testing runtime resilience
      expect(isFeatureAvailable('unknown', 'free')).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  usageDescription                                                   */
  /* ------------------------------------------------------------------ */

  describe('usageDescription', () => {
    it('describes partial usage on a limited plan', () => {
      expect(usageDescription('builds_per_month', 'free', 3)).toBe('3 of 5 builds used');
    });

    it('describes full usage on a limited plan', () => {
      expect(usageDescription('builds_per_month', 'free', 5)).toBe('5 of 5 builds used');
    });

    it('describes zero usage on a limited plan', () => {
      expect(usageDescription('email_sends_per_month', 'free', 0)).toBe('0 of 100 sends used');
    });

    it('describes unlimited usage on pro', () => {
      expect(usageDescription('sites', 'pro', 12)).toBe('12 sites (unlimited)');
    });

    it('describes zero usage on unlimited', () => {
      expect(usageDescription('sites', 'pro', 0)).toBe('0 sites (unlimited)');
    });

    it('handles negative used by clamping to 0', () => {
      expect(usageDescription('sites', 'free', -5)).toBe('0 of 1 sites used');
    });

    it('handles binary features (remove_branding)', () => {
      expect(usageDescription('remove_branding', 'pro', 0)).toBe('0 of 1 remove branding used');
      expect(usageDescription('remove_branding', 'free', 0)).toBe('0 of 0 remove branding used');
    });

    it('falls back gracefully for unknown features', () => {
      // @ts-expect-error — testing runtime resilience
      expect(usageDescription('bogus', 'free', 2)).toBe('2 of 0 used');
    });

    it('produces correct strings for every feature on every plan', () => {
      const cases: Array<{
        feature: 'builds_per_month' | 'email_sends_per_month' | 'sites';
        plan: 'free' | 'starter' | 'pro';
        used: number;
        expected: string;
      }> = [
        {
          feature: 'builds_per_month',
          plan: 'starter',
          used: 25,
          expected: '25 of 50 builds used',
        },
        { feature: 'builds_per_month', plan: 'pro', used: 300, expected: '300 of 500 builds used' },
        {
          feature: 'email_sends_per_month',
          plan: 'starter',
          used: 500,
          expected: '500 of 1000 sends used',
        },
        {
          feature: 'email_sends_per_month',
          plan: 'pro',
          used: 50000,
          expected: '50000 of 50000 sends used',
        },
        { feature: 'sites', plan: 'free', used: 0, expected: '0 of 1 sites used' },
        { feature: 'sites', plan: 'starter', used: 2, expected: '2 of 3 sites used' },
      ];
      for (const c of cases) {
        expect(usageDescription(c.feature, c.plan, c.used)).toBe(c.expected);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  normalizePlan                                                      */
  /* ------------------------------------------------------------------ */

  describe('normalizePlan', () => {
    it('returns starter for "starter" (case-insensitive)', () => {
      expect(normalizePlan('starter')).toBe('starter');
      expect(normalizePlan('Starter')).toBe('starter');
      expect(normalizePlan('STARTER')).toBe('starter');
    });

    it('returns pro for "pro" (case-insensitive)', () => {
      expect(normalizePlan('pro')).toBe('pro');
      expect(normalizePlan('Pro')).toBe('pro');
      expect(normalizePlan('PRO')).toBe('pro');
    });

    it('returns free for unknown strings', () => {
      expect(normalizePlan('enterprise')).toBe('free');
      expect(normalizePlan('premium')).toBe('free');
      expect(normalizePlan('gold')).toBe('free');
    });

    it('returns free for empty string', () => {
      expect(normalizePlan('')).toBe('free');
    });

    it('returns free for null', () => {
      expect(normalizePlan(null)).toBe('free');
    });

    it('returns free for undefined', () => {
      expect(normalizePlan(undefined)).toBe('free');
    });

    it('trims whitespace before matching', () => {
      expect(normalizePlan('  Pro  ')).toBe('pro');
      expect(normalizePlan('\tstarter\n')).toBe('starter');
    });
  });
});
