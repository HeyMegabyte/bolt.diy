import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'credit_wallet_rollover',
  name: 'Credit Wallet Rollover',
  description:
    'Monthly credit wallet that accumulates unused subscription credits up to a 3x monthly cap. ' +
    'Credits apply toward AI generation and premium features.',
  lifecycle: 'alpha',
  flagKey: 'credit_wallet_rollover',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'GET /api/credits/balance',
    'POST /api/credits/apply',
    'GET /api/credits/history',
  ],
  permissions: ['billing:read', 'billing:write'],
  dependencies: ['token_burn_meter'],
  e2eTests: [],
  unitTests: [
    '../libs/features/credit_wallet_rollover/__tests__/credit_wallet_rollover.test.ts',
  ],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: true },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Alpha — enable per-org via /admin/feature-flags after confirming billing plan config.',
  },
  risks: [
    'Rollover cap (3x monthly) is computed per apply call; concurrent applies may race without idempotency key.',
    'When flag is off, balance route returns 404. Billing page should degrade gracefully to show base plan credits only.',
  ],
  removalNotes:
    'Drop credit_wallet_ledger D1 table. Remove this module folder and the app.route mount in src/index.ts.',
});
