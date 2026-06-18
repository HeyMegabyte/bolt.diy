import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'model_registry',
  name: 'Model Registry',
  description: 'Declarative ProviderCapabilityRegistry and ModelAliasRegistry surfaced via a public OpenAI-compatible GET /v1/models endpoint.',
  lifecycle: 'alpha',
  flagKey: 'model_registry',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-18',
  updatedAt: '2026-06-18',
  routes: [],
  apiRoutes: ['GET /v1/models'],
  permissions: [],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/model_registry/__tests__/model_registry.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: false, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Alpha — read-only provider and alias registry; no external calls, no DB writes.',
  },
  risks: ['If disabled, GET /v1/models returns 404 — OpenAI-compatible clients that rely on model discovery will fail until re-enabled.'],
  removalNotes: 'Remove the /v1/models route mount in src/index.ts and drop the feature_flags seed row.',
});
