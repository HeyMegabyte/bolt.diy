import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'visitor_dsar',
  name: 'Visitor DSAR (GDPR/CCPA)',
  description:
    'Site owners can export or delete a visitor identity on request to satisfy GDPR/CCPA data-subject-access obligations.',
  lifecycle: 'alpha',
  flagKey: 'visitor_dsar',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-18',
  updatedAt: '2026-06-18',
  routes: [],
  apiRoutes: ['POST /api/sites/:siteId/dsar'],
  permissions: ['sites:write'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/visitor_dsar/__tests__/visitor_dsar.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Alpha — enable per-org via feature flag override once privacy workflow is confirmed.',
  },
  risks: [
    'Irreversible soft-delete of visitor_identities rows; confirm subject ownership before processing.',
  ],
  removalNotes:
    'Drop POST /api/sites/:siteId/dsar handler; retain audit_logs rows per retention policy.',
});
