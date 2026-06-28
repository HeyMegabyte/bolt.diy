import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'upgrade_moments',
  name: 'Upgrade Moments — Contextual Upsell Engine',
  description:
    'Contextual, friction-point upgrade prompts. Each "moment" maps a free-plan ' +
    'friction point (custom domain, branding removal, page cap, AI credits, build ' +
    'priority, analytics depth) to an honest, value-led upsell attributed to its ' +
    'trigger. Paid plans are never nagged. Dismissals persist in KV for 90 days. ' +
    'This is the generous-free + paid-power-ups monetization seam for solo owners.',
  lifecycle: 'alpha',
  flagKey: 'upgrade_moments',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-28',
  updatedAt: '2026-06-28',
  routes: [],
  apiRoutes: [
    'GET /api/upgrade-moments',
    'GET /api/upgrade-moments/:trigger',
    'POST /api/upgrade-moments/:trigger/dismiss',
  ],
  permissions: ['billing:read'],
  dependencies: [],
  e2eTests: [],
  unitTests: ['../libs/features/upgrade_moments/__tests__/upgrade_moments.test.ts'],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: {
    axiom: true,
    logs: true,
    analytics: false,
  },
  rollout: {
    defaultEnabled: false,
    environments: {
      development: true,
    },
    notes:
      'Experimental. Enable via /admin/feature-flags. ' +
      'Beta after: a friction-point surface (custom-domain / page-cap) renders the ' +
      'moment + dismiss round-trips end-to-end, and cta_url billing attribution is verified.',
  },
  risks: [
    'cta_url price hints are display-only copy — the authoritative price lives in billing; a stale price_hint misleads but cannot mischarge.',
    'Dismissals are KV best-effort with a 90-day TTL; a KV outage during dismiss silently fails to hide the moment (it reappears) but never blocks the caller.',
    'Eligibility keys solely on plan tier passed by the caller; a spoofed plan=pro query only HIDES upsells (no privilege gain), so it is low-risk.',
  ],
  removalNotes:
    'Remove: this module, the app.route() mount in src/index.ts, and the ' +
    'upgrade_moments entry in src/modules/feature_flags/registry.ts. ' +
    'KV dismissal keys (upgmoment:dismiss:*) expire on their own.',
});
