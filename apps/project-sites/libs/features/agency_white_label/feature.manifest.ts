/**
 * @module libs/features/agency_white_label
 *
 * Feature manifest for the White-Label Agency Tier (idea #34).
 * Hostname-router swaps brand chrome (logo, color, support email)
 * so agencies can resell projectsites under their own brand.
 *
 * Requires Brian: pricing tier setup + Stripe Connect platform onboarding
 * before tenants can move from `status='pending'` to `status='active'`.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'agency_white_label',
  name: 'White-Label Agency Tier',
  description:
    'White-label agency tier: hostname-based brand chrome swap (logo/color/support email), custom admin domain, Stripe Connect billing-of-record per tenant.',
  lifecycle: 'alpha',
  flagKey: 'agency_white_label',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  routes: ['/admin/agency'],
  apiRoutes: [
    'GET   /api/agency-white-label',
    'POST  /api/agency-white-label',
    'GET   /api/agency-white-label/:id',
    'PATCH /api/agency-white-label/:id',
    'GET   /api/agency-white-label/by-host/:host',
  ],

  permissions: ['billing:read', 'billing:write'],
  dependencies: ['billing'],

  // DRIFT: e2e/agency_white_label/ specs not yet authored; tests live colocated
  // at libs/features/agency_white_label/__tests__/ (Jest finds them via discovery
  // glob; validator only accepts src/__tests__/ prefix). Move on next sweep.
  e2eTests: [],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  zodSchemas: ['libs/features/agency_white_label/schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Requires Brian: Stripe Connect platform onboarding + pricing tier ($199/$499/$1499 per month). Beta after 1 active tenant has clean billing for 30 days.',
  },

  risks: [
    'custom_domain uniqueness enforced at DB level only — Worker still needs DNS + TLS provisioning per tenant (separate Domain Stack workflow).',
    'Brand chrome swap depends on the Worker checking hostname BEFORE serving the admin shell; without that wire-up, the flag is a no-op end-to-end.',
    'Stripe Connect Express setup is out of band (requires KYC) — `status=pending` rows accumulate until onboarding completes.',
  ],

  removalNotes:
    'Drop table agency_tenants. Remove route mount. Drop FLAG_REGISTRY.agency_white_label. Re-route all `*.projectsites.dev` traffic back to default chrome.',
});
