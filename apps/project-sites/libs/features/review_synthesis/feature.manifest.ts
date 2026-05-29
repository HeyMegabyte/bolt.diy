/**
 * @module libs/features/review_synthesis
 *
 * Feature manifest for Verified Review Synthesis (idea #24).
 * Fetches a site's Google reviews, verifies their origin, AI-summarizes the
 * verified corpus into a 40-60 word trust paragraph, selects top-3 featured
 * quotes, computes an aggregate rating, and emits schema.org AggregateRating
 * JSON-LD — ONLY from verified data (honesty gate).
 *
 * This file is the registry entry only — source lives in
 * src/services/review_synthesis.ts + src/routes/reviews.ts.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'review_synthesis',
  name: 'Verified Review Synthesis',
  description:
    'Synthesizes verified Google Places reviews into a 40-60 word trust paragraph plus schema.org AggregateRating and Review JSON-LD. Verified origin only (real author, 1-5 rating) — never fabricated.',
  lifecycle: 'in-development',
  flagKey: 'review_synthesis',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'POST /api/reviews/:siteId/synthesize',
    'GET  /api/reviews/:siteId',
    'GET  /api/reviews/:siteId/jsonld',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['src/__tests__/review_synthesis.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/review_synthesis/feature.schemas.ts'],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Flag-gated POST/GET routes return 404 when off. ' +
      'Beta after: Angular admin surface to display the synthesis + a published-site JSON-LD injection path.',
  },

  risks: [
    'Workers AI summary could overstate sentiment — mitigated by the system prompt forbidding invented claims.',
    'Google Places returns at most ~5 reviews; aggregate uses Places-reported rating/count to avoid under-reporting.',
    'Synthesis runs per-request and calls Workers AI — could incur AI cost on repeated triggers; no caching layer yet.',
    'JSON-LD is null when zero verified reviews — consumers must handle the null (honesty gate, never emit empty AggregateRating).',
  ],

  removalNotes:
    'Remove: routes/reviews.ts, services/review_synthesis.ts, libs/features/review_synthesis/, ' +
    'migration 0517_review_synthesis.sql, the app.route(\'/api/reviews\', reviewRoutes) mount in src/index.ts, ' +
    'and the review_synthesis FLAG_REGISTRY entry.',
});
