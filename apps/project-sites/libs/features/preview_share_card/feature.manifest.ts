import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'preview_share_card',
  name: 'Instant Preview Share Card',
  description:
    'Owner-driven viral loop. After a build the owner gets honest, pre-written ' +
    'share messages (SMS / WhatsApp / email / copy), one-tap platform deep-links ' +
    '(SMS, WhatsApp, mailto, X, Facebook), and OG-card params for a branded ' +
    '1200x630 card — so they share their new site to real customers in seconds. ' +
    'The shared link is the ad. Free-tier; pairs the stable preview URLs.',
  lifecycle: 'alpha',
  flagKey: 'preview_share_card',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-29',
  updatedAt: '2026-06-29',
  routes: [],
  apiRoutes: ['GET /api/sites/:siteId/share-card'],
  permissions: ['sites:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: [
    '../libs/features/preview_share_card/__tests__/preview_share_card.test.ts',
    '../src/__tests__/preview_share_card.test.ts',
  ],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: {
    axiom: true,
    logs: true,
    analytics: false,
  },
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Enable via /admin/feature-flags. Beta after: the build-complete ' +
      '"Share my preview" button renders the deep-links + a branded OG card end-to-end.',
  },
  risks: [
    'Pure builder — if a site has no slug yet the preview URL is empty and links degrade gracefully (no throw).',
    'OG card params are returned but the workers-og render endpoint is a follow-on; until then the card is text/link only.',
  ],
  removalNotes:
    'Remove this module, the app.route() mount in src/index.ts, and the ' +
    'preview_share_card entry in src/modules/feature_flags/registry.ts. No tables owned.',
});
