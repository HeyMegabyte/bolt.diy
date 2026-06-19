/**
 * Leads store — the shared dependency for the lead scanner (#9) and the
 * claimyour.site prefill (#1).
 *
 * @remarks
 * The scanner persists a researched {@link ClaimLeadProfile} (+ no-website /
 * score / priority meta) as a `scanned_leads` row; the claim flow reads it back to
 * prefill `/create`. The profile is stored as validated JSON (reusing
 * `ClaimLeadProfileSchema`), scoring signals as queryable columns. D1 via the
 * helper layer (mockable). Table: migration `0569_scanned_leads.sql`.
 *
 * @example
 * ```ts
 * const { leadId } = await createLead(env.DB, profile, { hasWebsite:false, leadScore:88, priority:true });
 * const lead = await getLead(env.DB, leadId); // → { leadId, profile }
 * ```
 */
import type { D1Database } from '@cloudflare/workers-types';
import { dbQueryOne, dbInsert, dbQuery } from './db.js';
import { ClaimLeadProfileSchema, type ClaimLeadProfile } from './claim_lead_profile.js';

const TABLE = 'scanned_leads';

/** Scoring / provenance meta stored alongside the profile (queryable columns). */
export interface LeadMeta {
  placeId?: string;
  hasWebsite?: boolean;
  leadScore?: number;
  priority?: boolean;
  email?: string;
  emailStatus?: string;
  source?: string;
}

/** A retrieved lead. */
export interface Lead {
  leadId: string;
  profile: ClaimLeadProfile;
}

/**
 * Persist a researched lead. Validates the profile before writing (a profile
 * missing `businessName` throws — never store a junk lead).
 *
 * @param db - D1 binding.
 * @param profile - The researched {@link ClaimLeadProfile}.
 * @param meta - Optional scoring / provenance signals.
 * @returns The generated `leadId`.
 */
export async function createLead(
  db: D1Database,
  profile: ClaimLeadProfile,
  meta: LeadMeta = {},
): Promise<{ leadId: string }> {
  const validated = ClaimLeadProfileSchema.parse(profile); // throws on missing businessName
  const leadId = crypto.randomUUID();
  await dbInsert(db, TABLE, {
    id: leadId,
    business_name: validated.businessName,
    profile_json: JSON.stringify(validated),
    place_id: meta.placeId ?? null,
    has_website: meta.hasWebsite ? 1 : 0,
    lead_score: meta.leadScore ?? 0,
    priority: meta.priority ? 1 : 0,
    email: meta.email ?? null,
    email_status: meta.emailStatus ?? null,
    source: meta.source ?? null,
  });
  return { leadId };
}

/**
 * Read a lead by id, parsing + validating its stored profile.
 *
 * @param db - D1 binding.
 * @param leadId - The lead id.
 * @returns The {@link Lead}, or `null` when absent OR the stored profile is
 *   corrupt/invalid (defensive — never throws on bad data).
 */
export async function getLead(db: D1Database, leadId: string): Promise<Lead | null> {
  const row = await dbQueryOne<{ id: string; profile_json: string }>(
    db,
    `SELECT id, profile_json FROM ${TABLE} WHERE id = ?`,
    [leadId],
  );
  if (!row) return null;
  try {
    const profile = ClaimLeadProfileSchema.parse(JSON.parse(row.profile_json));
    return { leadId: row.id, profile };
  } catch {
    return null;
  }
}

/** A lead row for the Super-Admin scanner list (queryable columns, no JSON parse). */
export interface LeadSummary {
  leadId: string;
  businessName: string;
  hasWebsite: boolean;
  leadScore: number;
  priority: boolean;
  email: string | null;
  emailStatus: string | null;
  source: string | null;
  createdAt: string;
}

/** Options for {@link listLeads}. */
export interface ListLeadsOptions {
  /** Page size, clamped to 1..200 (default 50). */
  limit?: number;
  /** Row offset, floored at 0 (default 0). */
  offset?: number;
  /** When true, return only leads with no website (the scanner's prime signal). */
  onlyNoWebsite?: boolean;
}

interface LeadRow {
  id: string;
  business_name: string;
  has_website: number;
  lead_score: number;
  priority: number;
  email: string | null;
  email_status: string | null;
  source: string | null;
  created_at: string;
}

/**
 * List scanned leads for the Super-Admin scanner UI, highest score first. Reads
 * only the queryable columns (no per-row profile JSON parse). `scanned_leads`
 * has no soft-delete column, so every row is live.
 *
 * @param db - D1 binding.
 * @param opts - {@link ListLeadsOptions} (limit clamped 1..200, offset floored 0).
 * @returns Typed {@link LeadSummary}[] (0/1 columns mapped to booleans).
 * @example
 * const leads = await listLeads(env.DB, { onlyNoWebsite: true, limit: 50 });
 */
export async function listLeads(
  db: D1Database,
  opts: ListLeadsOptions = {},
): Promise<LeadSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const websiteFilter = opts.onlyNoWebsite ? 'AND has_website = 0' : '';
  const { data } = await dbQuery<LeadRow>(
    db,
    `SELECT id, business_name, has_website, lead_score, priority, email, email_status, source, created_at
     FROM ${TABLE} WHERE 1 = 1 ${websiteFilter}
     ORDER BY lead_score DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  return data.map((row) => ({
    leadId: row.id,
    businessName: row.business_name,
    hasWebsite: row.has_website === 1,
    leadScore: row.lead_score,
    priority: row.priority === 1,
    email: row.email,
    emailStatus: row.email_status,
    source: row.source,
    createdAt: row.created_at,
  }));
}
