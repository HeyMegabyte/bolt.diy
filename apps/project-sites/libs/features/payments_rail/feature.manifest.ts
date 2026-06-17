import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'payments_rail',
  name: 'Unified Payments Rail',
  description:
    'Unified payment rail abstracting Stripe and Square. Records payment events in D1 and ' +
    'exposes intent creation, method listing, and transaction history per org.',
  lifecycle: 'alpha',
  flagKey: 'payments_rail',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'GET /api/payments/methods',
    'POST /api/payments/intent',
    'GET /api/payments/history',
  ],
  permissions: ['billing:read', 'billing:write'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/payments_rail/__tests__/payments_rail.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: true },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Alpha behind flag. Enable per-org via /admin/feature-flags once Stripe + Square keys are verified.',
  },
  risks: [
    'Stripe webhook secret mismatch causes silent event loss.',
    'Square OAuth token expiry is not auto-refreshed in this version.',
    'Disabling the flag mid-session leaves in-flight payment intents dangling in the provider.',
  ],
  removalNotes:
    'Drop payments_rail_events D1 table, revoke Stripe + Square API keys from secrets, ' +
    'remove provider env vars STRIPE_SECRET_KEY and SQUARE_ACCESS_TOKEN.',
});
