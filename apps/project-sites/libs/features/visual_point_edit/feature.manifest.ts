import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'visual_point_edit',
  name: 'Visual Point Edit',
  description: 'AI-powered in-place node patching for published sites: select a DOM node, ' +
    'describe the change in plain language, and the worker applies the edit instantly.',
  lifecycle: 'alpha',
  flagKey: 'visual_point_edit',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: ['POST /api/editor/point-edit'],
  permissions: [],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/visual_point_edit/__tests__/visual_point_edit.test.ts'],
  integrationTests: [],
  testStatus: 'passing',
  zodSchemas: ['schemas.ts'],
  observability: { axiom: true, logs: true, analytics: false },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Experimental editor surface — enable per-user in dev only until AI patch quality is evaluated.',
  },
  risks: ['AI-generated patches may produce invalid HTML if nodeId resolution fails.'],
  removalNotes: 'Delete handlers.ts, service.ts, schemas.ts, and the POST /api/editor/point-edit route mount.',
});
