/**
 * @module libs/features/credit_wallet_rollover/service
 * @description Business logic for the Credit Wallet Rollover feature module.
 *
 * Maintains a ledger of credit transactions per org.  The wallet accumulates
 * unused credits from the previous month up to a 3× monthly cap.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import type { CreditLedgerRow } from './schemas.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'credit_wallet_rollover';

/** Default monthly credit allowance when no subscription row is found. */
export const DEFAULT_MONTHLY_ALLOWANCE = 100;

/** Maximum rollover multiplier: accumulated balance may not exceed this × monthly. */
export const ROLLOVER_CAP_MULTIPLIER = 3;

// ---------------------------------------------------------------------------
// Plan resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the monthly credit allowance for an org from its subscription.
 *
 * @param db    - D1Database binding.
 * @param orgId - Organization id.
 * @returns Monthly credit allowance (integer).
 */
export async function resolveMonthlyAllowance(db: D1Database, orgId: string): Promise<number> {
  const row = await dbQueryOne<{ monthly_credits: number }>(
    db,
    `SELECT monthly_credits FROM subscriptions
     WHERE org_id = ? AND status = 'active' AND deleted_at IS NULL
     LIMIT 1`,
    [orgId],
  ).catch(() => null);
  return row?.monthly_credits ?? DEFAULT_MONTHLY_ALLOWANCE;
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

/**
 * Read the current credit balance for an org.
 *
 * The balance is the sum of all `amount` values in the ledger (positive for
 * earned/rollover, negative for applied/expired).
 *
 * @param db    - D1Database binding.
 * @param orgId - Organization id.
 * @returns Current balance (integer, ≥0).
 */
export async function getBalance(db: D1Database, orgId: string): Promise<number> {
  const row = await dbQueryOne<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM credit_wallet_ledger
     WHERE org_id = ?`,
    [orgId],
  ).catch(() => null);
  return Math.max(0, row?.total ?? 0);
}

// ---------------------------------------------------------------------------
// Apply credits
// ---------------------------------------------------------------------------

/**
 * Deduct `amount` credits from the org wallet, recording an `applied` ledger entry.
 *
 * Returns the actual amount applied (may be less than requested when the balance
 * is insufficient) and the new balance.
 *
 * @remarks
 *   Uses an optional idempotency key to prevent double-debits on retry.
 *
 * @param env            - Worker env (uses `env.DB`).
 * @param orgId          - Org to debit.
 * @param amount         - Credits to consume (positive integer).
 * @param description    - Human-readable reason for the debit.
 * @param idempotencyKey - Optional key for idempotent retry.
 * @returns `{ applied, balance, ledgerId }`.
 */
export async function applyCredits(
  env: Env,
  orgId: string,
  amount: number,
  description?: string,
  idempotencyKey?: string,
): Promise<{ applied: number; balance: number; ledgerId: string }> {
  // Idempotency check.
  if (idempotencyKey) {
    const existing = await dbQueryOne<{ id: string; amount: number; balance_after: number }>(
      env.DB,
      `SELECT id, amount, balance_after FROM credit_wallet_ledger
       WHERE org_id = ? AND idempotency_key = ? LIMIT 1`,
      [orgId, idempotencyKey],
    ).catch(() => null);
    if (existing) {
      return {
        applied: Math.abs(existing.amount),
        balance: existing.balance_after,
        ledgerId: existing.id,
      };
    }
  }

  const currentBalance = await getBalance(env.DB, orgId);
  const applied = Math.min(amount, currentBalance);
  const balanceAfter = currentBalance - applied;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  if (applied > 0) {
    await env.DB.prepare(
      `INSERT INTO credit_wallet_ledger
         (id, org_id, kind, amount, balance_after, description, idempotency_key, created_at)
       VALUES (?, ?, 'applied', ?, ?, ?, ?, ?)`,
    )
      .bind(id, orgId, -applied, balanceAfter, description ?? null, idempotencyKey ?? null, now)
      .run()
      .catch(() => null);
  }

  return { applied, balance: balanceAfter, ledgerId: id };
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

/**
 * Carry unused credits from the previous month into the new month, capped at
 * `ROLLOVER_CAP_MULTIPLIER × monthlyAllowance`.
 *
 * Intended to be called once per billing cycle (cron or webhook).
 * This is a no-op when the balance already meets the new-month grant.
 *
 * @param env   - Worker env.
 * @param orgId - Org to process.
 * @returns New balance after rollover + grant.
 */
export async function processMonthlyRollover(env: Env, orgId: string): Promise<number> {
  const allowance = await resolveMonthlyAllowance(env.DB, orgId);
  const cap = allowance * ROLLOVER_CAP_MULTIPLIER;
  const currentBalance = await getBalance(env.DB, orgId);

  const newBalance = Math.min(currentBalance + allowance, cap);
  const grant = newBalance - currentBalance;

  if (grant <= 0) return currentBalance;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO credit_wallet_ledger
       (id, org_id, kind, amount, balance_after, description, created_at)
     VALUES (?, ?, 'rollover', ?, ?, 'Monthly rollover grant', ?)`,
  )
    .bind(id, orgId, grant, newBalance, now)
    .run()
    .catch(() => null);

  return newBalance;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Return the credit ledger history for an org, newest first.
 *
 * @param env   - Worker env.
 * @param orgId - Org to query.
 * @returns Array of {@link CreditLedgerRow}, max 200 rows.
 */
export async function getCreditHistory(env: Env, orgId: string): Promise<CreditLedgerRow[]> {
  const { data } = await dbQuery<CreditLedgerRow>(
    env.DB,
    `SELECT id, org_id, kind, amount, balance_after, description, idempotency_key, created_at
     FROM credit_wallet_ledger
     WHERE org_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [orgId],
  ).catch(() => ({ data: [] as CreditLedgerRow[] }));
  return data;
}
