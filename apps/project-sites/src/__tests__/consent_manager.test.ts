/**
 * Consent manager SSOT. Locks the default per-category grants, the record
 * factory shape, and every predicate. Drift here = the application gates
 * analytics/marketing/preferences on a stale contract.
 */
import {
  ConsentCategory,
  ConsentRecord,
  CONSENT_VERSION,
  DEFAULT_CONSENT,
  createConsent,
  hasConsent,
  allConsentGranted,
} from '../services/consent_manager.js';

describe('consent manager', () => {
  it('exports the current version', () => {
    expect(CONSENT_VERSION).toBe('1.0');
  });

  it('DEFAULT_CONSENT has all four categories', () => {
    expect(Object.keys(DEFAULT_CONSENT).sort()).toEqual([
      'analytics',
      'marketing',
      'necessary',
      'preferences',
    ]);
  });

  it('DEFAULT_CONSENT grants necessary, denies everything else', () => {
    expect(DEFAULT_CONSENT.necessary).toBe(true);
    expect(DEFAULT_CONSENT.analytics).toBe(false);
    expect(DEFAULT_CONSENT.marketing).toBe(false);
    expect(DEFAULT_CONSENT.preferences).toBe(false);
  });

  it('DEFAULT_CONSENT is frozen', () => {
    expect(Object.isFrozen(DEFAULT_CONSENT)).toBe(true);
  });

  describe('createConsent', () => {
    const NOW = 1_719_532_800_000;

    it('builds a record with granted categories set to true', () => {
      const record = createConsent('u1', ['analytics', 'preferences'], '1.0', NOW);

      expect(record.userId).toBe('u1');
      expect(record.categories.analytics).toBe(true);
      expect(record.categories.preferences).toBe(true);
      expect(record.consentedAt).toBe(NOW);
      expect(record.version).toBe('1.0');
    });

    it('defaults unlisted categories to false (marketing not granted)', () => {
      const record = createConsent('u1', ['analytics'], '1.0', NOW);

      expect(record.categories.marketing).toBe(false);
      expect(record.categories.preferences).toBe(false);
    });

    it('always grants necessary regardless of the granted list', () => {
      const record = createConsent('u1', [], '1.0', NOW);

      expect(record.categories.necessary).toBe(true);
    });

    it('uses CONSENT_VERSION when version is omitted', () => {
      const record = createConsent('u2', ['analytics'], undefined, NOW);

      expect(record.version).toBe(CONSENT_VERSION);
    });

    it('uses Date.now() when nowMs is omitted', () => {
      const before = Date.now();
      const record = createConsent('u3', ['marketing']);
      const after = Date.now();

      expect(record.consentedAt).toBeGreaterThanOrEqual(before);
      expect(record.consentedAt).toBeLessThanOrEqual(after);
    });

    it('returns a frozen record', () => {
      const record = createConsent('u1', ['analytics'], '1.0', NOW);

      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.categories)).toBe(true);
    });

    it('handles all four categories granted', () => {
      const record = createConsent(
        'u1',
        ['necessary', 'analytics', 'marketing', 'preferences'],
        '1.0',
        NOW,
      );

      expect(record.categories.necessary).toBe(true);
      expect(record.categories.analytics).toBe(true);
      expect(record.categories.marketing).toBe(true);
      expect(record.categories.preferences).toBe(true);
    });
  });

  describe('hasConsent', () => {
    const NOW = 1_719_532_800_000;

    it('returns true for necessary regardless of the stored value', () => {
      const record = createConsent('u1', [], '1.0', NOW);

      expect(hasConsent(record, 'necessary')).toBe(true);
    });

    it('returns true for a granted category', () => {
      const record = createConsent('u1', ['analytics'], '1.0', NOW);

      expect(hasConsent(record, 'analytics')).toBe(true);
    });

    it('returns false for a denied category', () => {
      const record = createConsent('u1', [], '1.0', NOW);

      expect(hasConsent(record, 'marketing')).toBe(false);
      expect(hasConsent(record, 'preferences')).toBe(false);
    });

    it('is false for analytics when only marketing granted', () => {
      const record = createConsent('u1', ['marketing'], '1.0', NOW);

      expect(hasConsent(record, 'analytics')).toBe(false);
    });
  });

  describe('allConsentGranted', () => {
    const NOW = 1_719_532_800_000;

    it('returns true when every category is true', () => {
      const record = createConsent(
        'u1',
        ['necessary', 'analytics', 'marketing', 'preferences'],
        '1.0',
        NOW,
      );

      expect(allConsentGranted(record)).toBe(true);
    });

    it('returns false when analytics is denied', () => {
      const record = createConsent('u1', ['marketing'], '1.0', NOW);

      expect(allConsentGranted(record)).toBe(false);
    });

    it('returns false when only necessary is true', () => {
      const record = createConsent('u1', [], '1.0', NOW);

      expect(allConsentGranted(record)).toBe(false);
    });

    it('returns false when one category is false', () => {
      const record = createConsent('u1', ['analytics', 'marketing'], '1.0', NOW);

      expect(allConsentGranted(record)).toBe(false);
    });
  });
});
