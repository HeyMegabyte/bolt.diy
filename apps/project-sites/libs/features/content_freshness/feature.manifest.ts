/**
 * @module libs/features/content_freshness
 *
 * Feature manifest for Content Freshness.
 * Daily Cron + Cloudflare Workflow: scans site sections for staleness (>90 d),
 * AI-rewrites via Workers AI Llama, posts approval drafts to Task Inbox,
 * publishes on owner approval.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'content_freshness',
  name: 'Content Freshness',
  description:
    'Daily Cron (06:00 UTC) + Cloudflare Workflow scans site sections for staleness (>90 d), ' +
    'AI-rewrites stale copy via Workers AI Llama 3.3 70B FP8, posts approval drafts to Task Inbox; ' +
    'owner approves/rejects via admin UI at /admin/sites/:id/freshness.',
  lifecycle: 'alpha',
  flagKey: 'content_freshness',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [
    // DRIFT: Angular admin component for /admin/sites/:id/freshness not yet built
  ],
  apiRoutes: [
    'GET  /freshness',
    'GET  /freshness/:draftId',
    'POST /freshness/approve/:draftId',
    'POST /freshness/reject/:draftId',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: ['content/content-freshness.spec.ts'],
  unitTests: [
    // DRIFT: no dedicated unit test
    // Needs: src/__tests__/content_freshness.test.ts covering scanStaleSections,
    //        rewriteSection, createRewriteDraft
  ],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [
    // No Zod schemas extracted yet — validation inline in routes/content.ts
    // DRIFT: should have libs/features/content_freshness/schemas.ts
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
      'Experimental. Cron-triggered — when flag is off, scheduledContentFreshness() returns early. ' +
      'Beta after: unit tests + dedicated D1 content_freshness_drafts table + admin Angular component.',
  },

  risks: [
    'Workers AI Llama rewrite may diverge from brand voice without brand-context injection.',
    'Draft state uses task_inbox table — no dedicated schema makes queries awkward.',
    'No Angular admin component yet — /admin/sites/:id/freshness 404s on the SPA.',
    'Cron runs regardless of org tier — could incur AI costs for free-plan sites.',
  ],

  removalNotes:
    'Remove: routes/content.ts, services/content_freshness.ts, ' +
    'workflows/content-freshness-workflow.ts, ContentFreshnessWorkflow export in src/index.ts, ' +
    'CONTENT_FRESHNESS_WORKFLOW binding in wrangler.toml, ' +
    'cron trigger in wrangler.toml (scheduled handler at 06:00 UTC), FLAG_REGISTRY entry.',
});
