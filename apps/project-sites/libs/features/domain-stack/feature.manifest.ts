/**
 * @module libs/features/domain-stack
 *
 * Feature manifest for the Domain Stack Wizard (Wave 2B feature #10).
 * One-click domain stack setup: registrar → DNS → SSL → DMARC/SPF/DKIM/MX
 * → security.txt → GSC verification. Seven-step state machine.
 *
 * This file is the registry entry only — NO source files are moved here.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  // ---- identity ----
  slug: 'domain-stack',
  name: 'Domain Stack Wizard',
  description:
    'One-click domain stack: DNS + SSL + DMARC/SPF/DKIM + GSC in a ' +
    '7-step state machine. Gated by domain_stack_wizard flag.',
  lifecycle: 'alpha',
  flagKey: 'domain_stack_wizard',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  // ---- surfaces ----
  routes: ['/admin/sites/:id/domain-stack'],
  apiRoutes: [
    'GET  /api/sites/:siteId/hostnames',
    'POST /api/sites/:siteId/hostnames',
    'PUT  /api/sites/:siteId/hostnames/:hostnameId/primary',
    'POST /api/sites/:siteId/hostnames/reset-primary',
    'DELETE /api/sites/:siteId/hostnames/:hostnameId',
    'POST /api/sites/:siteId/hostnames/:hostnameId/unsubscribe',
    'GET  /api/domains/search',
    'POST /api/domains/purchase',
  ],

  // ---- governance ----
  permissions: ['sites:write'],
  dependencies: ['domain_reseller'],

  // ---- tests ----
  e2eTests: [
    'domain-management.spec.ts',
    'domain-and-files.spec.ts',
    'domain-stack/domain-stack.spec.ts',
    '_fortress/domain-stack/happy-path.spec.ts',
    '_fortress/domain-stack/adversarial.spec.ts',
  ],
  unitTests: [],
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
      'Alpha. Enable via /admin/feature-flags. ' +
      'Beta after: DMARC/SPF/DKIM verification polling + GSC ownership file auto-upload + unit tests.',
  },

  risks: [
    'CF for SaaS custom hostnames require a paid zone — provisioning silently fails on Free plan.',
    'DNS propagation delays (up to 48h) mean state machine may report "pending" for extended periods.',
    'Domain purchase via OpenSRS is a Tier 4 secret — not auto-provisioned.',
  ],

  removalNotes:
    'Remove: routes/api.ts hostname routes, services/domains.ts, ' +
    'frontend domain-stack.component.ts + /admin/sites/:id/domain-stack lazy route. ' +
    'Drop FLAG_REGISTRY entries: domain_stack_wizard, domain_reseller.',
});
