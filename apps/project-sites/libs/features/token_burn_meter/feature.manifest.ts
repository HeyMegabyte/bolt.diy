/**
 * @module libs/features/token_burn_meter
 *
 * Feature manifest for the per-tenant Token-Burn Meter + Budget Killswitch
 * (idea #13). Caps AI spend per org BEFORE a container build runs and exposes
 * a meter API.
 *
 * Registry entry only — the budget logic lives in `src/services/build_budget.ts`
 * (checkBudget + recordSpend) and this module's `service.ts` wraps it; the
 * killswitch fires in `src/workflows/site-generation.ts` before the build step.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'token_burn_meter',
  name: 'Token-Burn Meter + Budget Killswitch',
  description:
    'Per-tenant AI-spend meter that accumulates token cost in usage_events and caps spend per org per month ' +
    'with a killswitch: site-generation throws a friendly error before the expensive container build when the cap is hit.',
  lifecycle: 'alpha',
  flagKey: 'token_burn_meter',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET /api/usage/budget',
    'GET /api/admin/usage/budget',
  ],

  // ---- governance ----
  permissions: ['billing:read', 'admin:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/token_burn_meter/__tests__/build_budget.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: ['schemas.ts'],

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
      'Beta after: spend recorded on every LLM phase + admin meter UI + dedicated E2E spec.',
  },

  risks: [
    'Token counts from the container build are best-effort; spend may under-count if the LLM phase omits usage.',
    'Killswitch blocks builds once the monthly cap is hit — an admin must raise the plan cap or wait for the calendar-month reset.',
    'Spend reuses usage_events; a KV/D1 outage during recordSpend silently under-counts without failing the build.',
  ],

  removalNotes:
    'Remove: this module, src/services/build_budget.ts, the tokenBurnMeter app.route() mount in src/index.ts, ' +
    'and the checkBudget/recordSpend calls in workflows/site-generation.ts. Drop the token_burn_meter flag.',
});
