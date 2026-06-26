/**
 * @module libs/features/cms_content
 *
 * Feature manifest for the CMS content bridge — the worker-side half of the
 * Payload CMS ↔ generated-site loop. Serves an edge-cached, Zod-validated blog
 * feed to generated sites and receives the HMAC-signed `notify-sites` webhook to
 * purge that cache the moment content is published.
 */
import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'cms_content',
  name: 'CMS Content Bridge',
  description:
    'Worker side of the Payload CMS to generated-site loop: an edge-cached /api/cms/blog.json feed sites consume, plus an HMAC-verified /api/cms/revalidate receiver that purges the cache on publish.',
  lifecycle: 'alpha',
  flagKey: 'cms_content',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-26',
  updatedAt: '2026-06-26',

  routes: [],
  apiRoutes: ['GET /api/cms/blog.json', 'POST /api/cms/revalidate'],

  permissions: [],
  dependencies: [],

  e2eTests: [],
  unitTests: ['../libs/features/cms_content/__tests__/cms_content.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  zodSchemas: ['schemas.ts'],

  observability: { axiom: false, logs: true, analytics: false },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Alpha. Reads the Payload feed via the existing CF_ACCESS_CLIENT_ID/SECRET service token. Promote to beta once a generated site consumes /api/cms/blog.json and a publish in the CMS is confirmed to purge the cache end-to-end.',
  },

  risks: [
    'Reaching cms.projectsites.dev requires the CF Access service token (or a public-path Access bypass for /api/blog.json); without it the feed degrades to empty rather than 500.',
    'SITES_REVALIDATE_SECRET must match the value set in the Payload container env or every webhook is rejected 401; the receiver 503s (never 500) when the secret is unset.',
  ],

  removalNotes:
    'Remove this module, the cmsContent app.route() mount in src/index.ts, the cms_content registry entry, and the SITES_REVALIDATE_SECRET / CMS_BASE_URL env fields. No owned D1 tables or migrations.',
});
