import {
  ENTITLEMENTS,
  canAddDomain,
  canSetPrimary,
  upsellReason,
  normalizePlan,
} from '../services/domain_entitlement.js';

describe('DomainEntitlements (A6 — custom domain + auto-TLS matrix)', () => {
  describe('ENTITLEMENTS values', () => {
    it('free = 0 custom domains, no auto-TLS, no return path, DNS records yes', () => {
      expect(ENTITLEMENTS.free).toEqual({
        customDomains: 0,
        autoTls: false,
        customReturnPath: false,
        dnsRecords: true,
      });
    });

    it('starter = 1 custom domain, auto-TLS, no return path, DNS records yes', () => {
      expect(ENTITLEMENTS.starter).toEqual({
        customDomains: 1,
        autoTls: true,
        customReturnPath: false,
        dnsRecords: true,
      });
    });

    it('pro = unlimited custom domains, auto-TLS, return path, DNS records yes', () => {
      expect(ENTITLEMENTS.pro).toEqual({
        customDomains: -1,
        autoTls: true,
        customReturnPath: true,
        dnsRecords: true,
      });
    });
  });

  describe('canAddDomain', () => {
    it('free always returns false regardless of current count', () => {
      expect(canAddDomain('free', 0)).toBe(false);
      expect(canAddDomain('free', 1)).toBe(false);
      expect(canAddDomain('free', 50)).toBe(false);
    });

    it('starter returns true only when currentCount < 1', () => {
      expect(canAddDomain('starter', 0)).toBe(true);
      expect(canAddDomain('starter', 1)).toBe(false);
      expect(canAddDomain('starter', 5)).toBe(false);
    });

    it('pro returns true while currentCount < 50', () => {
      expect(canAddDomain('pro', 0)).toBe(true);
      expect(canAddDomain('pro', 1)).toBe(true);
      expect(canAddDomain('pro', 25)).toBe(true);
      expect(canAddDomain('pro', 49)).toBe(true);
      expect(canAddDomain('pro', 50)).toBe(false);
      expect(canAddDomain('pro', 100)).toBe(false);
    });
  });

  describe('canSetPrimary', () => {
    it('free returns false', () => {
      expect(canSetPrimary('free')).toBe(false);
    });

    it('starter returns true', () => {
      expect(canSetPrimary('starter')).toBe(true);
    });

    it('pro returns true', () => {
      expect(canSetPrimary('pro')).toBe(true);
    });
  });

  describe('upsellReason', () => {
    it.each([
      ['free', 'custom_domain', 'Custom domains are available on the Starter plan.'],
      ['starter', 'custom_domain', 'Custom domains are available on the Starter plan.'],
      ['pro', 'custom_domain', 'Custom domains are available on the Starter plan.'],
      ['free', 'auto_tls', 'Automatic TLS is available on the Starter plan.'],
      ['starter', 'auto_tls', 'Automatic TLS is available on the Starter plan.'],
      ['pro', 'auto_tls', 'Automatic TLS is available on the Starter plan.'],
      ['free', 'return_path', 'Custom return paths are available on the Pro plan.'],
      ['starter', 'return_path', 'Custom return paths are available on the Pro plan.'],
      ['pro', 'return_path', 'Custom return paths are available on the Pro plan.'],
    ] as const)('returns correct message for plan=%s feature=%s', (plan, feature, expected) => {
      expect(upsellReason(plan as 'free' | 'starter' | 'pro', feature)).toBe(expected);
    });
  });

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
  });
});
