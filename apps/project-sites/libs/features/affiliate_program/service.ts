/**
 * @module libs/features/affiliate_program/service
 * @description Core service for the Affiliate Program (idea #32).
 *
 * Pure-D1 + Stripe business logic: enroll affiliates, mint tracking codes,
 * track attribution clicks, record conversions on a new paid sub, accrue a
 * 50% recurring commission on referred-org MRR for the first 12 months
 * (the Framer model), list commissions, request a Stripe Connect Express
 * payout. No Hono context dependency so the service is unit-testable with a
 * stub D1 + a Stripe fetch shim.
 *
 * @packageDocumentation
 */

import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../../../src/services/db.js';
import type { Env } from '../../../src/types/env.js';
import {
  AFFILIATE_CODE_LENGTH,
  COMMISSION_MONTHS,
  COMMISSION_PCT,
  type Affiliate,
  type Commission,
  type CommissionStatus,
} from './schemas.js';

/** The D1 flag key + Sentry/log feature-slug tag for this module. */
export const FLAG_KEY = 'affiliate_program';
export const FEATURE_SLUG = 'affiliate_program';

/**
 * Mint a fresh tracking code: uppercase alphanumeric, collision-resistant via
 * crypto.getRandomValues. Avoids I/J/O/0/1 to reduce read-back errors when
 * codes are shared verbally or printed.
 */
export function mintAffiliateCode(length: number = AFFILIATE_CODE_LENGTH): string {
  const alphabet = 'ABCDEFGHKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Structured log helper — every line carries the feature slug for filtering. */
function log(level: 'info' | 'warn', message: string, extra: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ level, service: FEATURE_SLUG, feature_slug: FEATURE_SLUG, message, ...extra }));
}

/**
 * Enroll a new affiliate (or return the existing one for the email). Idempotent
 * per `owner_email`: re-enrolling returns the existing code so links stay stable.
 *
 * @example
 * ```ts
 * const aff = await createAffiliate(db, { email: 'partner@acme.com', ownerUserId });
 * console.warn(aff.code); // 'K7P2QM4RTB'
 * ```
 */
export async function createAffiliate(
  db: D1Database,
  args: { email: string; ownerUserId?: string; stripeConnectId?: string },
): Promise<Affiliate> {
  const email = args.email.toLowerCase();
  const existing = await dbQueryOne<{
    code: string;
    owner_email: string;
    stripe_connect_id: string | null;
    status: string;
  }>(
    db,
    `SELECT code, owner_email, stripe_connect_id, status
       FROM affiliates WHERE owner_email = ? AND deleted_at IS NULL LIMIT 1`,
    [email],
  );
  if (existing) {
    return {
      code: existing.code,
      ownerEmail: existing.owner_email,
      stripeConnectId: existing.stripe_connect_id ?? undefined,
      status: existing.status === 'suspended' ? 'suspended' : 'active',
    };
  }

  const code = mintAffiliateCode();
  const { error } = await dbInsert(db, 'affiliates', {
    id: crypto.randomUUID(),
    code,
    owner_email: email,
    owner_user_id: args.ownerUserId ?? null,
    stripe_connect_id: args.stripeConnectId ?? null,
    status: 'active',
  });
  if (error) throw new Error(`Failed to enroll affiliate: ${error}`);
  log('info', 'affiliate enrolled', { code, owner_email: email });
  return { code, ownerEmail: email, stripeConnectId: args.stripeConnectId, status: 'active' };
}

/** Resolve an affiliate by tracking code. Returns null when unknown/deleted. */
export async function resolveAffiliateByCode(
  db: D1Database,
  code: string,
): Promise<Affiliate | null> {
  const row = await dbQueryOne<{
    code: string;
    owner_email: string;
    stripe_connect_id: string | null;
    status: string;
  }>(
    db,
    `SELECT code, owner_email, stripe_connect_id, status
       FROM affiliates WHERE code = ? AND deleted_at IS NULL LIMIT 1`,
    [code.toUpperCase()],
  );
  if (!row) return null;
  return {
    code: row.code,
    ownerEmail: row.owner_email,
    stripeConnectId: row.stripe_connect_id ?? undefined,
    status: row.status === 'suspended' ? 'suspended' : 'active',
  };
}

/** Find the caller's enrolled affiliate by their account email. */
export async function resolveAffiliateByEmail(
  db: D1Database,
  email: string,
): Promise<Affiliate | null> {
  const row = await dbQueryOne<{ code: string }>(
    db,
    `SELECT code FROM affiliates WHERE owner_email = ? AND deleted_at IS NULL LIMIT 1`,
    [email.toLowerCase()],
  );
  if (!row) return null;
  return resolveAffiliateByCode(db, row.code);
}

/**
 * Track an attribution click on `/r/:code`. Idempotent per (code, anonId):
 * a returning visitor with the same anon-id does not double-count. Unknown
 * codes are a no-op returning `false`.
 *
 * @example
 * ```ts
 * const ok = await trackReferralClick(db, { code: 'K7P2QM4RTB', visitorAnonId });
 * ```
 */
export async function trackReferralClick(
  db: D1Database,
  args: { code: string; visitorAnonId: string },
): Promise<boolean> {
  const code = args.code.toUpperCase();
  const affiliate = await resolveAffiliateByCode(db, code);
  if (!affiliate || affiliate.status !== 'active') return false;

  const existing = await dbQueryOne<{ id: string }>(
    db,
    `SELECT id FROM affiliate_referrals
       WHERE affiliate_code = ? AND visitor_anon_id = ? AND deleted_at IS NULL LIMIT 1`,
    [code, args.visitorAnonId],
  );
  if (existing) return true; // already attributed — stable

  const now = new Date().toISOString();
  const { error } = await dbInsert(db, 'affiliate_referrals', {
    id: crypto.randomUUID(),
    affiliate_code: code,
    visitor_anon_id: args.visitorAnonId,
    signed_up_org_id: null,
    status: 'clicked',
    clicked_at: now,
    converted_at: null,
  });
  if (error) throw new Error(`Failed to track click: ${error}`);
  log('info', 'attribution click', { code });
  return true;
}

/**
 * Record a conversion: a previously-attributed visitor signs up + starts a paid
 * subscription. Binds the referral row to the new org and marks it `converted`.
 * Idempotent — a second call for the same referral is a no-op. Blocks
 * self-referral (affiliate converting their own org).
 *
 * @example
 * ```ts
 * await recordConversion(db, { visitorAnonId, orgId, ownerEmail: 'new@org.com' });
 * ```
 */
export async function recordConversion(
  db: D1Database,
  args: { visitorAnonId: string; orgId: string; ownerEmail?: string },
): Promise<{ ok: true; referral_id: string } | { ok: false; reason: string }> {
  const row = await dbQueryOne<{
    id: string;
    affiliate_code: string;
    status: string;
  }>(
    db,
    `SELECT id, affiliate_code, status FROM affiliate_referrals
       WHERE visitor_anon_id = ? AND deleted_at IS NULL
       ORDER BY clicked_at DESC LIMIT 1`,
    [args.visitorAnonId],
  );
  if (!row) return { ok: false, reason: 'no_attribution' };
  if (row.status === 'converted') return { ok: true, referral_id: row.id };

  // Self-referral guard: an affiliate cannot earn off their own conversion.
  if (args.ownerEmail) {
    const affiliate = await resolveAffiliateByCode(db, row.affiliate_code);
    if (affiliate && affiliate.ownerEmail === args.ownerEmail.toLowerCase()) {
      return { ok: false, reason: 'self_referral_blocked' };
    }
  }

  const now = new Date().toISOString();
  await dbUpdate(
    db,
    'affiliate_referrals',
    { signed_up_org_id: args.orgId, status: 'converted', converted_at: now },
    'id = ?',
    [row.id],
  );
  log('info', 'conversion recorded', { code: row.affiliate_code, org_id: args.orgId });
  return { ok: true, referral_id: row.id };
}

/**
 * Accrue a recurring commission row for one billed month. Pays 50% of the
 * month's MRR for the first {@link COMMISSION_MONTHS} (12) months only — the
 * Framer model. Idempotent per (referral, recurringMonth) via the unique index;
 * beyond month 12 it is a no-op. Returns the accrued amount (0 if skipped).
 *
 * @example
 * ```ts
 * // Month 3 of a $40/mo plan → $20 commission.
 * const { amountUsd } = await accrueRecurringCommission(db, {
 *   referralId, mrrUsd: 40, recurringMonth: 3,
 * });
 * ```
 */
export async function accrueRecurringCommission(
  db: D1Database,
  args: { referralId: string; mrrUsd: number; recurringMonth: number },
): Promise<{ accrued: boolean; amountUsd: number }> {
  if (args.recurringMonth < 1 || args.recurringMonth > COMMISSION_MONTHS) {
    return { accrued: false, amountUsd: 0 }; // outside the 12-month window
  }
  const referral = await dbQueryOne<{ affiliate_code: string; status: string }>(
    db,
    `SELECT affiliate_code, status FROM affiliate_referrals WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [args.referralId],
  );
  if (!referral || referral.status !== 'converted') return { accrued: false, amountUsd: 0 };

  const existing = await dbQueryOne<{ id: string }>(
    db,
    `SELECT id FROM affiliate_commissions
       WHERE referral_id = ? AND recurring_month = ? AND deleted_at IS NULL LIMIT 1`,
    [args.referralId, args.recurringMonth],
  );
  if (existing) return { accrued: false, amountUsd: 0 }; // idempotent

  const amountUsd = +((args.mrrUsd * COMMISSION_PCT) / 100).toFixed(2);
  const { error } = await dbInsert(db, 'affiliate_commissions', {
    id: crypto.randomUUID(),
    affiliate_code: referral.affiliate_code,
    referral_id: args.referralId,
    amount_usd: amountUsd,
    pct: COMMISSION_PCT,
    recurring_month: args.recurringMonth,
    status: 'pending',
    paid_at: null,
  });
  if (error) throw new Error(`Failed to accrue commission: ${error}`);
  log('info', 'commission accrued', {
    code: referral.affiliate_code,
    month: args.recurringMonth,
    amount_usd: amountUsd,
  });
  return { accrued: true, amountUsd };
}

/** A single accrued commission row joined with its recurring month + status. */
export interface CommissionRow extends Commission {
  id: string;
  referral_id: string;
  created_at: string;
}

/** List a code's commissions (most recent first), optionally filtered by status. */
export async function listCommissions(
  db: D1Database,
  code: string,
  status?: CommissionStatus,
  limit = 100,
): Promise<CommissionRow[]> {
  const where = status
    ? `affiliate_code = ? AND status = ? AND deleted_at IS NULL`
    : `affiliate_code = ? AND deleted_at IS NULL`;
  const params = status ? [code.toUpperCase(), status] : [code.toUpperCase()];
  const result = await dbQuery<{
    id: string;
    referral_id: string;
    amount_usd: number;
    pct: number;
    recurring_month: number;
    status: string;
    created_at: string;
  }>(
    db,
    `SELECT id, referral_id, amount_usd, pct, recurring_month, status, created_at
       FROM affiliate_commissions WHERE ${where}
       ORDER BY created_at DESC LIMIT ?`,
    [...params, Math.min(limit, 500)],
  );
  return result.data.map((r) => ({
    id: r.id,
    referral_id: r.referral_id,
    amountUsd: r.amount_usd,
    pct: 50,
    recurringMonth: r.recurring_month,
    status: (r.status as CommissionStatus) ?? 'pending',
    created_at: r.created_at,
  }));
}

/**
 * Request a Stripe Connect Express payout for all pending commission on a code.
 * Requires the affiliate to have a `stripe_connect_id`. Creates a Stripe
 * Transfer for the summed pending amount, then flips those rows to `paid`.
 * Returns a typed envelope; never throws on a configuration gap so the UI can
 * render an actionable empty state.
 *
 * @example
 * ```ts
 * const res = await requestPayout(env, db, 'K7P2QM4RTB');
 * if (!res.ok) renderConnectOnboarding(res.reason);
 * ```
 */
export async function requestPayout(
  env: Env,
  db: D1Database,
  code: string,
): Promise<{ ok: true; amountUsd: number; transfer_id: string } | { ok: false; reason: string }> {
  const upper = code.toUpperCase();
  const affiliate = await resolveAffiliateByCode(db, upper);
  if (!affiliate) return { ok: false, reason: 'affiliate_not_found' };
  if (!affiliate.stripeConnectId) return { ok: false, reason: 'stripe_connect_not_linked' };
  if (!env.STRIPE_SECRET_KEY) return { ok: false, reason: 'stripe_not_configured' };

  const pending = await listCommissions(db, upper, 'pending', 500);
  if (pending.length === 0) return { ok: false, reason: 'nothing_to_pay' };
  const amountUsd = +pending.reduce((sum, c) => sum + c.amountUsd, 0).toFixed(2);
  if (amountUsd <= 0) return { ok: false, reason: 'nothing_to_pay' };

  // Stripe Transfers are integer cents.
  const amountCents = Math.round(amountUsd * 100);
  const res = await fetch('https://api.stripe.com/v1/transfers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Idempotency keyed on code + amount so a retry never double-pays.
      'Idempotency-Key': `aff_payout_${upper}_${amountCents}`,
    },
    body: new URLSearchParams({
      amount: String(amountCents),
      currency: 'usd',
      destination: affiliate.stripeConnectId,
      'metadata[affiliate_code]': upper,
      'metadata[feature_slug]': FEATURE_SLUG,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    log('warn', 'stripe transfer failed', { code: upper, status: res.status, body: text });
    return { ok: false, reason: 'stripe_transfer_failed' };
  }
  const transfer = (await res.json()) as { id: string };

  const now = new Date().toISOString();
  for (const c of pending) {
    await dbUpdate(db, 'affiliate_commissions', { status: 'paid', paid_at: now }, 'id = ?', [c.id]);
  }
  log('info', 'payout settled', { code: upper, amount_usd: amountUsd, transfer_id: transfer.id });
  return { ok: true, amountUsd, transfer_id: transfer.id };
}

/**
 * Build the `GET /api/affiliate/me` dashboard payload: clicks, conversions,
 * pending + paid commission totals, payout readiness.
 */
export async function getDashboard(
  db: D1Database,
  affiliate: Affiliate,
  baseUrl: string,
): Promise<{
  code: string;
  owner_email: string;
  status: 'active' | 'suspended';
  share_url: string;
  stripe_connect_id: string | null;
  clicks: number;
  conversions: number;
  pending_commission_usd: number;
  paid_commission_usd: number;
  payout_ready: boolean;
}> {
  const counts = await dbQueryOne<{ clicks: number; conversions: number }>(
    db,
    `SELECT
       COUNT(*) AS clicks,
       SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS conversions
     FROM affiliate_referrals WHERE affiliate_code = ? AND deleted_at IS NULL`,
    [affiliate.code],
  );
  const totals = await dbQueryOne<{ pending_usd: number; paid_usd: number }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_usd ELSE 0 END), 0) AS pending_usd,
       COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount_usd ELSE 0 END), 0) AS paid_usd
     FROM affiliate_commissions WHERE affiliate_code = ? AND deleted_at IS NULL`,
    [affiliate.code],
  );
  const pending = +(totals?.pending_usd ?? 0).toFixed(2);
  return {
    code: affiliate.code,
    owner_email: affiliate.ownerEmail,
    status: affiliate.status,
    share_url: `${baseUrl}/r/${affiliate.code}`,
    stripe_connect_id: affiliate.stripeConnectId ?? null,
    clicks: counts?.clicks ?? 0,
    conversions: counts?.conversions ?? 0,
    pending_commission_usd: pending,
    paid_commission_usd: +(totals?.paid_usd ?? 0).toFixed(2),
    payout_ready: Boolean(affiliate.stripeConnectId) && pending > 0,
  };
}
