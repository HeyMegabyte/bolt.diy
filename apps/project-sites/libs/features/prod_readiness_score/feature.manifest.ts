/**
 * @module libs/features/prod_readiness_score
 *
 * Feature manifest for Production Readiness Score — surfaces a 0-100 score,
 * a letter grade, and a per-check breakdown so site owners know exactly what
 * to fix before considering a site "launch-ready".
 */
import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'prod_readiness_score',
  name: 'Production Readiness Score',
  description:
    'Returns a 0-100 score, A-F letter grade, and per-check breakdown (published / custom domain / performance / sitemap) that tells site owners exactly what to fix before launch.',
  lifecycle: 'alpha',
  flagKey: 'prod_readiness_score',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-18',
  updatedAt: '2026-06-18',

  routes: [],
  apiRoutes: ['GET /api/sites/:siteId/readiness'],

  permissions: ['sites:read'],
  dependencies: [],

  e2eTests: [],
  unitTests: [
    '../libs/features/prod_readiness_score/__tests__/prod_readiness_score.test.ts',
  ],
  integrationTests: [],
  testStatus: 'passing',

  zodSchemas: ['schemas.ts'],

  observability: { sentry: false, logs: true, analytics: false },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Alpha. Four weighted checks (published/custom_domain/performance/sitemap). Promote to beta after prod smoke test confirms score is accurate for real sites.',
  },

  risks: [
    'R2 SITES_BUCKET.head() may add latency — wrapped in try/catch so a storage error degrades to sitemap=false rather than a 500.',
    'lighthouse_score column may be null for sites that have never been audited — treated as failing the performance check.',
  ],

  removalNotes:
    'Remove this module, the prodReadinessScore app.route() mount in src/index.ts, and the prod_readiness_score flag row. No owned D1 tables or migrations.',
});
