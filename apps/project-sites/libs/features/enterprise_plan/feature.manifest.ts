/**
 * @module libs/features/enterprise_plan
 *
 * Feature manifest for the Enterprise Plan tier (idea #44).
 *
 * Code-ready scaffold: D1 schema + admin surface + audit-export endpoint +
 * SLA-metric ingest + Cloudflare Access SSO wiring scaffolding (SAML + OIDC).
 *
 * Stripe product creation, Cloudflare Access onboarding, and SLO/SLI
 * burn-rate alert config are deferred — they require Brian to provision
 * vendor accounts. See README for the "requires Brian" checklist.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'enterprise_plan',
  name: 'Enterprise Plan',
  description:
    'Enterprise tier with Cloudflare Access SSO (SAML/OIDC), 99.9% SLA monitoring, audit-log export, custom terms, dedicated Slack. Stripe + Access provisioning deferred to Brian.',
  lifecycle: 'in-development',
  flagKey: 'enterprise_plan',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/enterprise'],
  apiRoutes: [
    'GET    /api/enterprise/contract',
    'PUT    /api/enterprise/contract',
    'GET    /api/enterprise/sla',
    'POST   /api/enterprise/sla/snapshot',
    'GET    /api/enterprise/audit-exports',
    'POST   /api/enterprise/audit-exports',
    'GET    /api/enterprise/sso/config',
    'PUT    /api/enterprise/sso/config',
  ],

  // ---- governance ----
  permissions: ['billing:read', 'billing:write'],
  dependencies: [],

  // ---- tests ----
  e2eTests: [],
  unitTests: ['__tests__/enterprise_plan.test.ts'],
  integrationTests: [],
  testStatus: 'passing',

  // ---- schemas ----
  zodSchemas: ['libs/features/enterprise_plan/feature.schemas.ts'],

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
      'Experimental. Beta after Brian: (a) creates Stripe enterprise-small/mid/large products, (b) provisions Cloudflare Access SSO app, (c) wires SLA SLO config in Workers Tracing. Code surfaces are flag-gated until then.',
  },

  risks: [
    'Stripe product wiring deferred — checkout endpoints will 501 until Brian provisions products.',
    'Cloudflare Access SSO endpoints accept metadata URLs but cannot complete OAuth handshake without vendor provisioning.',
    'SLA monitoring writes to enterprise_sla_metrics but requires a daily Workflow to populate — manual until wired.',
    'Audit export endpoint enqueues a job; R2 bundle writer is a separate Workflow not yet deployed.',
  ],

  removalNotes:
    'Remove: src/routes/enterprise_plan.ts, src/services/enterprise_plan.ts, /admin/enterprise component, migration 0520 enterprise_contracts/enterprise_sla_metrics/enterprise_audit_exports tables, FLAG_REGISTRY enterprise_plan entry.',
});
