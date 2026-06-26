import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'figma_import',
  name: 'Figma Import',
  description:
    'Import design tokens and component metadata from a Figma file via the Figma REST API, ' +
    'allowing designers to push brand tokens into a generated site without manual copy-paste.',
  lifecycle: 'alpha',
  flagKey: 'figma_import',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: ['POST /api/figma/import'],
  permissions: [],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/figma_import/__tests__/figma_import.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { axiom: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Requires a valid Figma personal-access token from the caller. Enable per-user in dev until token-vault UX is built.',
  },
  risks: ['Figma API rate-limits at 100 req/min; heavy import jobs may hit the cap.'],
  removalNotes:
    'Delete handlers.ts, service.ts, schemas.ts, feature.manifest.ts and remove the POST /api/figma/import mount in src/index.ts.',
});
