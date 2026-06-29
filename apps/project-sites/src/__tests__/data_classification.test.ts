import { classifyField, classifyFields, KNOWN_PATTERNS } from '../services/data_classification.js';

describe('data_classification', () => {
  // ── classifyField ───────────────────────────────────────────────────

  describe('classifyField', () => {
    it('classifies email field as sensitive with GDPR article', () => {
      const r = classifyField('email');
      expect(r.tier).toBe('sensitive');
      expect(r.reason).toBe('field name is in known patterns');
      expect(r.gdprArticle).toBe('Art. 4(1)');
    });

    it('classifies password field as restricted', () => {
      const r = classifyField('user_password');
      expect(r.tier).toBe('restricted');
      expect(r.reason).toContain('password');
    });

    it('classifies ssn as restricted with Art. 9', () => {
      const r = classifyField('ssn');
      expect(r.tier).toBe('restricted');
      expect(r.gdprArticle).toBe('Art. 9');
    });

    it('classifies an unknown field as internal by default', () => {
      const r = classifyField('widget_count');
      expect(r.tier).toBe('internal');
      expect(r.reason).toBe('default classification');
      expect(r.gdprArticle).toBeNull();
    });

    it('classifies a field as sensitive when example value is email-like', () => {
      const r = classifyField('contact_info', 'someone@example.com');
      expect(r.tier).toBe('sensitive');
      expect(r.reason).toBe('example value matches email pattern');
      expect(r.gdprArticle).toBe('Art. 4(1)');
    });

    it('does not flag a non-email string as sensitive', () => {
      const r = classifyField('contact_info', 'just a note');
      expect(r.tier).toBe('internal');
    });

    it('classifies token field as restricted', () => {
      const r = classifyField('api_token');
      expect(r.tier).toBe('restricted');
    });

    it('classifies health field as restricted with Art. 9', () => {
      const r = classifyField('health_record');
      expect(r.tier).toBe('restricted');
      expect(r.gdprArticle).toBe('Art. 9');
    });

    it('classifies name field as sensitive', () => {
      const r = classifyField('full_name');
      expect(r.tier).toBe('sensitive');
    });

    it('is case-insensitive for field name matching', () => {
      const r = classifyField('SSN');
      expect(r.tier).toBe('restricted');
      expect(r.gdprArticle).toBe('Art. 9');
    });

    it('never throws for undefined exampleValue', () => {
      expect(() => classifyField('any_field', undefined)).not.toThrow();
    });

    it('never throws for null exampleValue', () => {
      expect(() => classifyField('any_field', null)).not.toThrow();
    });

    it('classifies date_of_birth as restricted', () => {
      const r = classifyField('date_of_birth');
      expect(r.tier).toBe('restricted');
    });
  });

  // ── classifyFields ──────────────────────────────────────────────────

  describe('classifyFields', () => {
    it('returns summary counts', () => {
      const r = classifyFields({
        email: 'a@b.com',
        ssn: '123-45-6789',
        widget_count: 42,
        theme: 'dark',
      });
      expect(r.summary).toEqual({
        public: 0,
        internal: 2,
        sensitive: 1,
        restricted: 1,
      });
    });

    it('sets hasRestricted when a restricted field is present', () => {
      const r = classifyFields({ ssn: '123-45-6789' });
      expect(r.hasRestricted).toBe(true);
    });

    it('sets hasRestricted to false when no restricted fields', () => {
      const r = classifyFields({ theme: 'dark', email: 'a@b.com' });
      expect(r.hasRestricted).toBe(false);
    });

    it('returns empty result for empty input', () => {
      const r = classifyFields({});
      expect(r.fields).toEqual([]);
      expect(r.summary.internal).toBe(0);
      expect(r.hasRestricted).toBe(false);
    });

    it('never throws for any input', () => {
      expect(() => classifyFields({})).not.toThrow();
      expect(() => classifyFields({ a: 1, b: null, c: undefined })).not.toThrow();
      expect(() => classifyFields({ x: { nested: true } })).not.toThrow();
    });
  });

  // ── KNOWN_PATTERNS ──────────────────────────────────────────────────

  describe('KNOWN_PATTERNS', () => {
    it('contains ssn with Art. 9 article', () => {
      expect(KNOWN_PATTERNS.ssn).toEqual({ tier: 'restricted', article: 'Art. 9' });
    });

    it('contains email with Art. 4(1) article', () => {
      expect(KNOWN_PATTERNS.email).toEqual({ tier: 'sensitive', article: 'Art. 4(1)' });
    });
  });
});
