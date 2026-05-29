/**
 * @module services/enterprise_plan
 *
 * Persistence + business logic for the Enterprise Plan feature module
 * ([[libs/features/enterprise_plan]]).
 *
 * Stripe product creation, Cloudflare Access SSO onboarding, and the R2
 * audit-bundle writer Workflow are intentionally OUT OF SCOPE here —
 * see the README for the "requires Brian" operational checklist.
 */

import type { Env } from '../types/env.js';
import {
  EnterpriseContractSchema,
  type EnterpriseContract,
  type EnterpriseContractUpdate,
  type SlaSnapshot,
  type SsoConfig,
  type AuditExport,
  type AuditExportRequest,
  AuditExportSchema,
  TIER_FLOORS_USD_PER_MONTH,
} from '../../libs/features/enterprise_plan/feature.schemas.js';

// ─── Contract ────────────────────────────────────────────────────────────────

interface ContractRow {
  id: string;
  org_id: string;
  plan_tier: string;
  sla_pct: number;
  sso_enabled: number;
  sso_provider: string | null;
  sso_metadata_url: string | null;
  custom_terms_md: string | null;
  dedicated_slack_channel: string | null;
  annual_value_cents: number;
  contract_start: string | null;
  contract_end: string | null;
  audit_export_enabled: number;
  contract_signed_url: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
}

function rowToContract(row: ContractRow): EnterpriseContract {
  return EnterpriseContractSchema.parse({
    id: row.id,
    org_id: row.org_id,
    plan_tier: row.plan_tier,
    sla_pct: row.sla_pct,
    sso_enabled: row.sso_enabled === 1,
    sso_provider: row.sso_provider,
    sso_metadata_url: row.sso_metadata_url,
    custom_terms_md: row.custom_terms_md,
    dedicated_slack_channel: row.dedicated_slack_channel,
    annual_value_cents: row.annual_value_cents,
    contract_start: row.contract_start,
    contract_end: row.contract_end,
    audit_export_enabled: row.audit_export_enabled === 1,
    contract_signed_url: row.contract_signed_url,
    status: row.status,
    notes: row.notes,
    updated_at: row.updated_at,
  });
}

export async function getContract(
  env: Env,
  orgId: string,
): Promise<EnterpriseContract | null> {
  const row = await env.DB.prepare(
    `SELECT id, org_id, plan_tier, sla_pct, sso_enabled, sso_provider,
            sso_metadata_url, custom_terms_md, dedicated_slack_channel,
            annual_value_cents, contract_start, contract_end,
            audit_export_enabled, contract_signed_url, status, notes,
            updated_at
       FROM enterprise_contracts
      WHERE org_id = ? AND deleted_at IS NULL
      LIMIT 1`,
  )
    .bind(orgId)
    .first<ContractRow>()
    .catch(() => null);
  if (!row) return null;
  return rowToContract(row);
}

/**
 * Upsert the contract row. When no row exists yet, we default-derive
 * `annual_value_cents` from `TIER_FLOORS_USD_PER_MONTH[planTier] × 12 × 100`.
 */
export async function upsertContract(
  env: Env,
  orgId: string,
  update: EnterpriseContractUpdate,
): Promise<EnterpriseContract> {
  const existing = await getContract(env, orgId);
  const planTier = update.plan_tier ?? existing?.plan_tier ?? 'enterprise-small';
  const defaultAcv = TIER_FLOORS_USD_PER_MONTH[planTier] * 12 * 100;
  const id = existing?.id ?? crypto.randomUUID();
  const next: EnterpriseContract = EnterpriseContractSchema.parse({
    id,
    org_id: orgId,
    plan_tier: planTier,
    sla_pct: update.sla_pct ?? existing?.sla_pct ?? 99.9,
    sso_enabled: update.sso_enabled ?? existing?.sso_enabled ?? false,
    sso_provider:
      update.sso_provider !== undefined
        ? update.sso_provider
        : (existing?.sso_provider ?? null),
    sso_metadata_url:
      update.sso_metadata_url !== undefined
        ? update.sso_metadata_url
        : (existing?.sso_metadata_url ?? null),
    custom_terms_md:
      update.custom_terms_md !== undefined
        ? update.custom_terms_md
        : (existing?.custom_terms_md ?? null),
    dedicated_slack_channel:
      update.dedicated_slack_channel !== undefined
        ? update.dedicated_slack_channel
        : (existing?.dedicated_slack_channel ?? null),
    annual_value_cents:
      update.annual_value_cents ?? existing?.annual_value_cents ?? defaultAcv,
    contract_start:
      update.contract_start !== undefined
        ? update.contract_start
        : (existing?.contract_start ?? null),
    contract_end:
      update.contract_end !== undefined
        ? update.contract_end
        : (existing?.contract_end ?? null),
    audit_export_enabled:
      update.audit_export_enabled ?? existing?.audit_export_enabled ?? true,
    contract_signed_url:
      update.contract_signed_url !== undefined
        ? update.contract_signed_url
        : (existing?.contract_signed_url ?? null),
    status: update.status ?? existing?.status ?? 'pending',
    notes:
      update.notes !== undefined ? update.notes : (existing?.notes ?? null),
    updated_at: new Date().toISOString(),
  });

  await env.DB.prepare(
    `INSERT INTO enterprise_contracts (
       id, org_id, plan_tier, sla_pct, sso_enabled, sso_provider,
       sso_metadata_url, custom_terms_md, dedicated_slack_channel,
       annual_value_cents, contract_start, contract_end,
       audit_export_enabled, contract_signed_url, status, notes,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id) DO UPDATE SET
       plan_tier               = excluded.plan_tier,
       sla_pct                 = excluded.sla_pct,
       sso_enabled             = excluded.sso_enabled,
       sso_provider            = excluded.sso_provider,
       sso_metadata_url        = excluded.sso_metadata_url,
       custom_terms_md         = excluded.custom_terms_md,
       dedicated_slack_channel = excluded.dedicated_slack_channel,
       annual_value_cents      = excluded.annual_value_cents,
       contract_start          = excluded.contract_start,
       contract_end            = excluded.contract_end,
       audit_export_enabled    = excluded.audit_export_enabled,
       contract_signed_url     = excluded.contract_signed_url,
       status                  = excluded.status,
       notes                   = excluded.notes,
       updated_at              = datetime('now')`,
  )
    .bind(
      next.id,
      next.org_id,
      next.plan_tier,
      next.sla_pct,
      next.sso_enabled ? 1 : 0,
      next.sso_provider,
      next.sso_metadata_url,
      next.custom_terms_md,
      next.dedicated_slack_channel,
      next.annual_value_cents,
      next.contract_start,
      next.contract_end,
      next.audit_export_enabled ? 1 : 0,
      next.contract_signed_url,
      next.status,
      next.notes,
    )
    .run();
  return next;
}

/** Returns just the SSO config slice (useful for the dedicated endpoint). */
export async function getSsoConfig(
  env: Env,
  orgId: string,
): Promise<SsoConfig> {
  const contract = await getContract(env, orgId);
  return {
    sso_enabled: contract?.sso_enabled ?? false,
    sso_provider: contract?.sso_provider ?? null,
    sso_metadata_url: contract?.sso_metadata_url ?? null,
  };
}

export async function updateSsoConfig(
  env: Env,
  orgId: string,
  config: SsoConfig,
): Promise<SsoConfig> {
  await upsertContract(env, orgId, {
    sso_enabled: config.sso_enabled,
    sso_provider: config.sso_provider,
    sso_metadata_url: config.sso_metadata_url,
  });
  return config;
}

// ─── SLA snapshots ───────────────────────────────────────────────────────────

interface SlaRow {
  measured_on: string;
  uptime_pct: number;
  incidents_count: number;
  p95_latency_ms: number | null;
  notes: string | null;
}

export async function listSlaSnapshots(
  env: Env,
  orgId: string,
  windowDays = 90,
): Promise<SlaSnapshot[]> {
  const rows = await env.DB.prepare(
    `SELECT measured_on, uptime_pct, incidents_count, p95_latency_ms, notes
       FROM enterprise_sla_metrics
      WHERE org_id = ?
        AND measured_on >= date('now', ?)
      ORDER BY measured_on DESC`,
  )
    .bind(orgId, `-${windowDays} days`)
    .all<SlaRow>()
    .catch(() => ({ results: [] as SlaRow[] }));

  return (rows.results ?? []).map((r) => ({
    measured_on: r.measured_on,
    uptime_pct: r.uptime_pct,
    incidents_count: r.incidents_count,
    p95_latency_ms: r.p95_latency_ms ?? undefined,
    notes: r.notes ?? undefined,
  }));
}

export async function appendSlaSnapshot(
  env: Env,
  orgId: string,
  snapshot: SlaSnapshot,
): Promise<SlaSnapshot> {
  await env.DB.prepare(
    `INSERT INTO enterprise_sla_metrics (
       id, org_id, measured_on, uptime_pct, incidents_count, p95_latency_ms, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id, measured_on) DO UPDATE SET
       uptime_pct       = excluded.uptime_pct,
       incidents_count  = excluded.incidents_count,
       p95_latency_ms   = excluded.p95_latency_ms,
       notes            = excluded.notes`,
  )
    .bind(
      crypto.randomUUID(),
      orgId,
      snapshot.measured_on,
      snapshot.uptime_pct,
      snapshot.incidents_count,
      snapshot.p95_latency_ms ?? null,
      snapshot.notes ?? null,
    )
    .run();
  return snapshot;
}

// ─── Audit exports ───────────────────────────────────────────────────────────

interface AuditExportRow {
  id: string;
  org_id: string;
  range_start: string;
  range_end: string;
  r2_key: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
}

function rowToExport(row: AuditExportRow): AuditExport {
  return AuditExportSchema.parse({
    id: row.id,
    org_id: row.org_id,
    range_start: row.range_start,
    range_end: row.range_end,
    status: row.status,
    r2_key: row.r2_key,
    expires_at: row.expires_at,
    created_at: row.created_at,
  });
}

export async function listAuditExports(
  env: Env,
  orgId: string,
  limit = 50,
): Promise<AuditExport[]> {
  const rows = await env.DB.prepare(
    `SELECT id, org_id, range_start, range_end, r2_key, status, expires_at, created_at
       FROM enterprise_audit_exports
      WHERE org_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(orgId, limit)
    .all<AuditExportRow>()
    .catch(() => ({ results: [] as AuditExportRow[] }));
  return (rows.results ?? []).map(rowToExport);
}

/**
 * Enqueue an audit export. The actual R2 ZIP writer Workflow is owned
 * elsewhere (see README "requires Brian"). This handler only persists the
 * request; status stays `pending` until the writer flips it to `ready`.
 */
export async function enqueueAuditExport(
  env: Env,
  orgId: string,
  request: AuditExportRequest,
  requestedBy: string | null,
): Promise<AuditExport> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO enterprise_audit_exports (
       id, org_id, requested_by, range_start, range_end, status
     ) VALUES (?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(id, orgId, requestedBy, request.range_start, request.range_end)
    .run();
  return AuditExportSchema.parse({
    id,
    org_id: orgId,
    range_start: request.range_start,
    range_end: request.range_end,
    status: 'pending',
    r2_key: null,
    expires_at: null,
    created_at: new Date().toISOString(),
  });
}
