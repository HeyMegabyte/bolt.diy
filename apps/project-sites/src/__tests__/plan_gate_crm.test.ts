/**
 * Unit coverage for services/plan_gate_crm — pure, zero-I/O CRM entitlement
 * matrix. No mocks needed; every function is a pure projection of plan → features.
 */
import { crmEntitlements, CRM_ENTITLEMENTS } from '../services/plan_gate_crm.js';

describe('CrmEntitlements (TW24 — plan-gate CRM features)', () => {
  /* ------------------------------------------------------------------ */
  /*  CRM_ENTITLEMENTS values                                           */
  /* ------------------------------------------------------------------ */

  describe('CRM_ENTITLEMENTS', () => {
    it('free — no CRM access, everything false, zero caps', () => {
      expect(CRM_ENTITLEMENTS.free).toEqual({
        features: {
          crm_access: false,
          contacts_unlimited: false,
          deals: false,
          workflows: false,
          email_timeline: false,
          ai_scoring: false,
        },
        maxContacts: 0,
        maxDeals: 0,
      });
    });

    it('starter — CRM access + capped contacts(500) + deals(100)', () => {
      expect(CRM_ENTITLEMENTS.starter).toEqual({
        features: {
          crm_access: true,
          contacts_unlimited: false,
          deals: true,
          workflows: false,
          email_timeline: false,
          ai_scoring: false,
        },
        maxContacts: 500,
        maxDeals: 100,
      });
    });

    it('pro — all features, all unlimited', () => {
      expect(CRM_ENTITLEMENTS.pro).toEqual({
        features: {
          crm_access: true,
          contacts_unlimited: true,
          deals: true,
          workflows: true,
          email_timeline: true,
          ai_scoring: true,
        },
        maxContacts: -1,
        maxDeals: -1,
      });
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(CRM_ENTITLEMENTS)).toBe(true);
      expect(Object.isFrozen(CRM_ENTITLEMENTS.free.features)).toBe(true);
      expect(Object.isFrozen(CRM_ENTITLEMENTS.starter.features)).toBe(true);
      expect(Object.isFrozen(CRM_ENTITLEMENTS.pro.features)).toBe(true);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  crmEntitlements — feature map                                     */
  /* ------------------------------------------------------------------ */

  describe('crmEntitlements feature map', () => {
    describe('free', () => {
      const ent = crmEntitlements('free');

      it('crm_access is false', () => expect(ent.features.crm_access).toBe(false));
      it('contacts_unlimited is false', () => expect(ent.features.contacts_unlimited).toBe(false));
      it('deals is false', () => expect(ent.features.deals).toBe(false));
      it('workflows is false', () => expect(ent.features.workflows).toBe(false));
      it('email_timeline is false', () => expect(ent.features.email_timeline).toBe(false));
      it('ai_scoring is false', () => expect(ent.features.ai_scoring).toBe(false));
      it('maxContacts is 0', () => expect(ent.maxContacts).toBe(0));
      it('maxDeals is 0', () => expect(ent.maxDeals).toBe(0));
    });

    describe('starter', () => {
      const ent = crmEntitlements('starter');

      it('crm_access is true', () => expect(ent.features.crm_access).toBe(true));
      it('contacts_unlimited is false', () => expect(ent.features.contacts_unlimited).toBe(false));
      it('deals is true', () => expect(ent.features.deals).toBe(true));
      it('workflows is false', () => expect(ent.features.workflows).toBe(false));
      it('email_timeline is false', () => expect(ent.features.email_timeline).toBe(false));
      it('ai_scoring is false', () => expect(ent.features.ai_scoring).toBe(false));
      it('maxContacts is 500', () => expect(ent.maxContacts).toBe(500));
      it('maxDeals is 100', () => expect(ent.maxDeals).toBe(100));
    });

    describe('pro', () => {
      const ent = crmEntitlements('pro');

      it('crm_access is true', () => expect(ent.features.crm_access).toBe(true));
      it('contacts_unlimited is true', () => expect(ent.features.contacts_unlimited).toBe(true));
      it('deals is true', () => expect(ent.features.deals).toBe(true));
      it('workflows is true', () => expect(ent.features.workflows).toBe(true));
      it('email_timeline is true', () => expect(ent.features.email_timeline).toBe(true));
      it('ai_scoring is true', () => expect(ent.features.ai_scoring).toBe(true));
      it('maxContacts is -1 (unlimited)', () => expect(ent.maxContacts).toBe(-1));
      it('maxDeals is -1 (unlimited)', () => expect(ent.maxDeals).toBe(-1));
    });
  });

  /* ------------------------------------------------------------------ */
  /*  crmEntitlements — plan normalization                              */
  /* ------------------------------------------------------------------ */

  describe('crmEntitlements plan normalization', () => {
    it('returns free for null', () => {
      const ent = crmEntitlements(null);
      expect(ent).toBe(CRM_ENTITLEMENTS.free);
    });

    it('returns free for undefined', () => {
      const ent = crmEntitlements(undefined);
      expect(ent).toBe(CRM_ENTITLEMENTS.free);
    });

    it('returns free for empty string', () => {
      const ent = crmEntitlements('');
      expect(ent).toBe(CRM_ENTITLEMENTS.free);
    });

    it('returns free for unknown plan strings', () => {
      expect(crmEntitlements('enterprise')).toBe(CRM_ENTITLEMENTS.free);
      expect(crmEntitlements('premium')).toBe(CRM_ENTITLEMENTS.free);
      expect(crmEntitlements('gold')).toBe(CRM_ENTITLEMENTS.free);
    });

    it('is case-insensitive', () => {
      expect(crmEntitlements('Starter')).toBe(CRM_ENTITLEMENTS.starter);
      expect(crmEntitlements('STARTER')).toBe(CRM_ENTITLEMENTS.starter);
      expect(crmEntitlements('Pro')).toBe(CRM_ENTITLEMENTS.pro);
      expect(crmEntitlements('PRO')).toBe(CRM_ENTITLEMENTS.pro);
      expect(crmEntitlements('FREE')).toBe(CRM_ENTITLEMENTS.free);
    });

    it('trims whitespace', () => {
      expect(crmEntitlements('  pro  ')).toBe(CRM_ENTITLEMENTS.pro);
      expect(crmEntitlements('\tstarter\n')).toBe(CRM_ENTITLEMENTS.starter);
    });
  });

  /* ------------------------------------------------------------------ */
  /*  crmEntitlements — never throws                                    */
  /* ------------------------------------------------------------------ */

  describe('crmEntitlements never throws', () => {
    it('accepts any string without error', () => {
      expect(() => crmEntitlements('bogus')).not.toThrow();
      expect(() => crmEntitlements('')).not.toThrow();
      expect(() => crmEntitlements('  ')).not.toThrow();
    });

    it('accepts null and undefined without error', () => {
      expect(() => crmEntitlements(null)).not.toThrow();
      expect(() => crmEntitlements(undefined)).not.toThrow();
    });

    it('always returns a valid CrmEntitlements object', () => {
      const plans = [null, undefined, '', 'free', 'starter', 'pro', 'enterprise'];
      for (const p of plans) {
        const ent = crmEntitlements(p);
        expect(ent).toHaveProperty('features');
        expect(ent).toHaveProperty('maxContacts');
        expect(ent).toHaveProperty('maxDeals');
        expect(typeof ent.maxContacts).toBe('number');
        expect(typeof ent.maxDeals).toBe('number');
        // All six feature keys present
        expect(ent.features).toHaveProperty('crm_access');
        expect(ent.features).toHaveProperty('contacts_unlimited');
        expect(ent.features).toHaveProperty('deals');
        expect(ent.features).toHaveProperty('workflows');
        expect(ent.features).toHaveProperty('email_timeline');
        expect(ent.features).toHaveProperty('ai_scoring');
      }
    });
  });
});
