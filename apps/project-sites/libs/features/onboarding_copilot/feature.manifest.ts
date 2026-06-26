import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'onboarding_copilot',
  name: 'Onboarding Copilot',
  description: 'PLG activation checklist that computes the next-best-action for new orgs across site creation, publishing, custom domains, and team exploration.',
  lifecycle: 'alpha',
  flagKey: 'onboarding_copilot',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-18',
  updatedAt: '2026-06-18',
  routes: [],
  apiRoutes: [
    'GET /api/onboarding/checklist',
    'POST /api/onboarding/dismiss',
  ],
  permissions: ['sites:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/onboarding_copilot/__tests__/onboarding_copilot.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { axiom: false, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Alpha — read-only checklist computation and KV dismiss; no write ops against D1.',
  },
  risks: [
    'If disabled, /api/onboarding/checklist and /api/onboarding/dismiss return 404 — any admin UI checklist widget goes blank until re-enabled.',
  ],
  removalNotes:
    'Remove the /api/onboarding route mount in src/index.ts and drop the feature_flags seed row for onboarding_copilot.',
});
