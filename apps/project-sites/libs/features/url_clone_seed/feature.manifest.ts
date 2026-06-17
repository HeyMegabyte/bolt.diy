import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'url_clone_seed',
  name: 'URL Clone Seed',
  description: 'Seeds a new site draft by extracting content from a source URL via Cloudflare Browser Rendering, enabling one-click cloning without manual copy-paste.',
  lifecycle: 'alpha',
  flagKey: 'url_clone_seed',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: ['POST /api/clone/seed'],
  permissions: ['site:create'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/url_clone_seed/__tests__/url_clone_seed.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Requires CF_ACCOUNT_ID and CF_API_TOKEN secrets for Browser Rendering API.',
  },
  risks: ['Browser Rendering API incurs per-request cost.', 'Source site may block headless fetches.'],
  removalNotes: 'Drop POST /api/clone/seed handler and remove the url_clone_seed flag row.',
});
