/**
 * @module libs/features/unified_inbox
 *
 * Feature manifest for the Unified Visitor Inbox (big-bets feature #24).
 * Multi-channel identity resolution + conversation management + AI-drafted replies.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'unified_inbox',
  name: 'Unified Visitor Inbox',
  description:
    'Big-bets #24 — forms+chat+voice+email+SMS unified under one visitor identity (cross-channel ' +
    'resolution by email/phone/visitor_id/anon_id), SLA-tracked conversations assignable to staff, ' +
    'AI-drafted channel-native replies; 3-pane admin at /admin/inbox.',
  lifecycle: 'alpha',
  flagKey: 'unified_inbox',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/inbox'],
  apiRoutes: [
    'GET  /api/inbox/conversations',
    'GET  /api/inbox/conversations/:id',
    'POST /api/inbox/conversations/:id/reply',
    'POST /api/inbox/conversations/:id/assign',
    'POST /api/inbox/conversations/:id/status',
    'POST /api/inbox/conversations/:id/draft-with-ai',
  ],

  // ---- governance ----
  permissions: ['sites:read'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [
    'inbox/inbox.spec.ts',
    '_fortress/inbox/happy-path.spec.ts',
    '_fortress/inbox/adversarial.spec.ts',
  ],
  unitTests: [
    // DRIFT: no dedicated unit test
    // Needs: src/__tests__/inbox.test.ts covering resolveOrCreateIdentity,
    //        listConversations, appendMessage, draftReplyWithAI
  ],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // ReplyBodySchema, AssignBodySchema, ConversationStatusBodySchema inline in routes/inbox.ts
    // DRIFT: should be extracted to libs/features/unified_inbox/schemas.ts
  ],

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
      'Experimental. Enable via /admin/feature-flags. ' +
      'Beta after: unit tests + SLA breach cron/alarm + push notifications on new conversation.',
  },

  risks: [
    'SLA deadline set but no automated escalation — breach is silent until an admin notices.',
    'last_used_at fire-and-forget update via ctx.waitUntil() — may not persist under low traffic.',
    'Cross-channel dispatch (SMS, voice, email) requires all provider credentials set; partial config silently skips channels.',
  ],

  removalNotes:
    'Remove: routes/inbox.ts, services/inbox.ts, services/visitor_identity.ts, ' +
    'frontend inbox.component.ts + /admin/inbox lazy route in app.routes.ts. ' +
    'Drop D1 tables: visitor_identities, conversations, messages (migration 0511_inbox.sql). ' +
    'Drop FLAG_REGISTRY entry.',
});
