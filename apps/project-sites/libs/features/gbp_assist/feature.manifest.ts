/**
 * @module libs/features/gbp_assist
 *
 * Feature manifest for one-click Google Business Profile (GBP) setup +
 * optimizer (idea #9). ~35% of SMBs have a GBP and it is the #1 local-pack
 * ranking factor — guided claim/create + an AI-generated, GBP-ready content
 * pack closes that gap.
 *
 * MVP is guided (deep-link + content-pack), not a silent GBP API write, which
 * needs Google approval. Status detection reuses `src/services/google_places.ts`;
 * the content pack is generated via `src/services/external_llm.ts`.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'gbp_assist',
  name: 'Google Business Profile Assist',
  description:
    'One-click Google Business Profile setup + optimizer: detects an existing profile via Places, returns a ' +
    'claim/create deep-link, and generates an SEO content pack (categories, 750-char description, services, first post) plus a guided checklist.',
  lifecycle: 'alpha',
  flagKey: 'gbp_assist',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET /api/sites/:id/gbp/status',
    'POST /api/sites/:id/gbp/content-pack',
    'GET /api/sites/:id/gbp/checklist',
  ],

  // ---- governance ----
  permissions: ['sites:read', 'sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/gbp_assist/__tests__/gbp_assist.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: ['schemas.ts'],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: false,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Enable via /admin/feature-flags. ' +
      'Beta after: content-pack persisted per site + admin GBP panel + dedicated E2E spec.',
  },

  risks: [
    'Status detection depends on Google Places; when GOOGLE_PLACES_API_KEY is unset it returns hasProfile=false (unknown), so the create deep-link may be shown for a business that already has a profile.',
    'Content pack is guidance the owner pastes manually — no GBP API write happens, so optimizations only land if the owner applies them.',
    'The 750-char description is clamped from LLM output; an over-long draft is truncated at a word boundary, which can drop a trailing keyword.',
  ],

  removalNotes:
    'Remove: this module, the gbpAssist app.route() mount in src/index.ts, the gbp_assist FLAG_REGISTRY entry, ' +
    'and migration 0528_gbp_assist.sql (drop the gbp_profiles table). No other module depends on it.',
});
