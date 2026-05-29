/**
 * Unit tests for stripe_marketplace schemas.
 */

import {
  OAuthCallbackQuerySchema,
  StripeAppManifestSchema,
  UninstallRequestSchema,
} from '../schemas.js';

describe('stripe_marketplace/schemas', () => {
  describe('OAuthCallbackQuerySchema', () => {
    test('accepts a typical Stripe callback', () => {
      const ok = OAuthCallbackQuerySchema.safeParse({
        code: 'ac_1Abc...',
        state: 'random-state-value',
        scope: 'read_write',
        livemode: 'false',
      });
      expect(ok.success).toBe(true);
    });

    test('rejects missing code', () => {
      const bad = OAuthCallbackQuerySchema.safeParse({ state: 'x'.repeat(10) });
      expect(bad.success).toBe(false);
    });

    test('rejects short state (CSRF-defeat)', () => {
      const bad = OAuthCallbackQuerySchema.safeParse({
        code: 'ac_x',
        state: 'abc',
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('UninstallRequestSchema', () => {
    test('accepts a valid stripe_account_id', () => {
      const ok = UninstallRequestSchema.safeParse({
        stripe_account_id: 'acct_1ExAmPLeAcCt',
      });
      expect(ok.success).toBe(true);
    });

    test('rejects empty stripe_account_id', () => {
      const bad = UninstallRequestSchema.safeParse({ stripe_account_id: '' });
      expect(bad.success).toBe(false);
    });
  });

  describe('StripeAppManifestSchema', () => {
    test('accepts a clean manifest', () => {
      const ok = StripeAppManifestSchema.safeParse({
        id: 'com.projectsites.app',
        version: '0.1.0',
        name: 'projectsites',
        icon: 'https://example.com/icon.png',
        permissions: [
          { permission: 'customer_read', purpose: 'Show customer info' },
        ],
        app_url: 'https://example.com/stripe-app',
        distribution_type: 'public',
      });
      expect(ok.success).toBe(true);
    });

    test('rejects an id that breaks Stripe reverse-domain rules', () => {
      const bad = StripeAppManifestSchema.safeParse({
        id: 'projectsites',
        version: '0.1.0',
        name: 'projectsites',
        icon: 'https://example.com/i.png',
        permissions: [],
        app_url: 'https://example.com',
        distribution_type: 'public',
      });
      expect(bad.success).toBe(false);
    });
  });
});
