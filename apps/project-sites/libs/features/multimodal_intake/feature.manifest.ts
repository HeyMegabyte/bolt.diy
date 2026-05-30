/**
 * @module libs/features/multimodal_intake
 *
 * Feature manifest for Multimodal Intake (idea #18). A visitor on a generated
 * site's booking page uploads a PHOTO of their problem plus an optional VOICE
 * note; AI transcribes the audio, describes the photo via a vision LLM, merges
 * both into a structured intent, prefills the quote/booking form, records a
 * lead, and (when `native_booking_engine` is on) proposes a booking slot.
 *
 * Backend lives in this module's `service.ts` + `handlers.ts`; the drop-in
 * generated-site section lives in `section/intake-booking-section.html` and is
 * registered in the `section_marketplace` catalog (migration 0530) so the
 * generator can place it on `/book` pages.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'multimodal_intake',
  name: 'Multimodal Intake',
  description:
    'Booking-page intake where a visitor uploads a photo of their problem plus an optional voice note; ' +
    'AI transcribes audio, describes the photo, extracts intent + urgency, prefills the quote form, records a lead, and proposes a booking.',
  lifecycle: 'alpha',
  flagKey: 'multimodal_intake',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-30',
  updatedAt: '2026-05-30',

  // ---- surfaces ----
  routes: [],
  apiRoutes: ['POST /api/sites/:id/intake'],

  // ---- governance ----
  permissions: [],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/multimodal_intake/__tests__/multimodal_intake.test.ts'],
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
      'Feeds native_booking_engine. Beta after: vision + Whisper paths proven on a live generated site + dedicated E2E spec.',
  },

  risks: [
    'Vision/transcription is best-effort; a missing OPENAI/ANTHROPIC key degrades to an empty intent rather than failing the request.',
    'Urgency scoring is heuristic — the LLM may over- or under-estimate; the booking proposal is advisory, never auto-charged.',
    'Photo/audio R2 keys must be org-scoped uploads; the route trusts the caller-supplied keys and never reads outside the media prefix.',
  ],

  removalNotes:
    'Remove: this module, the multimodalIntake app.route() mount in src/index.ts, the multimodal_intake flag entry in ' +
    'modules/feature_flags/registry.ts, the intake-booking section rows in section_marketplace (migration 0530), and drop the intake_submissions table.',
});
