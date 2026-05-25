/**
 * @module services/pro
 * @description Pro-tier entitlement helper.
 *
 * Pro status is the single gate for **Endpoints / Apps / Social / Voice +
 * every Pro-only feature** (A/B testing, MCP tools, predictive prerender,
 * custom domains, audit log, branded email, etc.). It lives on the user
 * row (`users.is_pro`) independent of the wallet subscription so a user can
 * be Pro via:
 *
 *   1. **Active $50/mo Stripe subscription** — Stripe webhook flips the flag
 *   2. **Super-admin comp** — `pro_grant_reason = 'comp'` for testimonial/early-access
 *   3. **Lifetime grant** — `pro_grant_reason = 'lifetime'` (Brian, founders)
 *   4. **Beta tester** — `pro_grant_reason = 'beta'` with `pro_expires_at`
 *
 * The `requirePro` middleware throws 402 PAYMENT_REQUIRED with the upgrade
 * URL so frontend gates can render a friendly upsell instead of a generic
 * forbidden screen.
 *
 * @packageDocumentation
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne } from './db.js';

export interface ProStatus {
  is_pro: boolean;
  reason: 'subscription' | 'comp' | 'lifetime' | 'beta' | null;
  granted_at: string | null;
  expires_at: string | null;
  user_id: string | null;
  /** Surface-stable upgrade URL — Stripe Link one-click checkout for the $50/mo plan. */
  upgrade_url: string;
}

const UPGRADE_URL = '/admin/billing?plan=pro';

/**
 * Resolve Pro status for the current authed user. Returns
 * `{ is_pro: false }` if the user is anonymous OR has no Pro grant OR the
 * grant expired.
 */
export async function getProStatus(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<ProStatus> {
  const userId = c.get('userId');
  if (!userId) {
    return { is_pro: false, reason: null, granted_at: null, expires_at: null, user_id: null, upgrade_url: UPGRADE_URL };
  }
  const row = await dbQueryOne<{
    is_pro: number;
    pro_grant_reason: string | null;
    pro_granted_at: string | null;
    pro_expires_at: string | null;
  }>(
    c.env.DB,
    `SELECT is_pro, pro_grant_reason, pro_granted_at, pro_expires_at
       FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  if (!row) {
    return { is_pro: false, reason: null, granted_at: null, expires_at: null, user_id: userId, upgrade_url: UPGRADE_URL };
  }
  const expired = row.pro_expires_at && Date.parse(row.pro_expires_at) < Date.now();
  const isPro = row.is_pro === 1 && !expired;
  return {
    is_pro: isPro,
    reason: (row.pro_grant_reason as ProStatus['reason']) ?? null,
    granted_at: row.pro_granted_at,
    expires_at: row.pro_expires_at,
    user_id: userId,
    upgrade_url: UPGRADE_URL,
  };
}

/**
 * Middleware — gates routes behind Pro. Returns
 *   `402 PAYMENT_REQUIRED { error: { code, message, upgrade_url } }`
 * so the frontend renders an inline upsell rather than a generic 403.
 */
export const requirePro: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const status = await getProStatus(c);
  if (!status.is_pro) {
    return c.json(
      {
        error: {
          code: 'PRO_REQUIRED',
          message:
            'This feature is included in Project Sites Pro ($50/mo). Upgrade in seconds with Stripe Link.',
          upgrade_url: status.upgrade_url,
        },
      },
      402,
    );
  }
  await next();
};

/**
 * Mark a user Pro. Called from:
 *   - Stripe webhook on `customer.subscription.created/updated`
 *   - Super-admin comp endpoint
 *   - Magic-link signup for the founder list
 *
 * @param db D1 binding
 * @param userId user UUID
 * @param reason grant reason — drives renewal logic
 * @param actorId who granted (super-admin user_id, or 'subscription'/'system_seed')
 * @param expiresAt optional ISO expiry — `null` = no expiry
 */
export async function grantPro(
  db: D1Database,
  userId: string,
  reason: NonNullable<ProStatus['reason']>,
  actorId: string,
  expiresAt: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
          SET is_pro = 1,
              pro_granted_at = COALESCE(pro_granted_at, CURRENT_TIMESTAMP),
              pro_grant_reason = ?,
              pro_granted_by = ?,
              pro_expires_at = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(reason, actorId, expiresAt, userId)
    .run();
}

/**
 * Revoke Pro from a user — used when a subscription is canceled or a comp
 * is revoked. Subscriptions that lapse should set `is_pro = 0` rather than
 * delete the row so historical billing audits work.
 */
export async function revokePro(
  db: D1Database,
  userId: string,
  actorId: string,
  reason: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE users
          SET is_pro = 0,
              pro_granted_by = ?,
              pro_grant_reason = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .bind(actorId, `revoked:${reason}`, userId)
    .run();
}
