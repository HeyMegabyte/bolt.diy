/**
 * @module services/billing_provider_stripe
 * @description Stripe Meters billing provider — active production provider.
 *
 * Sends aggregated usage events to Stripe Meter Events for billing.
 * ProjectSites D1 `usage_events` remains the canonical ledger.
 *
 * ## Aggregation strategy
 *
 * Do NOT send one Stripe meter event per AI token — that would be thousands
 * of API calls per second. Aggregate:
 * - AI tokens: send one event per AI call with total input+output tokens
 * - Browser: send one event per completed browser job
 * - Email: batch per campaign send or per hour
 *
 * ## Idempotency
 *
 * Every meter event carries an idempotency key (same as the UsageEvent.id).
 * Stripe deduplicates by this key for 24 hours. Safe to retry.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import type {
  BillingCustomer,
  BillingMeteringProvider,
  UsageEvent,
  UsageSummary,
  UsageSummaryInput,
  UsageSummaryRow,
} from './billing_provider.js';
import { METRIC_UNIT, STRIPE_METER_MAP } from './billing_provider.js';
import { dbInsert, dbQuery, dbQueryOne } from './db.js';

// ─── Provider ───────────────────────────────────────────────────────────

export class StripeMetersProvider implements BillingMeteringProvider {
  #env: Env;

  constructor(env: Env) {
    this.#env = env;
  }

  /** @inheritdoc */
  async recordUsage(event: UsageEvent): Promise<void> {
    await this.#persistAndDeliver(event);
  }

  /** @inheritdoc */
  async recordUsageBatch(events: UsageEvent[]): Promise<void> {
    // Persist all first (canonical ledger), then deliver to Stripe.
    for (const event of events) {
      await this.#persistToLedger(event);
    }
    for (const event of events) {
      await this.#deliverToStripe(event);
    }
  }

  /** @inheritdoc */
  async syncCustomer(customer: BillingCustomer): Promise<void> {
    // Stripe customers are managed by the billing.ts checkout flow.
    // This is a no-op for Stripe — customer creation happens at checkout.
    // We only update metadata if the customer already exists.
    if (!this.#env.STRIPE_SECRET_KEY) return;

    try {
      await fetch(
        `https://api.stripe.com/v1/customers/${encodeURIComponent(customer.customerId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'metadata[org_id]': customer.orgId,
            ...(customer.name ? { name: customer.name } : {}),
          }),
        },
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'billing_provider_stripe',
          message: 'customer sync failed',
          customerId: customer.customerId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  /** @inheritdoc */
  async getUsageSummary(input: UsageSummaryInput): Promise<UsageSummary> {
    // Read from ProjectSites canonical ledger — never from Stripe.
    return getUsageSummaryFromLedger(this.#env.DB, input);
  }

  // ─── Private helpers ──────────────────────────────────────────────

  /** Persist to D1 canonical ledger + attempt Stripe delivery. */
  async #persistAndDeliver(event: UsageEvent): Promise<void> {
    await this.#persistToLedger(event);
    await this.#deliverToStripe(event);
  }

  /** Write to D1 `usage_events` — the canonical source of truth. */
  async #persistToLedger(event: UsageEvent): Promise<void> {
    try {
      await dbInsert(this.#env.DB, 'usage_events', {
        id: event.id,
        idempotency_key: event.idempotencyKey,
        customer_id: event.customerId,
        org_id: event.orgId ?? null,
        site_id: event.siteId ?? null,
        app_id: event.appId ?? null,
        metric: event.metric,
        quantity: event.quantity,
        unit: event.unit,
        source: event.source,
        occurred_at: event.occurredAt,
        pricing_version: event.pricingVersion ?? null,
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
        delivery_status: 'pending',
      });
    } catch (err) {
      // If it's a unique constraint violation (duplicate idempotency key),
      // that's fine — the event already exists.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('UNIQUE') && !msg.includes('duplicate')) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'billing_provider_stripe',
            message: 'failed to persist usage event',
            eventId: event.id,
            error: msg,
          }),
        );
      }
    }
  }

  /** Send aggregated usage to Stripe Meter Events. */
  async #deliverToStripe(event: UsageEvent): Promise<void> {
    if (!this.#env.STRIPE_SECRET_KEY) return;

    const meterName = STRIPE_METER_MAP[event.metric];
    if (!meterName) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'billing_provider_stripe',
          message: 'no Stripe meter mapping for metric',
          metric: event.metric,
        }),
      );
      return;
    }

    try {
      const res = await fetch('https://api.stripe.com/v1/billing/meter_events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          event_name: meterName,
          timestamp: String(Math.floor(new Date(event.occurredAt).getTime() / 1000)),
          payload: JSON.stringify({
            value: String(event.quantity),
            stripe_customer_id: event.customerId,
            ...(event.metadata ?? {}),
          }),
        }),
      });

      if (res.ok) {
        await this.#markDelivered(event.id, 'sent');
      } else {
        const body = await res.text();
        await this.#markDelivered(event.id, 'failed', body);
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'billing_provider_stripe',
            message: 'Stripe meter event failed',
            eventId: event.id,
            metric: event.metric,
            status: res.status,
            body,
          }),
        );
      }
    } catch (err) {
      await this.#markDelivered(
        event.id,
        'failed',
        err instanceof Error ? err.message : String(err),
      );
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'billing_provider_stripe',
          message: 'Stripe meter event delivery error',
          eventId: event.id,
          metric: event.metric,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  /** Update delivery status on a persisted event. */
  async #markDelivered(
    eventId: string,
    status: 'sent' | 'failed',
    error?: string,
  ): Promise<void> {
    try {
      await this.#env.DB.prepare(
        `UPDATE usage_events
         SET delivery_status = ?,
             last_delivery_attempt_at = ?,
             last_delivery_error = ?
         WHERE id = ?`,
      )
        .bind(status, new Date().toISOString(), error ?? null, eventId)
        .run();
    } catch {
      // Best-effort — the canonical ledger already has the event.
    }
  }
}

// ─── Ledger queries (vendor-neutral, shared across providers) ────────────

/**
 * Read usage summary from the ProjectSites canonical ledger (D1).
 *
 * This is the customer-facing breakdown — it reads OUR data, never Stripe's
 * invoice lines, so the dashboard is always accurate even if Stripe delivery
 * is delayed or fails.
 */
export async function getUsageSummaryFromLedger(
  db: D1Database,
  input: UsageSummaryInput,
): Promise<UsageSummary> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (input.orgId) {
    conditions.push('org_id = ?');
    params.push(input.orgId);
  }
  if (input.customerId) {
    conditions.push('customer_id = ?');
    params.push(input.customerId);
  }
  if (input.siteId) {
    conditions.push('site_id = ?');
    params.push(input.siteId);
  }
  if (input.appId) {
    conditions.push('app_id = ?');
    params.push(input.appId);
  }
  if (input.metric) {
    conditions.push('metric = ?');
    params.push(input.metric);
  }

  conditions.push('occurred_at >= ?');
  params.push(input.periodStart);
  conditions.push('occurred_at < ?');
  params.push(input.periodEnd);
  conditions.push("delivery_status != 'dead_lettered'");
  // ^ exclude dead-lettered events that were explicitly discarded

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await dbQuery<{
    metric: string;
    quantity: number;
    unit: string;
  }>(
    db,
    `SELECT
       metric,
       COALESCE(SUM(quantity), 0) AS quantity,
       unit
     FROM usage_events
     ${where}
     GROUP BY metric, unit
     ORDER BY metric`,
    params,
  );

  const summaryRows = rows.data.map((r) => ({
    metric: r.metric as UsageSummaryRow['metric'],
    quantity: r.quantity,
    unit: r.unit as UsageSummaryRow['unit'],
    estimatedCostCents: estimateCostCents(
      r.metric as UsageSummaryRow['metric'],
      r.quantity,
    ),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  }));

  const totalCostCents = summaryRows.reduce((sum, r) => sum + r.estimatedCostCents, 0);

  return {
    rows: summaryRows,
    totalCostCents,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    source: 'projectsites',
  };
}

// ─── Cost estimation (for display, not billing) ─────────────────────────

/**
 * Per-unit cost in CENTS for each metric.
 *
 * These are display-only estimates for the customer-facing dashboard.
 * Actual billing uses Stripe Meter Event prices or Metronome rate cards.
 *
 * Pricing philosophy (per Brian): charge per TOKEN, per GB, per MINUTE —
 * never lump. Every unit is independently measurable and auditable.
 *
 * | Category          | Metric                     | Unit     | Rate (cents) | Notes                        |
 * |-------------------|----------------------------|----------|-------------|------------------------------|
 * | AI input          | ai_input_tokens            | token    | 0.000015    | $0.15 / 1M input tokens      |
 * | AI output         | ai_output_tokens           | token    | 0.000060    | $0.60 / 1M output tokens     |
 * | AI embeddings     | ai_embedding_tokens        | token    | 0.000002    | $0.02 / 1M embedding tokens  |
 * | AI images         | ai_image_generations       | event    | 5.0         | $0.05 / image (DALL·E 3)     |
 * | AI voice          | ai_voice_minutes           | minute   | 1.0         | $0.01 / minute (OpenAI TTS)  |
 * | Browser           | browser_automation_minutes | minute   | 3.0         | $0.03 / minute               |
 * | Build             | build_compute_minutes      | minute   | 2.0         | $0.02 / minute               |
 * | Visits            | site_visits                | event    | 0.001       | $0.00001 / visit (free tier) |
 * | Bandwidth egress  | bandwidth_egress_gb        | gb       | 5.0         | $0.05 / GB egress            |
 * | Storage           | storage_gb_hours           | gb_hour  | 0.007       | ~$5.00 / GB-month (~730h)    |
 * | Email             | email_sends                | event    | 0.01        | $0.0001 / email (SES cost)   |
 * | SMS               | sms_sends                  | event    | 1.0         | $0.01 / SMS                  |
 * | Forms             | form_submissions           | event    | 0           | free                         |
 * | Social            | social_posts               | event    | 1.0         | $0.01 / post                 |
 * | Bookings          | booking_events             | event    | 0           | free                         |
 * | CRM seats         | crm_seats                  | seat     | 500.0       | $5.00 / seat / month         |
 * | App installs      | premium_app_installs       | event    | 1000.0      | $10.00 / premium app install |
 */
export const METRIC_RATE_CENTS: Record<string, number> = {
  ai_input_tokens: 0.000015,            // $0.15 / 1M tokens
  ai_output_tokens: 0.00006,            // $0.60 / 1M tokens
  ai_embedding_tokens: 0.000002,        // $0.02 / 1M tokens
  ai_image_generations: 5,              // $0.05 / image
  ai_voice_minutes: 1,                  // $0.01 / minute
  browser_automation_minutes: 3,        // $0.03 / minute
  build_compute_minutes: 2,             // $0.02 / minute
  site_visits: 0.001,                   // $0.00001 / visit
  bandwidth_egress_gb: 5,               // $0.05 / GB
  storage_gb_hours: 0.007,              // ~$5.00 / GB-month
  email_sends: 0.01,                    // $0.0001 / email
  sms_sends: 1,                         // $0.01 / SMS
  form_submissions: 0,                  // free
  social_posts: 1,                      // $0.01 / post
  booking_events: 0,                    // free
  crm_seats: 500,                       // $5.00 / seat / month
  premium_app_installs: 1000,           // $10.00 / install
};

/**
 * Estimate cost in cents for a given metric+quantity.
 *
 * These are display-only estimates. Actual billing is determined by
 * Stripe meter prices / Metronome rate cards.
 *
 * @param metric — UsageMetric string
 * @param quantity — number of units (tokens, GB, minutes, events, seats)
 * @returns estimated cost in cents (integer)
 */
export function estimateCostCents(metric: string, quantity: number): number {
  return Math.round(quantity * (METRIC_RATE_CENTS[metric] ?? 0));
}
