/**
 * @module libs/features/ai_components
 *
 * Feature manifest for the AI Code Components Generator (IDEAS-50 #42).
 * Describe a widget in natural language, get a production React component
 * scaffolded with the site brand tokens auto-inherited from _brand.json.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'ai_components',
  name: 'AI Code Components',
  description:
    'Describe a widget in natural language. Get a production React component with the site brand tokens inherited from _brand.json. Can be published to the plugin marketplace.',
  lifecycle: 'in-development',
  flagKey: 'ai_components',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'POST /api/sites/:siteId/ai-components/generate',
    'GET  /api/sites/:siteId/ai-components',
    'GET  /api/ai-components/:id',
    'POST /api/ai-components/:id/regenerate',
    'POST /api/ai-components/:id/publish',
    'DELETE /api/ai-components/:id',
  ],

  // ---- governance ----
  permissions: ['sites:read', 'sites:write'],
  dependencies: ['plugin_marketplace'],

  // ---- tests ----
  // Full unit coverage shipped — service + handlers implemented, not stubbed.
  // E2E specs still outstanding (DRIFT) — required before beta promotion per
  // [[e2e-tdd-organization]].
  e2eTests: [],
  unitTests: ['src/__tests__/ai_components.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/ai_components/feature.schemas.ts'],

  // ---- observability ----
  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  // ---- rollout ----
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Beta after: Llama 4 Scout migration for vision-aware generation + admin tab on site detail + sandbox validation of generated code.',
  },

  risks: [
    'Generated code is untrusted until validated in the sandbox per [[sandbox-execution]]; never executes in the main Worker runtime.',
    'AI may hallucinate API surfaces or imports — schema validation at the boundary catches obvious bad output but does not guarantee runtime safety.',
    'Brand-token injection is best-effort — if _brand.json is missing the component falls back to default theme.',
    'Publish-to-marketplace flow assumes the user accepts the 70/30 plugin marketplace split.',
  ],

  removalNotes:
    'Remove: src/routes/ai_components.ts, src/services/ai_components.ts, app.route mount in src/index.ts. ' +
    'Drop table ai_components from migration 0520. Drop FLAG_REGISTRY entry ai_components.',
});
