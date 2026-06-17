/**
 * @module libs/features/payments_rail/service
 * @description Business logic for the Payments Rail feature module.
 *
 * @remarks
 * This module provides thin DB helpers that abstract D1 reads/writes for payment
 * events. Provider-specific SDK calls (Stripe / Square) should be placed in
 * dedicated adapter files when the integrations are wired up in a future session.
 *
 * @throws {Error} database errors are allowed to propagate to the handler layer
 * which wraps them in a 500 envelope.
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import type { PaymentEvent, PaymentHistoryQuery } from './schemas.js';

export const FLAG_KEY = 'payments_rail';

// ---------------------------------------------------------------------------
// Payment method helpers
// ---------------------------------------------------------------------------

/**
 * Fetch saved payment methods for an org from D1.
 * Returns an empty array when the org has no saved methods (not an error).
 *
 * @example
 * const methods = await getPaymentMethods(env, 'org-abc');
 */
export async function getPaymentMethods(
  env: Pick<Env, 'DB'>,
  orgId: string,
): Promise<Array<{ id: string; provider: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: number }>> {
  type Row = { id: string; provider: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: number };
  const { data: rows } = await dbQuery<Row>(
    env.DB,
    `SELECT id, provider, brand, last4, exp_month AS expMonth, exp_year AS expYear, is_default AS isDefault
     FROM payments_rail_methods
     WHERE org_id = ? AND deleted_at IS NULL
     ORDER BY is_default DESC, created_at DESC`,
    [orgId],
  ).catch(() => ({ data: [] as Row[] }));
  return rows;
}

// ---------------------------------------------------------------------------
// Payment intent helpers
// ---------------------------------------------------------------------------

/**
 * Record a payment intent in D1 after creation with the provider SDK.
 *
 * @example
 * await recordPaymentIntent(env, {
 *   id: 'evt-uuid',
 *   orgId: 'org-abc',
 *   provider: 'stripe',
 *   intentId: 'pi_abc',
 *   amountCents: 4999,
 *   currency: 'usd',
 *   status: 'requires_payment_method',
 * });
 */
export async function recordPaymentIntent(
  env: Pick<Env, 'DB'>,
  event: {
    id: string;
    orgId: string;
    siteId?: string | null;
    provider: string;
    intentId: string;
    amountCents: number;
    currency: string;
    description?: string | null;
    status: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO payments_rail_events
       (id, org_id, site_id, provider, intent_id, amount_cents, currency, description, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event.id,
      event.orgId,
      event.siteId ?? null,
      event.provider,
      event.intentId,
      event.amountCents,
      event.currency,
      event.description ?? null,
      event.status,
      now,
      now,
    )
    .run();
}

// ---------------------------------------------------------------------------
// Payment history helpers
// ---------------------------------------------------------------------------

/**
 * Return paginated payment events for an org with optional provider/status filters.
 *
 * @example
 * const { events, total } = await getPaymentHistory(env, 'org-abc', { page: 0, pageSize: 20 });
 */
export async function getPaymentHistory(
  env: Pick<Env, 'DB'>,
  orgId: string,
  query: PaymentHistoryQuery,
): Promise<{ events: PaymentEvent[]; total: number }> {
  const { page, pageSize, provider, status } = query;

  const conditions: string[] = ['org_id = ?'];
  const args: unknown[] = [orgId];

  if (provider) {
    conditions.push('provider = ?');
    args.push(provider);
  }
  if (status) {
    conditions.push('status = ?');
    args.push(status);
  }

  const where = conditions.join(' AND ');

  const countRow = await dbQueryOne<{ cnt: number }>(
    env.DB,
    `SELECT COUNT(*) AS cnt FROM payments_rail_events WHERE ${where}`,
    args,
  ).catch(() => null);

  const total = countRow?.cnt ?? 0;

  type EventRow = {
    id: string;
    orgId: string;
    siteId: string | null;
    provider: string;
    intentId: string;
    amountCents: number;
    currency: string;
    status: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  };
  const { data: rows } = await dbQuery<EventRow>(
    env.DB,
    `SELECT id,
            org_id       AS orgId,
            site_id      AS siteId,
            provider,
            intent_id    AS intentId,
            amount_cents AS amountCents,
            currency,
            status,
            description,
            created_at   AS createdAt,
            updated_at   AS updatedAt
     FROM payments_rail_events
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...args, pageSize, page * pageSize],
  ).catch(() => ({ data: [] as EventRow[] }));

  return {
    total,
    events: rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      siteId: r.siteId ?? undefined,
      provider: r.provider as PaymentEvent['provider'],
      intentId: r.intentId,
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status as PaymentEvent['status'],
      description: r.description ?? undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  };
}

/**
 * Look up a single payment event by its D1 row id.
 * Returns null when not found (no throw; handler decides 404 vs 500).
 */
export async function getPaymentEventById(
  env: Pick<Env, 'DB'>,
  id: string,
): Promise<PaymentEvent | null> {
  const row = await dbQueryOne<{
    id: string;
    orgId: string;
    siteId: string | null;
    provider: string;
    intentId: string;
    amountCents: number;
    currency: string;
    status: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  }>(
    env.DB,
    `SELECT id,
            org_id       AS orgId,
            site_id      AS siteId,
            provider,
            intent_id    AS intentId,
            amount_cents AS amountCents,
            currency,
            status,
            description,
            created_at   AS createdAt,
            updated_at   AS updatedAt
     FROM payments_rail_events
     WHERE id = ? LIMIT 1`,
    [id],
  ).catch(() => null);

  if (!row) return null;

  return {
    id: row.id,
    orgId: row.orgId,
    siteId: row.siteId ?? undefined,
    provider: row.provider as PaymentEvent['provider'],
    intentId: row.intentId,
    amountCents: row.amountCents,
    currency: row.currency,
    status: row.status as PaymentEvent['status'],
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
