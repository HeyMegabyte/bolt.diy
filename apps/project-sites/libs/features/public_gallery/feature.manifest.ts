/**
 * @module libs/features/public_gallery
 *
 * Feature manifest for the Public Gallery (idea #34) — a public, indexable
 * showcase of opted-in published sites that doubles as social proof, a pSEO
 * surface, and the top of the marketplace funnel.
 *
 * The gallery SSR HTML + JSON API + sitemap live in `handlers.ts`; the D1/KV
 * query layer lives in `service.ts`. Opt-in is a per-site toggle persisted on
 * `sites.gallery_opt_in` (migration 0529).
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'public_gallery',
  name: 'Public Gallery',
  description:
    'Public, indexable gallery of opted-in published sites. Server-rendered cards with OG image, ' +
    'category filter, JSON-LD ItemList, a JSON API, and a sitemap — social proof plus a pSEO marketplace funnel.',
  lifecycle: 'alpha',
  flagKey: 'public_gallery',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: ['/gallery'],
  apiRoutes: [
    'GET /gallery',
    'GET /gallery/sitemap.xml',
    'GET /api/gallery',
    'POST /api/sites/:id/gallery/opt-in',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/public_gallery/__tests__/public_gallery.test.ts'],
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
      'Beta after: opt-in toggle wired in admin UI + dedicated E2E spec + OG-image fallback verified.',
  },

  risks: [
    'Public surface exposes opted-in site names + categories; opt-in defaults to 0 so nothing leaks until a site owner enables it.',
    'KV list cache (60s) can serve a just-removed site for up to a minute after opt-out — acceptable for a marketing surface.',
    'Sitemap grows with opted-in sites; capped at 1000 entries to avoid thin-content / runaway sitemap flags.',
  ],

  removalNotes:
    'Remove: this module, the publicGallery app.route() mount in src/index.ts, the public_gallery flag, ' +
    'and migration 0529 (drop the sites.gallery_opt_in column + index). No other code reads gallery_opt_in.',
});
