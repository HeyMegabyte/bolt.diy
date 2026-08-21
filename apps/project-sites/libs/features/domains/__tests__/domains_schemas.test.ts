/**
 * Boundary-contract tests for the domains feature schemas. These lock the
 * zod-everywhere guarantees that replaced the old `as {…}` casts — the exact
 * class of input-validation gaps route-decomposition installment 1 closes.
 */
import {
  siteIdSchema,
  DomainPurchaseSchema,
  DomainRegisterSchema,
  suggestQuerySchema,
  suggestRefineSchema,
} from '../schemas.js';

describe('domains/schemas', () => {
  describe('siteIdSchema — shape-only (mixed UUID + slug-style prod ids)', () => {
    it('accepts a real UUID and a legacy slug-style id', () => {
      expect(siteIdSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success).toBe(true);
      expect(siteIdSchema.safeParse('site-megabytespace-001').success).toBe(true);
      expect(siteIdSchema.safeParse('e2e-site-1').success).toBe(true);
    });
    it('rejects empty, over-long, or injection-y ids', () => {
      expect(siteIdSchema.safeParse('').success).toBe(false);
      expect(siteIdSchema.safeParse('a'.repeat(81)).success).toBe(false);
      expect(siteIdSchema.safeParse("x'; DROP TABLE sites;--").success).toBe(false);
    });
  });

  describe('DomainRegisterSchema — the former `as {…}` cast', () => {
    it('trims + lowercases the domain and passes a valid body', () => {
      const r = DomainRegisterSchema.safeParse({ domain: '  Vitos.COM ', site_id: 'site-abc' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.domain).toBe('vitos.com');
    });
    it('rejects a missing domain or site_id', () => {
      expect(DomainRegisterSchema.safeParse({ site_id: 'site-abc' }).success).toBe(false);
      expect(DomainRegisterSchema.safeParse({ domain: 'x.com' }).success).toBe(false);
      expect(DomainRegisterSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('DomainPurchaseSchema — https-only redirect guard', () => {
    it('accepts an https success/cancel url', () => {
      expect(
        DomainPurchaseSchema.safeParse({
          domain: 'vitos.com',
          site_id: 'site-abc',
          success_url: 'https://projectsites.dev/ok',
        }).success,
      ).toBe(true);
    });
    it('rejects a non-https (javascript:/http:) redirect url', () => {
      expect(
        DomainPurchaseSchema.safeParse({
          domain: 'vitos.com',
          site_id: 'site-abc',
          // eslint-disable-next-line no-script-url
          success_url: 'javascript:alert(1)',
        }).success,
      ).toBe(false);
      expect(
        DomainPurchaseSchema.safeParse({
          domain: 'vitos.com',
          site_id: 'site-abc',
          cancel_url: 'http://evil.example/x',
        }).success,
      ).toBe(false);
    });
  });

  describe('suggest schemas — bounded counts + coercion', () => {
    it('coerces the GET count query and bounds it 1–20', () => {
      const ok = suggestQuerySchema.safeParse({ site_id: 'site-abc', count: '5' });
      expect(ok.success).toBe(true);
      if (ok.success) expect(ok.data.count).toBe(5);
      expect(suggestQuerySchema.safeParse({ site_id: 'site-abc', count: '99' }).success).toBe(false);
    });
    it('caps exclude_domains at 40 on refine', () => {
      expect(
        suggestRefineSchema.safeParse({
          site_id: 'site-abc',
          exclude_domains: Array.from({ length: 41 }, (_, i) => `d${i}.com`),
        }).success,
      ).toBe(false);
    });
  });
});
