/**
 * @module libs/features/comparison_pages
 *
 * Feature manifest for Comparison + Alternative Pages Engine (idea #31).
 *
 * Auto-generates /vs/{competitor} pages plus /alternatives/{competitor}. Real pricing
 * pulled weekly via scheduled Worker (scrapes pricing pages of named competitors).
 * Real product screenshots via Cloudflare Browser Rendering API. Each page ships
 * comparison table, JSON-LD ItemList, and FAQPage with three real differences.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'comparison_pages',
  name: 'Comparison Pages Engine',
  description:
    'Auto-generates /vs/{competitor} and /alternatives/{competitor} pages. ' +
    'Real pricing scraped weekly. Real screenshots via Browser Rendering. JSON-LD ItemList + FAQPage.',
  lifecycle: 'in-development',
  flagKey: 'comparison_pages',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  routes: ['/admin/comparisons'],
  apiRoutes: [
    'GET  /api/sites/:id/comparisons/competitors',
    'POST /api/sites/:id/comparisons/competitors',
    'POST /api/sites/:id/comparisons/generate',
    'GET  /api/sites/:id/comparisons/pages',
    'POST /api/sites/:id/comparisons/refresh-pricing',
  ],

  permissions: ['sites:write'],
  dependencies: [],

  e2eTests: [],
  unitTests: ['../libs/features/comparison_pages/__tests__/comparison_pages.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  zodSchemas: ['libs/features/comparison_pages/feature.schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Experimental. Pricing refresh runs weekly via scheduled Worker. Browser Rendering REST fronts ' +
      'every scrape; when CF creds missing, falls back to HEAD check only.',
  },

  risks: [
    'Competitor pricing scraping must respect robots.txt + UA discipline per fetch-defaults rule.',
    'pricing_scraped_at older than 14 days should warn in the admin UI (stale data risk).',
    'comparison content_json must include three REAL differences (not generic feature lists).',
  ],

  removalNotes:
    'Remove: src/services/comparison_pages.ts, src/routes/comparison_pages.ts, ' +
    'app.route(... comparisonPagesRoutes) mount in src/index.ts, libs/features/comparison_pages/, ' +
    'migration 0522 (tables competitors + comparison_pages), FLAG_REGISTRY comparison_pages entry.',
});
