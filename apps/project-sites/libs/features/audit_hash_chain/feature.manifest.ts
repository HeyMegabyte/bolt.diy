/**
 * @module libs/features/audit_hash_chain
 *
 * Feature manifest for the Hash-Chained Audit Log (idea #46).
 * Closes the existing `audit_hash_chain` flag with a parallel ledger
 * (`audit_log_chain`) keyed on `audit_logs.id`.
 *
 * Extends `src/services/audit.ts` without modifying it — `writeAuditLog`
 * keeps its append-only contract; this module appends a chained row
 * immediately afterwards.
 *
 * Sells the Enterprise tier (#44). EU AI Act high-risk obligations from
 * Aug 2 2026 require tamper-evident audit trails for high-risk systems.
 */

import { defineFeatureManifest } from '@projectsites/feature-manifests';

export default defineFeatureManifest({
  slug: 'audit_hash_chain',
  name: 'Hash-Chained Audit Log',
  description:
    'SHA-256 hash chain over audit_logs entries for tamper-evident SOC 2 / EU AI Act compliance. Parallel ledger; the canonical audit_logs table is never mutated.',
  lifecycle: 'alpha',
  flagKey: 'audit_hash_chain',
  owner: 'brian@megabyte.space',
  createdAt: '2026-05-28',
  updatedAt: '2026-05-28',

  routes: ['/admin/audit-chain'],
  apiRoutes: [
    'GET  /api/audit-chain',
    'GET  /api/audit-chain/verify',
    'POST /api/audit-chain/append',
  ],

  permissions: ['audit:read', 'audit:write'],
  dependencies: [],

  // DRIFT: e2e/audit_hash_chain/ specs not yet authored; unit tests live
  // colocated at libs/features/audit_hash_chain/__tests__/ (Jest finds them
  // via discovery; validator only accepts src/__tests__/ prefix). Move on
  // next sweep per [[e2e-tdd-organization]].
  e2eTests: [],
  unitTests: [],
  integrationTests: [],
  testStatus: 'partial',

  zodSchemas: ['libs/features/audit_hash_chain/schemas.ts'],

  observability: {
    sentry: true,
    logs: true,
    analytics: true,
  },

  rollout: {
    defaultEnabled: false,
    environments: { development: true },
    notes:
      'Promote to beta once writeAuditLog is wired to appendEntry across all critical actions (auth, billing, site lifecycle). Stable after a scheduled verifyChain cron runs daily with zero break_at_sequence events for 30 days.',
  },

  risks: [
    'appendEntry is best-effort; a Worker crash between writeAuditLog and appendEntry leaves the canonical row without a chain row. The verify route detects this as a sequence gap, and a reconciliation job is required to backfill.',
    'D1 unique index on (org_id, sequence) catches races but turns them into errors — the audit log itself is never lost, only the chain row.',
    'Hash chain is per-org; cross-org tamper detection requires aggregating last_hash into a separate Merkle anchor.',
  ],

  removalNotes:
    'Drop table audit_log_chain. Remove route mount. Drop FLAG_REGISTRY.audit_hash_chain. audit_logs table remains untouched.',
});
