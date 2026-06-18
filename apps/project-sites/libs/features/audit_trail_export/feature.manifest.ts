import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'audit_trail_export',
  name: 'Audit Trail Export',
  description:
    'Allows org admins to filter and export their audit log (who did what, when) as JSON or CSV. Read-only access to the existing audit_logs table.',
  lifecycle: 'alpha',
  flagKey: 'audit_trail_export',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-18',
  updatedAt: '2026-06-18',
  routes: [],
  apiRoutes: ['GET /api/audit/export'],
  permissions: ['sites:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/audit_trail_export/__tests__/audit_trail_export.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: false, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Alpha — read-only export; no write ops.',
  },
  risks: ['If disabled, GET /api/audit/export returns 404. No data is mutated; export is scoped to caller org_id.'],
  removalNotes: 'Remove the /api/audit/export route mount in src/index.ts and drop the feature_flags seed row.',
});
