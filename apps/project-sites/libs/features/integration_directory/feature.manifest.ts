/**
 * @module libs/features/integration_directory
 *
 * Feature manifest for Integration Directory Generator (idea #30).
 *
 * Auto-generates /integrations/{service-a}/{service-b} pages targeting the long-tail
 * "Tool A vs Tool B" / "Tool A with Tool B" SEO surface. Pulls real screenshots via
 * the existing image_discovery + Browser Rendering API, configs from public docs,
 * and step-by-step setup written by content-writer agent. Each pair page ships
 * its own JSON-LD SoftwareApplication block + comparison schema.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'integration_directory',
  name: 'Integration Directory',
  description:
    'Auto-generates /integrations/{a}/{b} pages for tech-stack pairs. ' +
    'Real screenshots via Browser Rendering. Per-pair JSON-LD + setup steps. SEO long-tail capture.',
  lifecycle: 'in-development',
  flagKey: 'integration_directory',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  routes: ['/admin/integrations'],
  apiRoutes: [
    'GET  /api/sites/:id/integrations/services',
    'POST /api/sites/:id/integrations/seed',
    'POST /api/sites/:id/integrations/generate',
    'GET  /api/sites/:id/integrations/pages',
    'POST /api/sites/:id/integrations/publish',
  ],

  permissions: ['sites:write'],
  dependencies: [],

  e2eTests: [],
  unitTests: ['../libs/features/integration_directory/__tests__/integration_directory.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  zodSchemas: ['libs/features/integration_directory/feature.schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Experimental. Pair pages generated lazily from integration_services registry. ' +
      'Screenshots cached in R2 via Browser Rendering REST to avoid repeated fetches.',
  },

  risks: [
    'Cross-product can explode: cap maxPairs=200 default; admin overrides up to 500.',
    'Browser Rendering REST quota — cache screenshots aggressively; refresh weekly at most.',
    'Pair canonicalization (alphabetical a/b ordering) is required to avoid duplicate routes.',
  ],

  removalNotes:
    'Remove: src/services/integration_directory.ts, src/routes/integration_directory.ts, ' +
    'app.route(... integrationDirectoryRoutes) mount in src/index.ts, libs/features/integration_directory/, ' +
    'migration 0521 (tables integration_services + integration_pages), FLAG_REGISTRY entry.',
});
