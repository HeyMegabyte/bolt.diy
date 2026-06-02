/**
 * @module libs/features/outbound_webhooks
 *
 * Feature manifest for Outbound Webhooks (idea #10, P1) — customers subscribe
 * their own endpoints to site events, delivered signed + retried.
 *
 * Registry entry only — source lives in src/services/outbound_webhooks.ts
 * (delivery policy + validation + encrypt-backed CRUD) + src/routes/webhooks_admin.ts.
 * The dispatch fan-out (sign + deliver + record attempts) is a later slice.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'outbound_webhooks',
  name: 'Outbound Webhooks',
  description:
    'Customers subscribe https endpoints to site events; deliveries are HMAC-signed + retried with backoff. Signing secret encrypted at rest. CRUD under /api/sites/:siteId/webhooks.',
  lifecycle: 'in-development',
  flagKey: 'outbound_webhooks',
  owner: 'brian@megabyte.space',
  createdAt: '2026-06-02',
  updatedAt: '2026-06-02',

  // ---- surfaces ----
  routes: [],
  apiRoutes: [
    'GET /api/sites/:siteId/webhooks',
    'POST /api/sites/:siteId/webhooks',
    'DELETE /api/sites/:siteId/webhooks/:id',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['__tests__/outbound_webhooks.test.ts'],
  integrationTests: [],
  testStatus: 'partial',

  // ---- schemas ----
  zodSchemas: [],

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
      'Experimental. Flag-gated CRUD returns 404 when off. Endpoints validated ' +
      '(https-only + event allowlist), signing secret AES-GCM encrypted at rest in ' +
      'webhook_endpoints (migration 0534), secret shown once on create. Beta after: ' +
      'the dispatch fan-out (sign + retry via the delivery-policy core, webhook_deliveries ' +
      'table, SSRF host-block) + an Angular admin surface.',
  },

  risks: [
    'Customer-supplied URLs are an SSRF surface — https-only mitigates plaintext, but the dispatch slice MUST block internal/localhost hosts before fetching.',
    'A misbehaving endpoint could be hammered — the delivery-policy core caps attempts at 6 with exponential backoff; only transient failures retry.',
  ],

  removalNotes:
    'Remove: routes/webhooks_admin.ts, the CRUD + delivery-policy code in services/outbound_webhooks.ts, ' +
    'libs/features/outbound_webhooks/, migration 0534_webhook_endpoints.sql, the outbound_webhooks ' +
    "FLAG_REGISTRY entry, and the app.route('/', webhooksAdmin) mount in src/index.ts.",
});
