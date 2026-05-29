/**
 * @module services/trust_center
 *
 * Persistence + business logic for the Trust Center feature module
 * ([[libs/features/trust_center]]).
 *
 * One row per `(org_id, site_id)` in `trust_profiles`. `site_id = NULL`
 * means the org-level default; non-NULL means a per-site override that
 * shadows the org-level profile on the public `/trust` page.
 */

import type { Env } from '../types/env.js';
import {
  TrustProfileSchema,
  type TrustProfile,
  type TrustProfileUpdate,
  type AiModelEntry,
  type ContentProvenanceEntry,
  type DataResidency,
  type AuditLogPolicy,
  type AiOutageBehavior,
} from '../../libs/features/trust_center/feature.schemas.js';

interface TrustProfileRow {
  id: string;
  org_id: string;
  site_id: string | null;
  ai_models_json: string;
  data_residency: string;
  audit_log_policy: string;
  content_provenance: string;
  ai_outage_behavior: string;
  custom_disclosures: string | null;
  published: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function safeJsonArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function rowToProfile(row: TrustProfileRow): TrustProfile {
  return TrustProfileSchema.parse({
    id: row.id,
    org_id: row.org_id,
    site_id: row.site_id,
    ai_models: safeJsonArray<AiModelEntry>(row.ai_models_json, []),
    data_residency: row.data_residency as DataResidency,
    audit_log_policy: row.audit_log_policy as AuditLogPolicy,
    content_provenance: safeJsonArray<ContentProvenanceEntry>(
      row.content_provenance,
      [],
    ),
    ai_outage_behavior: row.ai_outage_behavior as AiOutageBehavior,
    custom_disclosures: row.custom_disclosures,
    published: row.published === 1,
    published_at: row.published_at,
    updated_at: row.updated_at,
  });
}

async function selectProfile(
  env: Env,
  orgId: string,
  siteId: string | null,
): Promise<TrustProfile | null> {
  const row = await env.DB.prepare(
    `SELECT id, org_id, site_id, ai_models_json, data_residency,
            audit_log_policy, content_provenance, ai_outage_behavior,
            custom_disclosures, published, published_at,
            created_at, updated_at, deleted_at
       FROM trust_profiles
      WHERE org_id = ? AND deleted_at IS NULL
        AND (
          (? IS NULL AND site_id IS NULL)
          OR (site_id = ?)
        )
      LIMIT 1`,
  )
    .bind(orgId, siteId, siteId)
    .first<TrustProfileRow>()
    .catch(() => null);
  if (!row) return null;
  return rowToProfile(row);
}

/** Org-level profile (`site_id = NULL`). */
export async function getOrgProfile(
  env: Env,
  orgId: string,
): Promise<TrustProfile | null> {
  return selectProfile(env, orgId, null);
}

/** Per-site override (`site_id = <siteId>`). */
export async function getSiteProfile(
  env: Env,
  orgId: string,
  siteId: string,
): Promise<TrustProfile | null> {
  return selectProfile(env, orgId, siteId);
}

/**
 * Resolution order: per-site override → org-level profile → null.
 * Used by the public `/trust` route + the per-site admin override view.
 */
export async function getEffectiveProfileForSite(
  env: Env,
  orgId: string,
  siteId: string,
): Promise<TrustProfile | null> {
  const site = await getSiteProfile(env, orgId, siteId);
  if (site) return site;
  return getOrgProfile(env, orgId);
}

/**
 * Upsert a profile. `update` is a partial of the persisted shape — any
 * field left undefined is preserved from the existing row.
 */
export async function upsertProfile(
  env: Env,
  args: {
    orgId: string;
    siteId: string | null;
    update: TrustProfileUpdate;
  },
): Promise<TrustProfile> {
  const existing = await selectProfile(env, args.orgId, args.siteId);
  const id = existing?.id ?? crypto.randomUUID();
  const next: TrustProfile = TrustProfileSchema.parse({
    id,
    org_id: args.orgId,
    site_id: args.siteId,
    ai_models: args.update.ai_models ?? existing?.ai_models ?? [],
    data_residency:
      args.update.data_residency ?? existing?.data_residency ?? 'global',
    audit_log_policy:
      args.update.audit_log_policy ??
      existing?.audit_log_policy ??
      'on-request',
    content_provenance:
      args.update.content_provenance ?? existing?.content_provenance ?? [],
    ai_outage_behavior:
      args.update.ai_outage_behavior ??
      existing?.ai_outage_behavior ??
      'graceful-degradation',
    custom_disclosures:
      args.update.custom_disclosures !== undefined
        ? args.update.custom_disclosures
        : (existing?.custom_disclosures ?? null),
    published: existing?.published ?? false,
    published_at: existing?.published_at ?? null,
    updated_at: new Date().toISOString(),
  });

  await env.DB.prepare(
    `INSERT INTO trust_profiles (
       id, org_id, site_id, ai_models_json, data_residency,
       audit_log_policy, content_provenance, ai_outage_behavior,
       custom_disclosures, published, published_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(org_id, COALESCE(site_id, ''))
     WHERE deleted_at IS NULL
     DO UPDATE SET
       ai_models_json    = excluded.ai_models_json,
       data_residency    = excluded.data_residency,
       audit_log_policy  = excluded.audit_log_policy,
       content_provenance= excluded.content_provenance,
       ai_outage_behavior= excluded.ai_outage_behavior,
       custom_disclosures= excluded.custom_disclosures,
       updated_at        = datetime('now')`,
  )
    .bind(
      next.id,
      next.org_id,
      next.site_id,
      JSON.stringify(next.ai_models),
      next.data_residency,
      next.audit_log_policy,
      JSON.stringify(next.content_provenance),
      next.ai_outage_behavior,
      next.custom_disclosures,
      next.published ? 1 : 0,
      next.published_at,
    )
    .run();

  return next;
}

/** Flip published=1, stamp published_at. Idempotent. */
export async function publishOrgProfile(
  env: Env,
  orgId: string,
): Promise<TrustProfile | null> {
  const existing = await getOrgProfile(env, orgId);
  if (!existing) return null;
  const stampedAt = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE trust_profiles
        SET published = 1,
            published_at = COALESCE(published_at, ?),
            updated_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(stampedAt, existing.id)
    .run();
  return {
    ...existing,
    published: true,
    published_at: existing.published_at ?? stampedAt,
    updated_at: stampedAt,
  };
}
