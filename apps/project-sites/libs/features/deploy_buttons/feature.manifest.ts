import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'deploy_buttons',
  name: 'Deploy Buttons',
  description: 'Generate one-click Deploy buttons and Hosted-on badge snippets for embedding in GitHub READMEs and site footers.',
  lifecycle: 'alpha',
  flagKey: 'deploy_buttons',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-18',
  updatedAt: '2026-06-18',
  routes: [],
  apiRoutes: ['GET /api/deploy-buttons/:siteId'],
  permissions: ['sites:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/deploy_buttons/__tests__/deploy_buttons.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: false, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Alpha — deploy-button snippet generation only; no write ops.',
  },
  risks: ['If disabled, /api/deploy-buttons/:siteId returns 404 — badge embeds in external READMEs will render as broken image links until re-enabled.'],
  removalNotes: 'Remove the /api/deploy-buttons route mount in src/index.ts and drop the feature_flags seed row.',
});
