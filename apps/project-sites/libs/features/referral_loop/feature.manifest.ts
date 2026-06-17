import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'referral_loop',
  name: 'Referral Loop — Viral Credit Engine',
  description:
    'Viral referral system that issues a credit to the referrer when the referred ' +
    'user upgrades to a paid plan. Tracks referral clicks and conversions via ' +
    'referral_codes and referral_attributions tables. Credit is applied to the ' +
    'referrer org wallet via credit_wallet_ledger.',
  lifecycle: 'alpha',
  flagKey: 'referral_loop',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'GET /api/referral/code',
    'POST /api/referral/track',
    'GET /api/referral/stats',
  ],
  permissions: ['billing:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/referral_loop/__tests__/referral_loop.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: {
    sentry: true,
    logs: true,
    analytics: false,
  },
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Enable via /admin/feature-flags. ' +
      'Beta after: click tracking + conversion webhook + credit issuance all verified end-to-end.',
  },
  risks: [
    'Referral credits are issued on subscription webhook — a duplicate webhook fires a duplicate credit unless idempotency is enforced on ref_id.',
    'A referral_code row is created on first GET; concurrent first-requests from the same org may race and produce duplicate codes without a UNIQUE index guard.',
    'click and conversion counts on referral_codes are best-effort increments; a D1 outage during track silently under-counts without failing the caller.',
  ],
  removalNotes:
    'Remove: this module, the app.route() mount in src/index.ts, ' +
    'and referral_codes + referral_attributions tables. ' +
    'Drop the referral_loop feature flag row.',
});
