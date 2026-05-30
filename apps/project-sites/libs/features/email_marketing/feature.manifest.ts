/**
 * @module libs/features/email_marketing
 *
 * Feature manifest for Email Marketing — a real campaign send pipeline built on
 * the existing `newsletter_campaigns` table. Audience = consented `contacts`
 * (contacts_core, consent_email=1) + confirmed newsletter subscribers, deduped;
 * delivery via Resend batch. Replaces the `newsletterCreateCampaign` stub's
 * fabricated recipient count with a real one. Third consumer of contacts_core.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'email_marketing',
  name: 'Email Marketing',
  description:
    'Real newsletter-campaign send pipeline on the existing newsletter_campaigns table: resolves consented contacts ' +
    '(contacts_core) + confirmed subscribers deduped by email, sends via Resend batch, and reports true recipient counts (replacing the stub 1247).',
  lifecycle: 'alpha',
  flagKey: 'email_marketing',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-29',
  updatedAt: '2026-05-29',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET /api/marketing/campaigns/:id/recipients',
    'POST /api/marketing/campaigns/:id/send',
  ],

  // ---- governance ----
  permissions: ['marketing:send'],
  dependencies: ['contacts_core'],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['../libs/features/email_marketing/__tests__/email_marketing.test.ts'],
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
      'Beta after: real send verified against a test org + unsubscribe link in the body + dedicated E2E spec.',
  },

  risks: [
    'Sends real email when enabled — flag-gated off + explicit POST /send only. A misconfigured campaign emails the whole consented audience.',
    'Unsubscribe links are signed with STRIPE_WEBHOOK_SECRET reused purely as an HMAC key (no env.ts edit needed); provision a dedicated UNSUBSCRIBE_SECRET later for key hygiene.',
    'consent_email comes from capture surfaces; a contact recorded without explicit opt-in must not be emailed — only consent_email=1 contacts are resolved.',
  ],

  removalNotes:
    'Remove: this module, the emailMarketing app.route() mount in src/index.ts, and the email_marketing flag in registry.ts. ' +
    'No migration to revert — it reads/updates the existing newsletter_campaigns table.',
});
