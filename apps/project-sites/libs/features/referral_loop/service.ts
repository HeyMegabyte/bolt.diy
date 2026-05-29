/**
 * @module libs/features/referral_loop/service
 * @description Core service for the Built-In Referral Loop (idea #33).
 *
 * Pure-D1 business logic: mint codes, record invites, claim conversions,
 * grant rewards on both sides, compute k-coefficient. No Hono context
 * dependency so the service is unit-testable with a stub D1.
 *
 * Reward policy:
 *   - referrer: `REFERRER_PRO_DAYS` (30) Pro days once referee converts
 *   - referee:  `REFEREE_PRO_DAYS` (30) Pro days on claim (eligible signups)
 *
 * @packageDocumentation
 */

import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../../../src/services/db.js';
import {
  REFERRAL_CODE_LENGTH,
  REFEREE_PRO_DAYS,
  REFERRER_PRO_DAYS,
  type ReferralRecord,
  type ReferralStats,
  type ReferralStatus,
  type RewardSide,
} from './schemas.js';

/**
 * Mint a fresh code: uppercase alphanumeric, collision-resistant via
 * crypto.getRandomValues. We avoid I/J/O/0/1 to reduce read-back errors
 * when codes are shared verbally.
 */
export function mintReferralCode(length: number = REFERRAL_CODE_LENGTH): string {
  const alphabet = 'ABCDEFGHKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Return (or create) the canonical "my code" for a user.
 * Reuses an existing pending+unattached row if one exists; otherwise
 * inserts a pending row with `referee_email = ''` as a sentinel so the
 * code stays stable per-user.
 */
export async function getOrCreateMyCode(
  db: D1Database,
  userId: string,
  orgId: string,
): Promise<string> {
  const existing = await dbQueryOne<{ code: string }>(
    db,
    `SELECT code FROM referrals
       WHERE referrer_user_id = ? AND referee_email = ''
       LIMIT 1`,
    [userId],
  );
  if (existing) return existing.code;
  const code = mintReferralCode();
  const { error } = await dbInsert(db, 'referrals', {
    id: crypto.randomUUID(),
    referrer_user_id: userId,
    referrer_org_id: orgId,
    referee_email: '',
    code,
    status: 'pending',
    source: 'self',
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to mint code: ${error}`);
  return code;
}

/**
 * Record a new invite email. Returns the unique code embedded in the
 * invite URL the caller should send.
 */
export async function recordInvite(
  db: D1Database,
  args: { referrerUserId: string; referrerOrgId: string; refereeEmail: string; source?: string },
): Promise<ReferralRecord> {
  const id = crypto.randomUUID();
  const code = mintReferralCode();
  const created_at = new Date().toISOString();
  // 90-day window — generous; expires only blocks `claim`.
  const expires_at = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await dbInsert(db, 'referrals', {
    id,
    referrer_user_id: args.referrerUserId,
    referrer_org_id: args.referrerOrgId,
    referee_email: args.refereeEmail.toLowerCase(),
    code,
    status: 'pending',
    source: args.source ?? 'email',
    created_at,
    expires_at,
  });
  if (error) throw new Error(`Failed to record invite: ${error}`);
  return {
    id,
    code,
    referee_email: args.refereeEmail.toLowerCase(),
    status: 'pending',
    source: args.source ?? 'email',
    created_at,
    converted_at: null,
  };
}

/**
 * Claim a referral on behalf of a newly-signed-up user. Idempotent:
 * subsequent calls for the same `(code, userId)` pair are no-ops and
 * return the existing record. Grants the referee-side reward immediately.
 * The referrer-side reward fires later on `markConverted`.
 */
export async function claimReferral(
  db: D1Database,
  args: { code: string; refereeUserId: string },
): Promise<{ ok: true; referral_id: string } | { ok: false; reason: string }> {
  const row = await dbQueryOne<{
    id: string;
    referrer_user_id: string;
    status: ReferralStatus;
    expires_at: string | null;
  }>(
    db,
    `SELECT id, referrer_user_id, status, expires_at FROM referrals WHERE code = ? LIMIT 1`,
    [args.code],
  );
  if (!row) return { ok: false, reason: 'code_not_found' };
  if (row.referrer_user_id === args.refereeUserId)
    return { ok: false, reason: 'self_referral_blocked' };
  if (row.expires_at && row.expires_at < new Date().toISOString())
    return { ok: false, reason: 'expired' };
  if (row.status === 'signed_up' || row.status === 'converted')
    return { ok: true, referral_id: row.id };

  const now = new Date().toISOString();
  await dbUpdate(
    db,
    'referrals',
    { referee_user_id: args.refereeUserId, status: 'signed_up', signed_up_at: now },
    'id = ?',
    [row.id],
  );
  await grantReward(db, {
    userId: args.refereeUserId,
    referralId: row.id,
    side: 'referee',
    proDays: REFEREE_PRO_DAYS,
  });
  return { ok: true, referral_id: row.id };
}

/**
 * Mark a referral as `converted` — typically called when the referee
 * completes activation (paid subscription, published site, etc.). Grants
 * the referrer-side reward exactly once via the `redeemed_at` guard.
 */
export async function markConverted(
  db: D1Database,
  referralId: string,
): Promise<{ ok: true; granted: boolean }> {
  const row = await dbQueryOne<{
    id: string;
    referrer_user_id: string;
    status: ReferralStatus;
  }>(
    db,
    `SELECT id, referrer_user_id, status FROM referrals WHERE id = ? LIMIT 1`,
    [referralId],
  );
  if (!row) return { ok: true, granted: false };
  if (row.status === 'converted') return { ok: true, granted: false };

  const now = new Date().toISOString();
  await dbUpdate(
    db,
    'referrals',
    { status: 'converted', converted_at: now },
    'id = ?',
    [referralId],
  );
  await grantReward(db, {
    userId: row.referrer_user_id,
    referralId: row.id,
    side: 'referrer',
    proDays: REFERRER_PRO_DAYS,
  });
  return { ok: true, granted: true };
}

/**
 * Insert a reward row. Idempotency is per (referral_id, side) — we
 * pre-check for an existing active grant before inserting.
 */
async function grantReward(
  db: D1Database,
  args: { userId: string; referralId: string; side: RewardSide; proDays: number },
): Promise<void> {
  const existing = await dbQueryOne<{ id: string }>(
    db,
    `SELECT id FROM referral_rewards
       WHERE referral_id = ? AND side = ? AND status = 'active' LIMIT 1`,
    [args.referralId, args.side],
  );
  if (existing) return;
  await dbInsert(db, 'referral_rewards', {
    id: crypto.randomUUID(),
    user_id: args.userId,
    referral_id: args.referralId,
    side: args.side,
    type: 'pro_days',
    value_cents: 0,
    pro_days: args.proDays,
    granted_at: new Date().toISOString(),
    status: 'active',
  });
}

/**
 * List a user's outgoing referrals (most recent first).
 */
export async function listMyReferrals(
  db: D1Database,
  userId: string,
  limit = 50,
): Promise<ReferralRecord[]> {
  const result = await dbQuery<{
    id: string;
    code: string;
    referee_email: string;
    status: ReferralStatus;
    source: string | null;
    created_at: string;
    converted_at: string | null;
  }>(
    db,
    `SELECT id, code, referee_email, status, source, created_at, converted_at
       FROM referrals
       WHERE referrer_user_id = ? AND referee_email <> ''
       ORDER BY created_at DESC LIMIT ?`,
    [userId, Math.min(limit, 200)],
  );
  return result.data.map((r) => ({
    id: r.id,
    code: r.code,
    referee_email: r.referee_email,
    status: r.status,
    source: r.source,
    created_at: r.created_at,
    converted_at: r.converted_at,
  }));
}

/**
 * Compute referral stats for a user: invites_sent, signups, conversions,
 * k_coefficient, lifetime rewards earned.
 *
 * k = conversions / max(1, distinct_referrers). Since this is single-user
 * scope, the denominator collapses to 1; the multi-tenant aggregate route
 * lives in admin.
 */
export async function getMyStats(
  db: D1Database,
  userId: string,
): Promise<ReferralStats> {
  const counts = await dbQueryOne<{
    invites_sent: number;
    signups: number;
    conversions: number;
  }>(
    db,
    `SELECT
       COUNT(*) AS invites_sent,
       SUM(CASE WHEN status IN ('signed_up','converted') THEN 1 ELSE 0 END) AS signups,
       SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS conversions
     FROM referrals
     WHERE referrer_user_id = ? AND referee_email <> ''`,
    [userId],
  );
  const rewards = await dbQueryOne<{
    rewards_earned_cents: number;
    rewards_pro_days: number;
  }>(
    db,
    `SELECT
       COALESCE(SUM(value_cents), 0) AS rewards_earned_cents,
       COALESCE(SUM(pro_days), 0)    AS rewards_pro_days
     FROM referral_rewards
     WHERE user_id = ? AND side = 'referrer' AND status IN ('active','redeemed')`,
    [userId],
  );
  const invites_sent = counts?.invites_sent ?? 0;
  const signups = counts?.signups ?? 0;
  const conversions = counts?.conversions ?? 0;
  const k = invites_sent > 0 ? +(conversions / invites_sent).toFixed(3) : 0;
  return {
    invites_sent,
    signups,
    conversions,
    k_coefficient: k,
    rewards_earned_cents: rewards?.rewards_earned_cents ?? 0,
    rewards_pro_days: rewards?.rewards_pro_days ?? 0,
  };
}
