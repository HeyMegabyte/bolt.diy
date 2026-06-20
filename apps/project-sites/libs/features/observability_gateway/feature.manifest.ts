import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'observability_gateway',
  name: 'Customer-Site Observability Gateway',
  description:
    'Worker proxy that customer sites POST their Sentry/PostHog events to, so raw vendor ' +
    'keys never ship to the browser. Every event is tenant-tagged, PII-redacted, sampled, ' +
    'and quota-capped before forwarding server-side to the vendor. Rollup datapoints are ' +
    'written to Analytics Engine keyed by {orgId, siteId, provider}.',
  lifecycle: 'alpha',
  flagKey: 'observability_gateway',
  owner: 'hey@megabyte.space',
  createdAt: '2026-06-19',
  updatedAt: '2026-06-19',
  routes: [],
  apiRoutes: ['POST /monitoring/:provider'],
  permissions: [],
  dependencies: [],
  e2eTests: [],
  unitTests: [
    '../libs/features/observability_gateway/__tests__/observability_gateway.test.ts',
  ],
  integrationTests: [],
  testStatus: 'partial',
  zodSchemas: ['schemas.ts'],
  observability: { sentry: false, logs: true, analytics: true },
  rollout: {
    defaultEnabled: false,
    environments: { development: false },
    notes:
      'Experimental. Enable per-site after verifying SENTRY_INGEST_KEY and POSTHOG_INGEST_KEY ' +
      'secrets are set. Vendor keys must NEVER be in customer bundle — this gateway is the only ' +
      'path to forward events.',
  },
  risks: [
    'Vendor 5xx causes silent event drop (intentional fail-soft — customer site still gets 202).',
    'KV quota counter drift if TTL races; bursts may slip through at rollover boundaries.',
    'PII-redaction is a best-effort regex sweep — structured objects with PII in non-standard fields are not guaranteed clean.',
    'Disabling the flag mid-session means customer-site instrumentation goes dark (they have no fallback SDK key).',
  ],
  removalNotes:
    'Delete KV keys matching monitor:* pattern. Remove SENTRY_INGEST_KEY and ' +
    'POSTHOG_INGEST_KEY secrets via `wrangler secret delete`. Remove the ' +
    'observabilityGateway import and app.route() line from src/index.ts.',
});
