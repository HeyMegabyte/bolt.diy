/**
 * Leads store — the shared dependency for the lead scanner (#9) and the
 * claimyour.site prefill (#1).
 *
 * @remarks
 * The scanner persists a researched {@link ClaimLeadProfile} (+ no-website /
 * score / priority meta) as a `leads` row; the claim flow reads it back to
 * prefill `/create`. The profile is stored as validated JSON (reusing
 * `ClaimLeadProfileSchema`), scoring signals as queryable columns. D1 via the
 * helper layer (mockable). Table: migration `0569_leads.sql`.
 *
 * @example
 * ```ts
 * const { leadId } = await createLead(env.DB, profile, { hasWebsite:false, leadScore:88, priority:true });
 * const lead = await getLead(env.DB, leadId); // → { leadId, profile }
 * ```
 */
import type { D1Database } from '@cloudflare/workers-types';
import { dbQueryOne, dbInsert } from './db.js';
import { ClaimLeadProfileSchema, type ClaimLeadProfile } from './claim_lead_profile.js';

const TABLE = 'leads';

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
