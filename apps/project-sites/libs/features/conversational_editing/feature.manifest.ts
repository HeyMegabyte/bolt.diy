/**
 * @module libs/features/conversational_editing
 *
 * Feature manifest for Conversational Editing (idea #1).
 * Natural-language site editing → reversible, parent-chained changesets.
 * Workers AI maps the request to file operations; every applied edit records
 * before/after content hashes; undo is forward-only (revert = new changeset).
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'conversational_editing',
  name: 'Conversational Editing',
  description:
    'Natural-language site editing with reversible, parent-chained changesets. Workers AI Llama 3.3 70B FP8 ' +
    'maps each request (e.g. "make the hero darker, add a pricing table") to typed file operations; every ' +
    'applied edit records before/after SHA-256 hashes per file plus an R2 bundle. Undo is forward-only — ' +
    'reverting creates a new changeset chained to the original, so the full edit history is always preserved.',
  lifecycle: 'in-development',
  flagKey: 'conversational_editing',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [
    // DRIFT: Angular admin changeset-timeline component not yet built
  ],
  apiRoutes: [
    'POST /api/conversational-edits/:siteId/intent',
    'POST /api/conversational-edits/:siteId/apply',
    'POST /api/conversational-edits/:siteId/revert/:changesetId',
    'GET  /api/conversational-edits/:siteId/history',
    'GET  /api/conversational-edits/changesets/:changesetId/diff',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    // DRIFT: e2e/conversational_editing/ directory not yet built
  ],
  unitTests: ['__tests__/conversational_editing.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/conversational_editing/feature.schemas.ts'],

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
      'Experimental. Enable via /admin/feature-flags. Server guards return 404 when off (never 403). ' +
      'Beta after: dedicated E2E spec + admin changeset-timeline Angular component + checkout-from-changeset wiring.',
  },

  risks: [
    'Workers AI intent extraction can hallucinate file paths — extractor filters operations to the supplied file list and clamps confidence.',
    'R2 bundle write is best-effort; D1 changeset is the source of truth even if the slug cannot be resolved.',
    'No retention/GC on old changeset bundles — long-lived sites accumulate R2 objects under sites/{slug}/changesets/.',
  ],

  removalNotes:
    'Remove: src/routes/conversational_edits.ts, src/services/changeset_service.ts, ' +
    'src/services/edit_intent_extractor.ts, src/__tests__/conversational_editing.test.ts, ' +
    'libs/features/conversational_editing/, migration 0519 tables (site_changesets, changeset_files), ' +
    "app.route('/api/conversational-edits', ...) mount in src/index.ts, and the FLAG_REGISTRY entry.",
});
