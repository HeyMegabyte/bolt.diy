/**
 * @module libs/features/enterprise_plan/schemas
 *
 * Zod schemas for the Enterprise Plan feature module.
 */

import { z } from 'zod';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const EnterprisePlanTierSchema = z.enum([
  'enterprise-small',
  'enterprise-mid',
  'enterprise-large',
]);
export type EnterprisePlanTier = z.infer<typeof EnterprisePlanTierSchema>;

export const SsoProviderSchema = z.enum([
  'saml',
  'oidc',
  'cloudflare-access',
]);
export type SsoProvider = z.infer<typeof SsoProviderSchema>;

export const ContractStatusSchema = z.enum([
  'pending',
  'active',
  'churned',
  'cancelled',
]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const AuditExportStatusSchema = z.enum([
  'pending',
  'ready',
  'expired',
  'failed',
]);
export type AuditExportStatus = z.infer<typeof AuditExportStatusSchema>;

// ─── Per-tier price floors (display only — Stripe owns the source of truth) ──

/**
 * Display-only ACV floors per tier. Stripe product creation is deferred to
 * Brian; these values back the admin "select-a-tier" UI until then.
 */
export const TIER_FLOORS_USD_PER_MONTH: Record<EnterprisePlanTier, number> = {
  'enterprise-small': 500,
  'enterprise-mid': 1000,
  'enterprise-large': 2000,
};

// ─── Contract shape ──────────────────────────────────────────────────────────

export const EnterpriseContractSchema = z.object({
  id: z.string().min(1),
  org_id: z.string().min(1),
  plan_tier: EnterprisePlanTierSchema,
  sla_pct: z.number().min(0).max(100),
  sso_enabled: z.boolean(),
  sso_provider: SsoProviderSchema.nullable(),
  sso_metadata_url: z.string().url().nullable(),
  custom_terms_md: z.string().max(50_000).nullable(),
  dedicated_slack_channel: z.string().max(120).nullable(),
  annual_value_cents: z.number().int().min(0),
  contract_start: z.string().nullable(),
  contract_end: z.string().nullable(),
  audit_export_enabled: z.boolean(),
  contract_signed_url: z.string().url().nullable(),
  status: ContractStatusSchema,
  notes: z.string().nullable(),
  updated_at: z.string(),
});
export type EnterpriseContract = z.infer<typeof EnterpriseContractSchema>;

export const EnterpriseContractUpdateSchema = z.object({
  plan_tier: EnterprisePlanTierSchema.optional(),
  sla_pct: z.number().min(0).max(100).optional(),
  sso_enabled: z.boolean().optional(),
  sso_provider: SsoProviderSchema.nullable().optional(),
  sso_metadata_url: z.string().url().nullable().optional(),
  custom_terms_md: z.string().max(50_000).nullable().optional(),
  dedicated_slack_channel: z.string().max(120).nullable().optional(),
  annual_value_cents: z.number().int().min(0).optional(),
  contract_start: z.string().nullable().optional(),
  contract_end: z.string().nullable().optional(),
  audit_export_enabled: z.boolean().optional(),
  contract_signed_url: z.string().url().nullable().optional(),
  status: ContractStatusSchema.optional(),
  notes: z.string().nullable().optional(),
});
export type EnterpriseContractUpdate = z.infer<
  typeof EnterpriseContractUpdateSchema
>;

// ─── SSO config shape ────────────────────────────────────────────────────────

export const SsoConfigSchema = z.object({
  sso_enabled: z.boolean(),
  sso_provider: SsoProviderSchema.nullable(),
  sso_metadata_url: z.string().url().nullable(),
});
export type SsoConfig = z.infer<typeof SsoConfigSchema>;

// ─── SLA snapshot ────────────────────────────────────────────────────────────

export const SlaSnapshotSchema = z.object({
  measured_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'measured_on must be YYYY-MM-DD'),
  uptime_pct: z.number().min(0).max(100),
  incidents_count: z.number().int().min(0).default(0),
  p95_latency_ms: z.number().int().min(0).optional(),
  notes: z.string().max(2_000).optional(),
});
export type SlaSnapshot = z.infer<typeof SlaSnapshotSchema>;

// ─── Audit export request ────────────────────────────────────────────────────

export const AuditExportRequestSchema = z
  .object({
    range_start: z.string(),
    range_end: z.string(),
  })
  .refine((v) => new Date(v.range_start) <= new Date(v.range_end), {
    message: 'range_start must be ≤ range_end',
    path: ['range_start'],
  });
export type AuditExportRequest = z.infer<typeof AuditExportRequestSchema>;

export const AuditExportSchema = z.object({
  id: z.string().min(1),
  org_id: z.string().min(1),
  range_start: z.string(),
  range_end: z.string(),
  status: AuditExportStatusSchema,
  r2_key: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
export type AuditExport = z.infer<typeof AuditExportSchema>;

// ─── SLA helpers ─────────────────────────────────────────────────────────────

/**
 * Compute the trailing-window uptime average from a list of daily snapshots.
 * Returns the mean uptime_pct, or `null` when no snapshots are present.
 *
 * Pure — easy to test, no D1 dependency.
 */
export function rollingUptimePct(snapshots: SlaSnapshot[]): number | null {
  if (snapshots.length === 0) return null;
  const sum = snapshots.reduce((acc, s) => acc + s.uptime_pct, 0);
  return sum / snapshots.length;
}

/**
 * Returns true when the rolling uptime breaches the contracted SLA. Useful
 * for surfacing a "SLA at risk" badge in `/admin/enterprise`.
 */
export function isSlaBreached(rolling: number | null, slaPct: number): boolean {
  if (rolling === null) return false;
  return rolling < slaPct;
}
