/**
 * @module libs/features/site_thumbnail_grid/feature.manifest
 * @description Feature manifest for the site_thumbnail_grid module.
 * @packageDocumentation
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'site_thumbnail_grid',
  name: 'Site Thumbnail Grid',
  description: 'Generates and serves browser-rendered thumbnails for published sites via R2 cache.',
  lifecycle: 'alpha',
  flagKey: 'site_thumbnail_grid',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: ['GET /api/sites/:siteId/thumbnail'],
  permissions: ['site:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/site_thumbnail_grid/__tests__/site_thumbnail_grid.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { axiom: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Disabling prevents thumbnail generation. Existing cached R2 thumbnails are unaffected.',
  },
  risks: ['Disabling prevents thumbnail generation. Existing cached R2 thumbnails are unaffected.'],
  removalNotes: 'Remove R2 thumbnail objects under thumbnails/ prefix. No D1 tables to drop.',
});
