/**
 * @module libs/features/affiliate_program
 *
 * Feature manifest for the Affiliate Program (idea #32).
 * Public-facing partner version of the internal `referral_loop`: partners
 * enroll, share a `/r/:code` tracking link, and earn a 50% recurring
 * commission on referred-org MRR for the first 12 months (the Framer model).
 * Payouts settle via Stripe Connect Express.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'affiliate_program',
  name: 'Affiliate Program',
  description:
    'Public affiliate partner program: tracking codes, cookie attribution, 50% recurring commission on referred-org MRR for 12 months, Stripe Connect Express payouts.',
  lifecycle: 'alpha',
  flagKey: 'affiliate_program',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  routes: ['/admin/affiliate'],
  apiRoutes: [
    'POST /api/affiliate/enroll',
    'GET  /api/affiliate/me',
    'GET  /r/:code',
    'POST /api/affiliate/payout',
  ],

  permissions: ['billing:read'],
  dependencies: [],

  e2eTests: [],
  unitTests: ['../libs/features/affiliate_program/__tests__/affiliate.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  zodSchemas: ['libs/features/affiliate_program/schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Experimental. Promote to beta after enroll + attribution + accrual round-trip end-to-end and at least one Stripe Connect payout settles.',
  },

  risks: [
    'Self-referral guard relies on owner_email vs converted-org-owner equality; multi-account abuse still possible without a billing fraud signal.',
    'accrueRecurringCommission must run on a monthly cron tied to billing.subscriptions; until wired, commissions are accrued only when explicitly invoked.',
    'requestPayout depends on a configured Stripe Connect Express account; payouts no-op with a typed error when stripe_connect_id is unset.',
    'No rate-limit on /r/:code — bot clicks could inflate attribution rows; throttle at the Worker tier before beta.',
  ],

  removalNotes:
    'Drop tables: affiliates, affiliate_referrals, affiliate_commissions. Remove route mount in src/index.ts. Disable affiliate_program flag in registry. Remove /admin/affiliate Angular section.',
});
