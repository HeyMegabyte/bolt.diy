/**
 * @module libs/features/status_page_live/feature.manifest
 * @description Feature manifest for the status_page_live module.
 * @packageDocumentation
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'status_page_live',
  name: 'Status Page Live',
  description: 'Public status feed and incident management for platform health transparency.',
  lifecycle: 'alpha',
  flagKey: 'status_page_live',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: [
    'GET /api/status/feed',
    'POST /api/status/incident',
  ],
  permissions: ['status:read', 'status:write'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/status_page_live/__tests__/status_page_live.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { axiom: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Disabling hides the public status feed and blocks new incident creation.',
  },
  risks: ['Disabling hides the public status feed and blocks new incident creation.'],
  removalNotes: 'Drop status_incidents table via migration. Remove from router index.',
});
