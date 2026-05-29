/**
 * @module libs/features/pseo_matrix
 *
 * Feature manifest for pSEO Matrix v2 (idea #29 — post-March-2026 helpful-content rules).
 *
 * v1 (slug=pseo_matrix_builder) generated service x city x intent x season pages keyed
 * around keywords. v2 pivots the same engine to USER TASKS (real intent from search-console
 * "actions users want to take") and enforces a hard floor of >=40 percent unique data per
 * page — sourced from live Google Places, real reviews, real pricing, real ZIP-localized
 * stats — never just keyword permutation.
 *
 * Registry entry only; source lives in src/services/pseo_matrix_v2.ts +
 * src/routes/pseo_matrix_v2.ts. Adds D1 tables pseo_axes + pseo_pages_v2.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'pseo_matrix',
  name: 'pSEO Matrix v2',
  description:
    'pSEO v2 keyed on user tasks (not keywords). Hard >=40 percent unique data floor per page: ' +
    'real Google Places, real reviews, real pricing. Cap 200 pages per axis. Post-March-2026 safe.',
  lifecycle: 'in-development',
  flagKey: 'pseo_matrix_v2',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  routes: ['/admin/pseo-v2'],
  apiRoutes: [
    'GET  /api/sites/:id/pseo/v2/axes',
    'POST /api/sites/:id/pseo/v2/axes',
    'POST /api/sites/:id/pseo/v2/generate',
    'GET  /api/sites/:id/pseo/v2/pages',
    'POST /api/sites/:id/pseo/v2/publish',
  ],

  permissions: ['sites:write'],
  dependencies: [],

  e2eTests: [],
  unitTests: ['__tests__/pseo_matrix_v2.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  zodSchemas: ['libs/features/pseo_matrix/feature.schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Experimental. Each page must clear unique_data_pct >= 40 (live Google Places + real reviews + ' +
      'real pricing) to publish. Pages below the floor flip to status=below_floor and never publish.',
  },

  risks: [
    'Cartesian product across axes can hit MAX_PAGES_PER_AXIS=200; cap is per-axis, not total.',
    'unique_data_pct computation is heuristic; tune weighting in computeUniqueDataPct as we collect data.',
    'Workers AI cost per generated page should be metered before promotion to beta.',
  ],

  removalNotes:
    'Remove: src/services/pseo_matrix_v2.ts, src/routes/pseo_matrix_v2.ts, ' +
    'app.route(... pseoMatrixV2Routes) mount in src/index.ts, libs/features/pseo_matrix/, ' +
    'migration 0520 (tables pseo_axes + pseo_pages_v2), FLAG_REGISTRY pseo_matrix_v2 entry.',
});
