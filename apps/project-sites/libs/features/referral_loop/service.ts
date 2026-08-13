/**
 * @module libs/features/referral_loop/service
 * @description Business logic for the Referral Loop feature module.
 *
 * Backed by D1 tables `referral_codes` and `referral_attributions`.
 *
 * @remarks Schema reality (the code was written against an OLD shape and every
 * query silently swallowed `no such column`):
 * - `referral_codes` has `conversions` (a real counter) but NO `clicks` column —
 *   clicks are DERIVED by counting attributions, never stored on the code row.
 * - `referral_attributions` links to a code by the `code` STRING (not
 *   `referral_code_id`) and records the kind in `event_kind` (not `status`);
 *   real columns: id, site_id, code, event_kind, visitor_token, conversion_cents,
 *   request_id, user_agent, created_at.
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

/**
 * Count click attributions for a referral code. `clicks` is NOT a column on
 * `referral_codes` — it is the number of `event_kind='click'` attribution rows.
 *
 * @param env  - Worker env (uses `env.DB`).
 * @param code - The referral code string.
 * @returns Non-negative click count (0 on any error / no rows).
 */
async function countClicks(env: Env, code: string): Promise<number> {
  const { data } = await dbQuery<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM referral_attributions WHERE code = ? AND event_kind = 'click'",
    [code],
  ).catch(() => ({ data: [{ n: 0 }] }));
  return data[0]?.n ?? 0;
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
 * @returns API response shape with code, URL, clicks (derived), conversions.
 */
export async function getOrCreateReferralCode(
  env: Env,
  orgId: string,
): Promise<ReferralCodeResponse> {
  // Try fetching an existing code first. `conversions` is a real column; clicks
  // are derived from attributions (see countClicks).
  const existing = await dbQueryOne<{ code: string; conversions: number }>(
    env.DB,
    'SELECT code, conversions FROM referral_codes WHERE org_id = ? AND deleted_at IS NULL LIMIT 1',
    [orgId],
  ).catch(() => null);

  if (existing) {
    return {
      code: existing.code,
      referral_url: buildReferralUrl(existing.code),
      clicks: await countClicks(env, existing.code),
      conversions: existing.conversions ?? 0,
    };
  }

  // The `referral_codes` table is site-scoped (`site_id` is NOT NULL), so anchor
  // the org's referral code to its first site. Previously the INSERT omitted
  // `site_id` → NOT NULL violation → 500 on the first `GET /api/referral/code`
  // for EVERY org. An org with no site yet can't hold a code — return an empty
  // response (the UI hides the widget) instead of crashing.
  const site = await dbQueryOne<{ id: string }>(
    env.DB,
    'SELECT id FROM sites WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1',
    [orgId],
  ).catch(() => null);

  if (!site) {
    return { code: '', referral_url: '', clicks: 0, conversions: 0 };
  }

  // Create a new code. INSERT OR IGNORE handles the rare concurrent race.
  const id = crypto.randomUUID();
  const code = generateCode();

  await env.DB.prepare(
    'INSERT OR IGNORE INTO referral_codes (id, site_id, org_id, code) VALUES (?, ?, ?, ?)',
  )
    .bind(id, site.id, orgId, code)
    .run();

  // Re-read to handle the case where INSERT OR IGNORE skipped (concurrent insert).
  const row = await dbQueryOne<{ code: string; conversions: number }>(
    env.DB,
    'SELECT code, conversions FROM referral_codes WHERE org_id = ? AND deleted_at IS NULL LIMIT 1',
    [orgId],
  );

  if (!row) throw new Error('referral_loop: failed to create referral code');

  return {
    code: row.code,
    referral_url: buildReferralUrl(row.code),
    clicks: await countClicks(env, row.code),
    conversions: row.conversions ?? 0,
  };
}

/**
 * Record a referral visit as a `click` attribution row.
 *
 * The attribution links to the code by the code STRING and carries the site the
 * code belongs to. There is no click counter on `referral_codes` to increment —
 * the attribution row IS the click.
 *
 * @param env  - Worker env.
 * @param body - Validated TrackReferralBody (code + optional referred_org_id).
 * @returns Attribution id and initial status.
 */
export async function trackReferral(
  env: Env,
  body: TrackReferralBody,
): Promise<TrackReferralResponse> {
  const codeRow = await dbQueryOne<{ code: string; site_id: string | null }>(
    env.DB,
    'SELECT code, site_id FROM referral_codes WHERE code = ? AND deleted_at IS NULL LIMIT 1',
    [body.code],
  );

  if (!codeRow) {
    throw Object.assign(new Error('referral_loop: unknown referral code'), { status: 404 });
  }

  // Insert the click attribution against the real schema
  // (id, site_id, code, event_kind, visitor_token, created_at).
  const attributionId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO referral_attributions (id, site_id, code, event_kind, visitor_token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      attributionId,
      codeRow.site_id,
      codeRow.code,
      'click',
      body.referred_org_id ?? crypto.randomUUID(),
      new Date().toISOString(),
    )
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
  const codeRow = await dbQueryOne<{ code: string; conversions: number }>(
    env.DB,
    'SELECT code, conversions FROM referral_codes WHERE org_id = ? AND deleted_at IS NULL LIMIT 1',
    [orgId],
  );

  if (!codeRow) {
    // No referral code yet → null code with zero counts (honest zero-state).
    return ReferralStatsResponseSchema.parse({
      code: null,
      clicks: 0,
      conversions: 0,
      pending: 0,
    });
  }

  // clicks first (derived), then `pending` = signup attributions not yet
  // converted (event_kind='signup'). Order matches the response fields.
  const clicks = await countClicks(env, codeRow.code);
  const { data: pendingRows } = await dbQuery<{ count: number }>(
    env.DB,
    "SELECT COUNT(*) as count FROM referral_attributions WHERE code = ? AND event_kind = 'signup'",
    [codeRow.code],
  ).catch(() => ({ data: [{ count: 0 }] }));

  return ReferralStatsResponseSchema.parse({
    code: codeRow.code,
    clicks,
    conversions: codeRow.conversions ?? 0,
    pending: pendingRows[0]?.count ?? 0,
  });
}

// Re-export ReferralCodeRowSchema for use in tests.
export { ReferralCodeRowSchema };
