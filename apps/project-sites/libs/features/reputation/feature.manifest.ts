/**
 * @module libs/features/reputation
 *
 * Feature manifest for the Reputation suite — three review-lifecycle
 * capabilities sharing one module (ideas #10, #11, #13):
 *   - #10 AI review-request engine (flag `review_requests`)
 *   - #11 AI review responder drafts (flag `review_responder`)
 *   - #13 multi-platform reputation monitor (flag `reputation_monitor` — primary)
 *
 * Registry entry only — logic lives in this module's `service.ts` + `handlers.ts`.
 * Each route is gated by its OWN flag so the three features roll out independently.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'reputation',
  name: 'Reputation Suite',
  description:
    'Review-request engine, AI on-brand reply drafter, and multi-platform reputation monitor. Three independent flags: reputation_monitor, review_requests, review_responder.',
  lifecycle: 'in-development',
  flagKey: 'reputation_monitor',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'POST /api/sites/:id/reputation/review-request',
    'POST /api/sites/:id/reputation/reply-draft',
    'GET  /api/sites/:id/reputation/monitor',
  ],

  // ---- governance ----
  permissions: ['sites:write', 'sites:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/reputation/__tests__/reputation.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/reputation/schemas.ts'],

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
      'Experimental. Each route gated by its own flag (review_requests / review_responder / reputation_monitor); off → 404. ' +
      'Beta after: an admin surface to send requests + review the reply drafts + a per-platform monitor widget.',
  },

  risks: [
    'Review-request channel (email/SMS) depends on Resend / Twilio being configured; an unconfigured rail throws and the request is logged as failed.',
    'Reply drafts are best-effort LLM output — must be human-reviewed before posting; never auto-published.',
    'Reputation snapshot only live-fetches Google via Places; other platforms read cached rows that an external sync must populate.',
  ],

  removalNotes:
    'Remove: this module, migration 0526_reputation.sql, the reputation app.route() mount in src/index.ts, ' +
    'and the review_requests / review_responder / reputation_monitor entries from the flag registry.',
});
