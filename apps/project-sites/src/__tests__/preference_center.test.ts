import {
  ALL_CHANNELS,
  ALL_PREFERENCE_KEYS,
  DEFAULTS,
  resolvePrefs,
  validatePrefs,
  type PreferenceSet,
} from '../services/preference_center.js';

describe('preference_center (LM14 — psnotify channel prefs)', () => {
  describe('ALL_CHANNELS', () => {
    it('has exactly 4 channels', () => {
      expect(ALL_CHANNELS).toHaveLength(4);
    });

    it('contains email, push, in_app, sms', () => {
      expect(ALL_CHANNELS).toEqual(expect.arrayContaining(['email', 'push', 'in_app', 'sms']));
    });
  });

  describe('ALL_PREFERENCE_KEYS', () => {
    it('has exactly 8 keys', () => {
      expect(ALL_PREFERENCE_KEYS).toHaveLength(8);
    });

    it('contains every expected key', () => {
      const expected: string[] = [
        'build_complete',
        'build_failed',
        'first_lead',
        'weekly_digest',
        'billing',
        'product_updates',
        'domain_events',
        'security_alerts',
      ];
      expect(ALL_PREFERENCE_KEYS).toEqual(expect.arrayContaining(expected));
    });
  });

  describe('DEFAULTS', () => {
    it('has email/push/in_app enabled and sms disabled', () => {
      expect(DEFAULTS.channels).toEqual({
        email: true,
        push: true,
        in_app: true,
        sms: false,
      });
    });

    it('has no overrides', () => {
      expect(DEFAULTS.overrides).toEqual({});
    });

    // No runtime-freeze test: `as const` is a type-level assertion,
    // not a runtime Object.freeze. TypeScript readonly is sufficient.
  });

  describe('resolvePrefs', () => {
    const base: PreferenceSet = {
      channels: { email: true, push: true, in_app: true, sms: false },
      overrides: {},
    };

    it('returns a copy of defaults when no override exists for the key', () => {
      const result = resolvePrefs(base, 'build_complete');
      expect(result).toEqual(base.channels);
      // Verify it's a copy, not the same reference.
      expect(result).not.toBe(base.channels);
    });

    it('merges a partial override on top of defaults', () => {
      const prefs: PreferenceSet = {
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: { build_failed: { sms: true } },
      };
      const result = resolvePrefs(prefs, 'build_failed');
      expect(result).toEqual({ email: true, push: true, in_app: true, sms: true });
    });

    it('overrides a single boolean to false', () => {
      const prefs: PreferenceSet = {
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: { billing: { email: false } },
      };
      const result = resolvePrefs(prefs, 'billing');
      expect(result.email).toBe(false);
      expect(result.push).toBe(true); // unchanged
    });

    it('overrides all four channels', () => {
      const prefs: PreferenceSet = {
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: {
          security_alerts: {
            email: true,
            push: true,
            in_app: true,
            sms: true,
          },
        },
      };
      const result = resolvePrefs(prefs, 'security_alerts');
      expect(result).toEqual({ email: true, push: true, in_app: true, sms: true });
    });

    it('returns defaults unchanged when override is empty', () => {
      const prefs: PreferenceSet = {
        channels: { email: true, push: false, in_app: false, sms: false },
        overrides: { first_lead: {} },
      };
      const result = resolvePrefs(prefs, 'first_lead');
      expect(result).toEqual({ email: true, push: false, in_app: false, sms: false });
    });
  });

  describe('validatePrefs', () => {
    it('returns an empty array for a valid full PreferenceSet', () => {
      const input: PreferenceSet = {
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: {},
      };
      expect(validatePrefs(input)).toEqual([]);
    });

    it('accepts a valid set with some overrides', () => {
      const input = {
        channels: { email: true, push: false, in_app: true, sms: false },
        overrides: {
          build_complete: { email: true, sms: true },
          security_alerts: { sms: true },
        },
      };
      expect(validatePrefs(input)).toEqual([]);
    });

    it('rejects null input', () => {
      expect(validatePrefs(null)).toEqual(['input must be a non-null object']);
    });

    it('rejects undefined input', () => {
      expect(validatePrefs(undefined)).toEqual(['input must be a non-null object']);
    });

    it('rejects a non-object input', () => {
      expect(validatePrefs('hello')).toEqual(['input must be a non-null object']);
    });

    it('rejects missing channels field', () => {
      const errs = validatePrefs({ overrides: {} });
      expect(errs).toContain('channels must be an object');
    });

    it('rejects missing overrides field', () => {
      const errs = validatePrefs({
        channels: { email: true, push: true, in_app: true, sms: false },
      });
      expect(errs).toContain('overrides must be an object');
    });

    it('rejects a non-boolean channel value', () => {
      const errs = validatePrefs({
        channels: { email: 'yes', push: true, in_app: true, sms: false },
        overrides: {},
      });
      expect(errs).toContain('channels.email must be a boolean');
    });

    it('rejects unexpected keys in channels', () => {
      const errs = validatePrefs({
        channels: {
          email: true,
          push: true,
          in_app: true,
          sms: false,
          slack: true,
        },
        overrides: {},
      });
      expect(errs).toContain('channels has unexpected key "slack"');
    });

    it('rejects an unrecognized override key', () => {
      const errs = validatePrefs({
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: { non_existent_key: { email: true } },
      });
      expect(errs).toContain('overrides has unrecognized key "non_existent_key"');
    });

    it('rejects a non-object override value', () => {
      const errs = validatePrefs({
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: { build_complete: 'yes' },
      });
      expect(errs).toContain('overrides.build_complete must be an object');
    });

    it('rejects unexpected channel keys inside an override', () => {
      const errs = validatePrefs({
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: { billing: { email: true, fax: false } },
      });
      expect(errs).toContain('overrides.billing has unexpected channel "fax"');
    });

    it('rejects non-boolean values inside an override', () => {
      const errs = validatePrefs({
        channels: { email: true, push: true, in_app: true, sms: false },
        overrides: { billing: { email: 'maybe' } },
      });
      expect(errs).toContain('overrides.billing.email must be a boolean');
    });

    it('collects multiple errors simultaneously', () => {
      const errs = validatePrefs({
        channels: { email: 1, push: null, in_app: true, sms: false },
        overrides: { made_up_key: { sms: 'off' } },
      });
      expect(errs.length).toBeGreaterThanOrEqual(2);
      expect(errs).toContain('channels.email must be a boolean');
      expect(errs).toContain('overrides has unrecognized key "made_up_key"');
    });
  });
});
