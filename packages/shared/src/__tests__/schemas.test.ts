/**
 * Schema validation tests
 * TDD: These tests define the expected behavior of all schemas
 */
import { describe, it, expect } from '@jest/globals';
import {
  // Base schemas
  uuidSchema,
  emailSchema,
  phoneSchema,
  httpsUrlSchema,
  slugSchema,
  hostnameSchema,
  confidenceSchema,
  paginationInputSchema,

  // Org schemas
  orgSchema,
  createOrgInputSchema,
  userSchema,
  roleSchema,
  membershipSchema,

  // Site schemas
  siteSchema,
  createSiteInputSchema,
  hostnameStateSchema,
  siteHostnameSchema,

  // Billing schemas
  subscriptionStateSchema,
  subscriptionSchema,
  entitlementsSchema,
  checkoutSessionInputSchema,

  // Auth schemas
  createMagicLinkInputSchema,
  verifyPhoneOtpInputSchema,
  sessionSchema,

  // Webhook schemas
  webhookProviderSchema,
  stripeEventSchema,

  // Config schemas
  requiredEnvSchema,
  featureFlagSchema,

  // API schemas
  intakeRequestSchema,
} from '../schemas/index.js';

describe('Base Schemas', () => {
  describe('uuidSchema', () => {
    it('accepts valid UUIDs', () => {
      const validUuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(uuidSchema.safeParse(validUuid).success).toBe(true);
    });

    it('rejects invalid UUIDs', () => {
      expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
      expect(uuidSchema.safeParse('').success).toBe(false);
      expect(uuidSchema.safeParse(123).success).toBe(false);
    });
  });

  describe('emailSchema', () => {
    it('accepts valid emails', () => {
      expect(emailSchema.safeParse('test@example.com').success).toBe(true);
      expect(emailSchema.safeParse('user.name+tag@domain.co.uk').success).toBe(true);
    });

    it('normalizes emails to lowercase', () => {
      const result = emailSchema.parse('Test@Example.COM');
      expect(result).toBe('test@example.com');
    });

    it('trims whitespace', () => {
      const result = emailSchema.parse('  test@example.com  ');
      expect(result).toBe('test@example.com');
    });

    it('rejects invalid emails', () => {
      expect(emailSchema.safeParse('not-an-email').success).toBe(false);
      expect(emailSchema.safeParse('@example.com').success).toBe(false);
      expect(emailSchema.safeParse('test@').success).toBe(false);
    });

    it('rejects emails that are too long', () => {
      const longEmail = 'a'.repeat(250) + '@example.com';
      expect(emailSchema.safeParse(longEmail).success).toBe(false);
    });
  });

  describe('phoneSchema', () => {
    it('accepts valid E.164 phone numbers', () => {
      expect(phoneSchema.safeParse('+14155551234').success).toBe(true);
      expect(phoneSchema.safeParse('+447911123456').success).toBe(true);
    });

    it('rejects invalid phone numbers', () => {
      expect(phoneSchema.safeParse('14155551234').success).toBe(false);
      expect(phoneSchema.safeParse('+0155551234').success).toBe(false);
      expect(phoneSchema.safeParse('not-a-phone').success).toBe(false);
    });
  });

  describe('httpsUrlSchema', () => {
    it('accepts valid HTTPS URLs', () => {
      expect(httpsUrlSchema.safeParse('https://example.com').success).toBe(true);
      expect(httpsUrlSchema.safeParse('https://sub.example.com/path?query=1').success).toBe(true);
    });

    it('rejects HTTP URLs', () => {
      expect(httpsUrlSchema.safeParse('http://example.com').success).toBe(false);
    });

    it('rejects non-URL strings', () => {
      expect(httpsUrlSchema.safeParse('not-a-url').success).toBe(false);
      expect(httpsUrlSchema.safeParse('').success).toBe(false);
    });
  });

  describe('slugSchema', () => {
    it('accepts valid slugs', () => {
      expect(slugSchema.safeParse('my-business').success).toBe(true);
      expect(slugSchema.safeParse('business123').success).toBe(true);
      expect(slugSchema.safeParse('abc').success).toBe(true);
    });

    it('rejects invalid slugs', () => {
      expect(slugSchema.safeParse('ab').success).toBe(false); // too short
      expect(slugSchema.safeParse('-starts-with-hyphen').success).toBe(false);
      expect(slugSchema.safeParse('ends-with-hyphen-').success).toBe(false);
      expect(slugSchema.safeParse('Has-Uppercase').success).toBe(false);
      expect(slugSchema.safeParse('has spaces').success).toBe(false);
      expect(slugSchema.safeParse('has_underscores').success).toBe(false);
    });

    it('rejects slugs that are too long', () => {
      const longSlug = 'a'.repeat(64);
      expect(slugSchema.safeParse(longSlug).success).toBe(false);
    });
  });

  describe('hostnameSchema', () => {
    it('accepts valid hostnames', () => {
      expect(hostnameSchema.safeParse('example.com').success).toBe(true);
      expect(hostnameSchema.safeParse('sub.example.com').success).toBe(true);
      expect(hostnameSchema.safeParse('my-site.example.co.uk').success).toBe(true);
    });

    it('normalizes hostnames to lowercase', () => {
      const result = hostnameSchema.parse('Example.COM');
      expect(result).toBe('example.com');
    });

    it('rejects invalid hostnames', () => {
      expect(hostnameSchema.safeParse('localhost').success).toBe(false);
      expect(hostnameSchema.safeParse('example').success).toBe(false);
      expect(hostnameSchema.safeParse('192.168.1.1').success).toBe(false);
    });
  });

  describe('confidenceSchema', () => {
    it('accepts valid confidence scores', () => {
      expect(confidenceSchema.safeParse(0).success).toBe(true);
      expect(confidenceSchema.safeParse(50).success).toBe(true);
      expect(confidenceSchema.safeParse(100).success).toBe(true);
    });

    it('rejects invalid confidence scores', () => {
      expect(confidenceSchema.safeParse(-1).success).toBe(false);
      expect(confidenceSchema.safeParse(101).success).toBe(false);
      expect(confidenceSchema.safeParse(50.5).success).toBe(false);
    });
  });

  describe('paginationInputSchema', () => {
    it('accepts valid pagination', () => {
      expect(paginationInputSchema.safeParse({ page: 1, limit: 20 }).success).toBe(true);
    });

    it('provides defaults', () => {
      const result = paginationInputSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('enforces limit maximum', () => {
      expect(paginationInputSchema.safeParse({ page: 1, limit: 101 }).success).toBe(false);
    });
  });
});

describe('Org Schemas', () => {
  describe('createOrgInputSchema', () => {
    it('accepts valid org creation input', () => {
      const result = createOrgInputSchema.safeParse({
        name: 'My Company',
        slug: 'my-company',
      });
      expect(result.success).toBe(true);
    });

    it('slug is optional', () => {
      const result = createOrgInputSchema.safeParse({
        name: 'My Company',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      expect(createOrgInputSchema.safeParse({ name: '' }).success).toBe(false);
    });
  });

  describe('roleSchema', () => {
    it('accepts valid roles', () => {
      expect(roleSchema.safeParse('owner').success).toBe(true);
      expect(roleSchema.safeParse('admin').success).toBe(true);
      expect(roleSchema.safeParse('member').success).toBe(true);
      expect(roleSchema.safeParse('viewer').success).toBe(true);
    });

    it('rejects invalid roles', () => {
      expect(roleSchema.safeParse('superadmin').success).toBe(false);
      expect(roleSchema.safeParse('').success).toBe(false);
    });
  });
});

describe('Site Schemas', () => {
  describe('createSiteInputSchema', () => {
    it('accepts valid site creation input', () => {
      const result = createSiteInputSchema.safeParse({
        business_name: 'My Business',
      });
      expect(result.success).toBe(true);
    });

    it('accepts full site creation input', () => {
      const result = createSiteInputSchema.safeParse({
        business_name: 'My Business',
        slug: 'my-business',
        business_email: 'info@mybusiness.com',
        business_phone: '+14155551234',
        business_address: '123 Main St, City, ST 12345',
        website_url: 'https://mybusiness.com',
      });
      expect(result.success).toBe(true);
    });

    it('rejects short business names', () => {
      expect(createSiteInputSchema.safeParse({ business_name: 'A' }).success).toBe(false);
    });
  });

  describe('hostnameStateSchema', () => {
    it('accepts valid states', () => {
      expect(hostnameStateSchema.safeParse('pending').success).toBe(true);
      expect(hostnameStateSchema.safeParse('active').success).toBe(true);
      expect(hostnameStateSchema.safeParse('failed').success).toBe(true);
      expect(hostnameStateSchema.safeParse('deleted').success).toBe(true);
    });

    it('rejects invalid states', () => {
      expect(hostnameStateSchema.safeParse('unknown').success).toBe(false);
    });
  });
});

describe('Billing Schemas', () => {
  describe('subscriptionStateSchema', () => {
    it('accepts valid subscription states', () => {
      expect(subscriptionStateSchema.safeParse('active').success).toBe(true);
      expect(subscriptionStateSchema.safeParse('past_due').success).toBe(true);
      expect(subscriptionStateSchema.safeParse('canceled').success).toBe(true);
      expect(subscriptionStateSchema.safeParse('unpaid').success).toBe(true);
    });
  });

  describe('entitlementsSchema', () => {
    it('accepts valid entitlements', () => {
      const result = entitlementsSchema.safeParse({
        topBarHidden: true,
        maxCustomDomains: 5,
        analyticsAccess: 'full',
        supportPriority: 'priority',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('checkoutSessionInputSchema', () => {
    it('accepts valid checkout input', () => {
      const result = checkoutSessionInputSchema.safeParse({
        site_id: '550e8400-e29b-41d4-a716-446655440000',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Auth Schemas', () => {
  describe('createMagicLinkInputSchema', () => {
    it('accepts valid email', () => {
      const result = createMagicLinkInputSchema.safeParse({
        email: 'test@example.com',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('verifyPhoneOtpInputSchema', () => {
    it('accepts valid OTP verification', () => {
      const result = verifyPhoneOtpInputSchema.safeParse({
        phone: '+14155551234',
        code: '123456',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid OTP code length', () => {
      expect(verifyPhoneOtpInputSchema.safeParse({
        phone: '+14155551234',
        code: '12345', // 5 digits
      }).success).toBe(false);
    });

    it('rejects non-numeric OTP', () => {
      expect(verifyPhoneOtpInputSchema.safeParse({
        phone: '+14155551234',
        code: 'abcdef',
      }).success).toBe(false);
    });
  });
});

describe('Webhook Schemas', () => {
  describe('webhookProviderSchema', () => {
    it('accepts valid providers', () => {
      expect(webhookProviderSchema.safeParse('stripe').success).toBe(true);
      expect(webhookProviderSchema.safeParse('chatwoot').success).toBe(true);
      expect(webhookProviderSchema.safeParse('dub').success).toBe(true);
      expect(webhookProviderSchema.safeParse('novu').success).toBe(true);
      expect(webhookProviderSchema.safeParse('lago').success).toBe(true);
    });
  });

  describe('stripeEventSchema', () => {
    it('accepts valid Stripe event', () => {
      const result = stripeEventSchema.safeParse({
        id: 'evt_123',
        object: 'event',
        type: 'checkout.session.completed',
        created: 1234567890,
        livemode: false,
        data: { object: { id: 'cs_123' } },
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('Intake Schema', () => {
  describe('intakeRequestSchema', () => {
    it('accepts valid intake request', () => {
      const result = intakeRequestSchema.safeParse({
        business_name: 'My Business',
        turnstile_token: 'token123',
      });
      expect(result.success).toBe(true);
    });

    it('accepts full intake request', () => {
      const result = intakeRequestSchema.safeParse({
        business_name: 'My Business',
        business_email: 'info@mybusiness.com',
        business_phone: '+14155551234',
        business_address: '123 Main St',
        website_url: 'https://mybusiness.com',
        turnstile_token: 'token123',
      });
      expect(result.success).toBe(true);
    });

    it('requires turnstile token', () => {
      expect(intakeRequestSchema.safeParse({
        business_name: 'My Business',
      }).success).toBe(false);
    });
  });
});

describe('Hostile Input Handling', () => {
  it('rejects script injection in business name', () => {
    const result = createSiteInputSchema.safeParse({
      business_name: '<script>alert("xss")</script>My Business',
    });
    // The schema accepts it but the safeTextSchema should sanitize it
    if (result.success) {
      expect(result.data.business_name).not.toContain('<script>');
    }
  });

  it('rejects excessively long inputs', () => {
    const longName = 'a'.repeat(1000);
    expect(createSiteInputSchema.safeParse({
      business_name: longName,
    }).success).toBe(false);
  });
});
