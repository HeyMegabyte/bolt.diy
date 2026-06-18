/**
 * @module libs/features/referral_loop/service
 * @description Business logic for the Referral Loop feature module.
 *
 * Provides get-or-create referral code, click tracking, and stats queries
 * backed by D1 tables `referral_codes` and `referral_attributions`.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import {
  ReferralCodeRowSchema,
  ReferralStatsResponseSchema,
  type ReferralCodeResponse,
  type ReferralStatsResponse,
  type TrackReferralBody,
  type TrackReferralResponse,
} from './schemas.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'referral_loop';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a short alphanumeric referral code (8 characters).
 * Uses crypto.randomUUID() for entropy then trims to a compact token.
 */
function generateCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * Build the canonical referral URL for a given code.
 *
 * @param code - The referral code string.
 * @returns Full URL that embeds the referral code as a query param.
 */
function buildReferralUrl(code: string): string {
  return `https://projectsites.dev/?ref=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

/**
 * Return the active referral code for `orgId`, creating one if none exists.
 *
 * Uses INSERT OR IGNORE + SELECT pattern so concurrent first-requests resolve
 * to the same row after a brief race window.
 *
 * @param env   - Worker env (uses `env.DB`).
 * @param orgId - Org requesting its code.
 * @returns API response shape with code, URL, clicks, conversions.
 */
export async function getOrCreateReferralCode(
  env: Env,
  orgId: string,
): Promise<ReferralCodeResponse> {
  // Try fetching an existing code first.
  const existing = await dbQueryOne<{
    id: string;
    code: string;
    clicks: number;
    conversions: number;
  }>(env.DB, 'SELECT id, code, clicks, conversions FROM referral_codes WHERE org_id = ? LIMIT 1', [
    orgId,
  ]).catch(() => null);

  if (existing) {
    return {
      code: existing.code,
      referral_url: buildReferralUrl(existing.code),
      clicks: existing.clicks,
      conversions: existing.conversions,
    };
  }

  // Create a new code. INSERT OR IGNORE handles the rare concurrent race.
  const id = crypto.randomUUID();
  const code = generateCode();

  await env.DB.prepare('INSERT OR IGNORE INTO referral_codes (id, org_id, code) VALUES (?, ?, ?)')
    .bind(id, orgId, code)
    .run();

  // Re-read to handle the case where INSERT OR IGNORE skipped (concurrent insert).
  const row = await dbQueryOne<{ code: string; clicks: number; conversions: number }>(
    env.DB,
    'SELECT code, clicks, conversions FROM referral_codes WHERE org_id = ? LIMIT 1',
    [orgId],
  );

  if (!row) throw new Error('referral_loop: failed to create referral code');

  return {
    code: row.code,
    referral_url: buildReferralUrl(row.code),
    clicks: row.clicks,
    conversions: row.conversions,
  };
}

/**
 * Record a referral visit.
 *
 * Increments the click counter on the matching referral_codes row and inserts
 * a new attribution with status `click`. Returns the attribution id and status.
 *
 * @param env  - Worker env.
 * @param body - Validated TrackReferralBody (code + optional referred_org_id).
 * @returns Attribution id and initial status.
 */
export async function trackReferral(
  env: Env,
  body: TrackReferralBody,
): Promise<TrackReferralResponse> {
  const codeRow = await dbQueryOne<{ id: string }>(
    env.DB,
    'SELECT id FROM referral_codes WHERE code = ? LIMIT 1',
    [body.code],
  );

  if (!codeRow) {
    throw Object.assign(new Error('referral_loop: unknown referral code'), { status: 404 });
  }

  // Increment click counter (best-effort; D1 outage silently under-counts).
  await env.DB.prepare('UPDATE referral_codes SET clicks = clicks + 1 WHERE id = ?')
    .bind(codeRow.id)
    .run()
    .catch(() => null);

  // Insert attribution row.
  const attributionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO referral_attributions (id, referral_code_id, referred_org_id, status) VALUES (?, ?, ?, ?)',
  )
    .bind(attributionId, codeRow.id, body.referred_org_id ?? null, 'click')
    .run();

  return { attribution_id: attributionId, status: 'click' };
}

/**
 * Retrieve referral stats for an org.
 *
 * @param env   - Worker env.
 * @param orgId - Org to query.
 * @returns Code string, click/conversion counts, and pending attribution count.
 */
export async function getReferralStats(env: Env, orgId: string): Promise<ReferralStatsResponse> {
  const codeRow = await dbQueryOne<{
    id: string;
    code: string;
    clicks: number;
    conversions: number;
  }>(env.DB, 'SELECT id, code, clicks, conversions FROM referral_codes WHERE org_id = ? LIMIT 1', [
    orgId,
  ]);

  if (!codeRow) {
    // No referral code yet → null code with zero counts (honest zero-state).
    return ReferralStatsResponseSchema.parse({
      code: null,
      clicks: 0,
      conversions: 0,
      pending: 0,
    });
  }

  const { data: pendingRows } = await dbQuery<{ count: number }>(
    env.DB,
    "SELECT COUNT(*) as count FROM referral_attributions WHERE referral_code_id = ? AND status = 'click'",
    [codeRow.id],
  ).catch(() => ({ data: [{ count: 0 }] }));

  const pending = pendingRows[0]?.count ?? 0;

  return ReferralStatsResponseSchema.parse({
    code: codeRow.code,
    clicks: codeRow.clicks,
    conversions: codeRow.conversions,
    pending,
  });
}

// Re-export ReferralCodeRowSchema for use in tests.
export { ReferralCodeRowSchema };
