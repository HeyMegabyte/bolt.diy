import { FEATURE_GATES, featureEnabled, listEnabled } from '../services/feature_gate.js';

describe('FeatureGate — plan-gated feature access evaluator', () => {
  /* ------------------------------------------------------------------ */
  /*  FEATURE_GATES matrix                                               */
  /* ------------------------------------------------------------------ */

  describe('FEATURE_GATES', () => {
    it('exports exactly 6 features', () => {
      expect(FEATURE_GATES).toHaveLength(6);
    });

    it('every entry has all required fields', () => {
      for (const g of FEATURE_GATES) {
        expect(g).toHaveProperty('feature');
        expect(typeof g.feature).toBe('string');
        expect(typeof g.free).toBe('boolean');
        expect(typeof g.starter).toBe('boolean');
        expect(typeof g.pro).toBe('boolean');
      }
    });

    it('contains all expected feature keys', () => {
      const keys = FEATURE_GATES.map((g) => g.feature).sort();
      expect(keys).toEqual([
        'analytics_export',
        'api_access',
        'custom_domain',
        'priority_support',
        'remove_branding',
        'team_seats',
      ]);
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(FEATURE_GATES)).toBe(true);
    });

    it('free plan has all gates set to false', () => {
      for (const g of FEATURE_GATES) {
        expect(g.free).toBe(false);
      }
    });

    it('starter plan enables exactly analytics_export + custom_domain', () => {
      for (const g of FEATURE_GATES) {
        if (g.feature === 'analytics_export' || g.feature === 'custom_domain') {
          expect(g.starter).toBe(true);
        } else {
          expect(g.starter).toBe(false);
        }
      }
    });

    it('pro plan enables all 6 features', () => {
      for (const g of FEATURE_GATES) {
        expect(g.pro).toBe(true);
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /*  featureEnabled                                                     */
  /* ------------------------------------------------------------------ */

  describe('featureEnabled', () => {
    /* ----- Free plan ----- */
    it('returns false for all features on free plan', () => {
      const all: import('../services/feature_gate.js').Feature[] = [
        'analytics_export',
        'custom_domain',
        'remove_branding',
        'priority_support',
        'api_access',
        'team_seats',
      ];
      for (const f of all) {
        expect(featureEnabled(f, 'free')).toBe(false);
      }
    });

    /* ----- Starter plan ----- */
    it('returns true for analytics_export on starter', () => {
      expect(featureEnabled('analytics_export', 'starter')).toBe(true);
    });

    it('returns true for custom_domain on starter', () => {
      expect(featureEnabled('custom_domain', 'starter')).toBe(true);
    });

    it('returns false for remove_branding on starter', () => {
      expect(featureEnabled('remove_branding', 'starter')).toBe(false);
    });

    it('returns false for priority_support on starter', () => {
      expect(featureEnabled('priority_support', 'starter')).toBe(false);
    });

    it('returns false for api_access on starter', () => {
      expect(featureEnabled('api_access', 'starter')).toBe(false);
    });

    it('returns false for team_seats on starter', () => {
      expect(featureEnabled('team_seats', 'starter')).toBe(false);
    });

    /* ----- Pro plan ----- */
    it('returns true for all features on pro plan', () => {
      const all: import('../services/feature_gate.js').Feature[] = [
        'analytics_export',
        'custom_domain',
        'remove_branding',
        'priority_support',
        'api_access',
        'team_seats',
      ];
      for (const f of all) {
        expect(featureEnabled(f, 'pro')).toBe(true);
      }
    });

    /* ----- Case insensitivity ----- */
    it('handles case-insensitive plan names', () => {
      expect(featureEnabled('custom_domain', 'Free')).toBe(false);
      expect(featureEnabled('custom_domain', 'Starter')).toBe(true);
      expect(featureEnabled('custom_domain', 'PRO')).toBe(true);
      expect(featureEnabled('custom_domain', 'StArTeR')).toBe(true);
    });

    it('trims whitespace from plan names', () => {
      expect(featureEnabled('custom_domain', '  free  ')).toBe(false);
      expect(featureEnabled('custom_domain', '\tstarter\n')).toBe(true);
      expect(featureEnabled('custom_domain', ' pro ')).toBe(true);
    });

    /* ----- Edge cases ----- */
    it('returns false for unknown feature keys', () => {
      // @ts-expect-error — testing runtime resilience
      expect(featureEnabled('nonexistent_feature', 'pro')).toBe(false);
    });

    it('returns false (free tier default) for unknown plan names', () => {
      expect(featureEnabled('custom_domain', 'enterprise')).toBe(false);
      expect(featureEnabled('custom_domain', 'premium')).toBe(false);
      expect(featureEnabled('custom_domain', 'gold')).toBe(false);
    });

    it('returns false for empty plan string', () => {
      expect(featureEnabled('custom_domain', '')).toBe(false);
    });

    it('returns false for unknown feature even on unknown plan', () => {
      // @ts-expect-error — testing runtime resilience
      expect(featureEnabled('bogus', 'enterprise')).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  listEnabled                                                        */
  /* ------------------------------------------------------------------ */

  describe('listEnabled', () => {
    it('free returns empty array', () => {
      expect(listEnabled('free')).toEqual([]);
    });

    it('starter returns exactly analytics_export + custom_domain', () => {
      const enabled = listEnabled('starter');
      expect(enabled).toHaveLength(2);
      expect(enabled).toContain('analytics_export');
      expect(enabled).toContain('custom_domain');
    });

    it('pro returns all 6 features', () => {
      const enabled = listEnabled('pro');
      expect(enabled).toHaveLength(6);
      expect(enabled.sort()).toEqual([
        'analytics_export',
        'api_access',
        'custom_domain',
        'priority_support',
        'remove_branding',
        'team_seats',
      ]);
    });

    it('is case-insensitive', () => {
      expect(listEnabled('STARTER')).toEqual(listEnabled('starter'));
      expect(listEnabled('Pro')).toEqual(listEnabled('pro'));
      expect(listEnabled('FREE')).toEqual([]);
    });

    it('trims whitespace from plan', () => {
      expect(listEnabled('  starter  ')).toHaveLength(2);
      expect(listEnabled('\tpro\n')).toHaveLength(6);
    });

    it('returns empty array for unknown plan names', () => {
      expect(listEnabled('enterprise')).toEqual([]);
      expect(listEnabled('premium')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(listEnabled('')).toEqual([]);
    });
  });
});
