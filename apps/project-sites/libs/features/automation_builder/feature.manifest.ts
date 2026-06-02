/**
 * @module libs/features/automation_builder
 *
 * Feature manifest for the Automation Builder (idea #11, P1) — no-code
 * trigger->action recipes (Zapier-lite) per site.
 *
 * Registry entry only — source lives in src/services/automation_builder.ts
 * (validation + matching + CRUD) + src/routes/automation.ts. Dispatch (firing
 * actions on platform events, reusing the #10 signer) is a later slice.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'automation_builder',
  name: 'Automation Builder',
  description:
    'No-code trigger-to-action recipes per site (Zapier-lite). Allowlisted trigger and action types, validated and persisted; dispatch fires on platform events. CRUD under /api/sites/:siteId/recipes.',
  lifecycle: 'in-development',
  flagKey: 'automation_builder',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-02',
  updatedAt: '2026-06-02',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET /api/sites/:siteId/recipes',
    'POST /api/sites/:siteId/recipes',
    'DELETE /api/sites/:siteId/recipes/:id',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['__tests__/automation_builder.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

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
      'Experimental. Flag-gated CRUD returns 404 when off. Recipes are validated ' +
      '(allowlisted trigger/action types) before persistence in automation_recipes ' +
      '(migration 0533). Beta after: the dispatch engine (fire actions on events via ' +
      'recipeMatchesEvent + the #10 outbound-webhook signer / email) + an Angular admin surface.',
  },

  risks: [
    'Recipes run actions on platform events — the allowlist + per-recipe enable flag bound what can fire; dispatch is not yet wired (CRUD only).',
    'A bad action config could fail at dispatch time — dispatch slice must validate config per action type + isolate failures per action.',
  ],

  removalNotes:
    'Remove: routes/automation.ts, the CRUD + matching code in services/automation_builder.ts, ' +
    'libs/features/automation_builder/, migration 0533_automation_recipes.sql, the automation_builder ' +
    "FLAG_REGISTRY entry, and the app.route('/', automation) mount in src/index.ts.",
});
