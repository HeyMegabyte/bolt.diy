/**
 * @module libs/features/seo_autopilot
 *
 * Feature manifest for SEO/GEO Autopilot (idea #23).
 * For an EXISTING generated site, AI produces length-bounded SEO meta
 * (title 50-60, description 120-156) + a 40-60 word AI-search quotable answer
 * block + schema.org JSON-LD per route. Drafts land 'pending' for owner approval
 * — never auto-published. Approval advances D1 status; the publish hook
 * (applyToSite) is the documented integration point with site_serving.
 *
 * Registry entry only — source lives in src/services + src/routes.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'seo_autopilot',
  name: 'SEO/GEO Autopilot',
  description:
    'AI generates SEO/GEO meta for an existing site: title (50-60 chars), meta description (120-156 chars), ' +
    'and a 40-60 word AI-search quotable answer block tuned for ChatGPT/Perplexity/Google AI Overviews citation, ' +
    'plus schema.org JSON-LD (WebPage floor; FAQPage only with real Q&A). Drafts are pending until owner approval.',
  lifecycle: 'in-development',
  flagKey: 'seo_autopilot',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: [
    // DRIFT: Angular admin component for /admin/seo not yet built
  ],
  apiRoutes: [
    'POST /api/seo/:siteId/freshen',
    'GET  /api/seo/:siteId/drafts',
    'GET  /api/seo/:siteId/drafts/:draftId',
    'POST /api/seo/drafts/:draftId/approve',
    'GET  /api/seo/:siteId/jsonld',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['src/__tests__/seo_autopilot.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/seo_autopilot/feature.schemas.ts'],

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
      'Experimental. Approval-gated — drafts are pending until an owner approves; nothing auto-publishes. ' +
      'Beta after: applyToSite wired into site_serving (R2 HTML rewrite + host KV purge) + admin Angular component + E2E specs.',
  },

  risks: [
    'Workers AI Llama meta may need brand-voice context injection to avoid generic copy.',
    'applyToSite is a D1-only stub — approved drafts do not yet rewrite served HTML until site_serving integration lands.',
    'Char/word clamping can truncate AI copy mid-thought when the model overshoots the bounds.',
    'Freshen runs Workers AI per route — large sites can incur AI cost; gate by org tier before promotion.',
  ],

  removalNotes:
    'Remove: src/routes/seo_autopilot.ts, src/services/seo_autopilot.ts, ' +
    'app.route("/api/seo", ...) mount in src/index.ts, libs/features/seo_autopilot/, ' +
    'migration 0518 (table seo_meta_drafts), FLAG_REGISTRY seo_autopilot entry.',
});
