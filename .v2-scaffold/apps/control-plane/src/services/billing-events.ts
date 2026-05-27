/**
 * Writer for the `billing_events` audit table. One write per Stripe event or
 * meter report. Idempotent via UNIQUE (source, idempotency_key).
 */

import type { Env } from '../env.js';

export interface BillingEventInput {
  org_id: string;
  event_type: string;
  source: 'stripe_webhook' | 'meter_report' | 'wallet_action' | 'manual';
  stripe_object_id?: string;
  stripe_event_id?: string;
  stripe_object_type?: string;
  amount_cents?: number;
  currency?: string;
  site_id?: string;
  webhook_event_id?: string;
  metric?: string;
  result?: 'ok' | 'pending' | 'failed' | 'disputed' | 'refunded';
  error_message?: string;
  idempotency_key: string;
  occurred_at: string; // ISO-8601
  payload_hash?: string;
  payload_pointer?: string;
}

export async function recordBillingEvent(
  env: Env,
  input: BillingEventInput,
): Promise<{ duplicate: boolean }> {
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO billing_events (
        id, org_id, event_type, source,
        stripe_object_id, stripe_event_id, stripe_object_type,
        amount_cents, currency, site_id, webhook_event_id,
        metric, result, error_message, idempotency_key,
        payload_hash, payload_pointer, occurred_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
    )
      .bind(
        id,
        input.org_id,
        input.event_type,
        input.source,
        input.stripe_object_id ?? null,
        input.stripe_event_id ?? null,
        input.stripe_object_type ?? null,
        input.amount_cents ?? null,
        input.currency ?? 'usd',
        input.site_id ?? null,
        input.webhook_event_id ?? null,
        input.metric ?? null,
        input.result ?? 'ok',
        input.error_message ?? null,
        input.idempotency_key,
        input.payload_hash ?? null,
        input.payload_pointer ?? null,
        input.occurred_at,
      )
      .run();
    return { duplicate: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(msg)) {
      return { duplicate: true };
    }
    throw err;
  }
}
