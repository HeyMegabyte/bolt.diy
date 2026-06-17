import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'aeo_pass',
  name: 'AEO Pass',
  description: 'Answer Engine Optimization audit that scores a site for AI search readiness and surfaces actionable issues.',
  lifecycle: 'alpha',
  flagKey: 'aeo_pass',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'POST /api/aeo/audit/:siteId',
    'GET /api/aeo/:siteId',
  ],
  permissions: ['site:read', 'site:write'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/aeo_pass/__tests__/aeo_pass.test.ts'],
  integrationTests: [],
  testStatus: 'not-started',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'When disabled the audit endpoints return 404; no site data is affected.',
  },
  risks: ['When disabled the audit endpoints return 404; no site data is affected.'],
  removalNotes: 'Drop aeo_audits table migration and remove route mount from src/index.ts.',
});
