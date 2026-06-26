import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'cmdk_ai_actions',
  name: 'Cmd+K AI Actions',
  description: 'Resolves natural-language admin commands to structured action intents using Workers AI, powering the Cmd+K command palette with AI-assisted navigation and mutations.',
  lifecycle: 'alpha',
  flagKey: 'cmdk_ai_actions',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-17',
  updatedAt: '2026-06-17',
  routes: [],
  apiRoutes: ['POST /api/cmdk/resolve'],
  permissions: ['admin:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/cmdk_ai_actions/__tests__/cmdk_ai_actions.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { axiom: true, logs: true, analytics: true },
  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes: 'Requires Workers AI binding (env.AI). Uses Llama 3.3 70B FP8.',
  },
  risks: ['Workers AI quota usage scales with command palette usage.', 'LLM output is non-deterministic; action matching may occasionally be incorrect.'],
  removalNotes: 'Drop POST /api/cmdk/resolve handler mount and remove the cmdk_ai_actions flag row.',
});
