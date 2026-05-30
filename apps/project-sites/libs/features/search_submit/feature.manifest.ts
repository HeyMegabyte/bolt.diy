/**
 * @module libs/features/search_submit
 *
 * Feature manifest for Search/AI-Engine Auto-Submit (idea #3).
 * When a site reaches 'published', notify search + AI engines so it gets
 * crawled fast: IndexNow (Bing + Yandex — Bing is what ChatGPT search reads)
 * plus a Bing sitemap ping and a Google ping fallback. Each result is logged to
 * the existing audit_logs table — no new table needed.
 *
 * Source lives in this module's service.ts + handlers.ts; the publish hook is a
 * flag-gated, error-swallowing call to submitSite() in
 * src/workflows/site-generation.ts right after the site is marked published.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'search_submit',
  name: 'Search/AI-Engine Auto-Submit',
  description:
    'On publish, auto-submit a site to search + AI engines: IndexNow (Bing + Yandex; Bing powers ChatGPT search) ' +
    'plus a Bing sitemap ping and a Google ping fallback. Per-site key served at /{key}.txt; results logged to audit_logs.',
  lifecycle: 'alpha',
  flagKey: 'search_engine_submit',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'POST /api/sites/:id/search-submit',
    'GET /:key.txt',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/search_submit/__tests__/search_submit.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/search_submit/schemas.ts'],

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
      'Beta after: publish-hook fires on every publish + IndexNow key-file verified live + manual re-submit E2E spec.',
  },

  risks: [
    'IndexNow ownership verification requires GET /{key}.txt to serve the stored key publicly — the key route is intentionally NOT flag-gated.',
    'Engine pings are best-effort over the public internet; a non-200 from Bing/Google/IndexNow is logged, never thrown into the publish path.',
    'The per-site IndexNow key is derived deterministically from the site id, so the same key persists across re-submits without a new table.',
  ],

  removalNotes:
    'Remove: this module, the searchSubmit app.route() mount in src/index.ts, the FLAG_REGISTRY ' +
    'search_engine_submit entry, and the flag-gated submitSite() call in workflows/site-generation.ts.',
});
