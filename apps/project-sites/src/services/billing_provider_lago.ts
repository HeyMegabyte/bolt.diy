/**
 * @module services/billing_provider_lago
 * @description Lago billing provider — active production provider.
 *
 * Lago is the open-source usage-based billing platform. It handles:
 * - Billable metric definitions
 * - Usage event ingestion
 * - Rating (plans, charges, credits)
 * - Invoice generation
 * - Customer entitlements
 *
 * Stripe remains the payment collection layer. Lago replaces Stripe Meters
 * for usage metering + rating. The D1 `usage_events` table remains the
 * canonical ProjectSites ledger.
 *
 * ## Architecture
 *
 * ```
 * ProjectSites usage events → D1 canonical ledger → Lago (metering + rating)
 *                                                 → Stripe (payment collection)
 * ```
 *
 * ## Idempotency
 *
 * Every event carries a unique `transaction_id`. Lago deduplicates by this
 * ID within a 24h window. Safe to retry.
 *
 * @see https://docs.getlago.com/
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
import { LAGO_BILLABLE_CODE } from './billing_provider.js';
import { dbInsert, dbQuery } from './db.js';

// ─── Provider ───────────────────────────────────────────────────────────

export class LagoProvider implements BillingMeteringProvider {
  #env: Env;
  #apiKey: string;
  #apiUrl: string;

  constructor(env: Env) {
    this.#env = env;
    this.#apiKey = env.LAGO_API_KEY ?? '';
    this.#apiUrl = env.LAGO_API_URL ?? 'https://api.getlago.com/api/v1';
  }

  /** @inheritdoc */
  async recordUsage(event: UsageEvent): Promise<void> {
    await this.#persistAndDeliver(event);
  }

  /** @inheritdoc */
  async recordUsageBatch(events: UsageEvent[]): Promise<void> {
    // Deliver ONLY events that reached the canonical ledger — never bill via Lago
    // an event D1 has no record of (fail-closed on the billing ledger).
    const persisted: UsageEvent[] = [];
    for (const event of events) {
      if (await this.#persistToLedger(event)) persisted.push(event);
    }
    for (const event of persisted) {
      await this.#deliverToLago(event);
    }
  }

  /** @inheritdoc */
  async syncCustomer(customer: BillingCustomer): Promise<void> {
    if (!this.#apiKey) return;
    try {
      await fetch(`${this.#apiUrl}/customers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customer: {
            external_id: customer.customerId,
            name: customer.name ?? customer.email,
            email: customer.email,
            metadata: customer.metadata ?? {},
          },
        }),
      });
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'billing_provider_lago',
          message: 'customer sync failed',
          customerId: customer.customerId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  /** @inheritdoc */
  async getUsageSummary(input: UsageSummaryInput): Promise<UsageSummary> {
    return getUsageSummaryFromLedger(this.#env.DB, input);
  }

  // ─── Private helpers ──────────────────────────────────────────────

  async #persistAndDeliver(event: UsageEvent): Promise<void> {
    // Gate delivery on the canonical-ledger write — a dropped INSERT must not be
    // billed by Lago (else Lago rates usage our own ledger has no record of).
    if (await this.#persistToLedger(event)) {
      await this.#deliverToLago(event);
    }
  }

  /**
   * Write the event to the canonical D1 ledger.
   *
   * @returns `true` when the event IS in the ledger (fresh insert OR a UNIQUE
   *   replay of an already-persisted event — Lago dedups by transaction_id, so
   *   an idempotent retry still delivers safely); `false` when a real D1 error
   *   dropped the write, so the caller must NOT deliver.
   * @remarks `dbInsert` NEVER throws — it returns `{ error }` (it catches D1
   *   errors internally). A bare `await` that ignores that return silently drops
   *   the row; the prior `try/catch` here was dead for exactly that reason.
   */
  async #persistToLedger(event: UsageEvent): Promise<boolean> {
    const { error } = await dbInsert(this.#env.DB, 'usage_events', {
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
    if (!error) return true;
    // A UNIQUE/duplicate hit means the event is ALREADY in the ledger — treat as
    // persisted (idempotent) and let delivery proceed; Lago dedups the replay.
    if (/unique|duplicate/i.test(error)) return true;
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'billing_provider_lago',
        message: 'failed to persist usage event',
        eventId: event.id,
        error,
      }),
    );
    return false;
  }

  async #deliverToLago(event: UsageEvent): Promise<void> {
    if (!this.#apiKey) return;

    const code = LAGO_BILLABLE_CODE[event.metric];
    if (!code) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'billing_provider_lago',
          message: 'no Lago billable code for metric',
          metric: event.metric,
        }),
      );
      return;
    }

    try {
      const res = await fetch(`${this.#apiUrl}/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event: {
            transaction_id: event.idempotencyKey,
            external_customer_id: event.customerId,
            code,
            timestamp: Math.floor(new Date(event.occurredAt).getTime() / 1000),
            properties: {
              quantity: event.quantity,
              unit: event.unit,
              ...(event.orgId ? { org_id: event.orgId } : {}),
              ...(event.siteId ? { site_id: event.siteId } : {}),
              ...(event.metadata ?? {}),
            },
          },
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
            service: 'billing_provider_lago',
            message: 'Lago event failed',
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
    }
  }

  async #markDelivered(eventId: string, status: 'sent' | 'failed', error?: string): Promise<void> {
    try {
      await this.#env.DB.prepare(
        `UPDATE usage_events SET delivery_status = ?, last_delivery_attempt_at = ?, last_delivery_error = ? WHERE id = ?`,
      )
        .bind(status, new Date().toISOString(), error ?? null, eventId)
        .run();
    } catch {
      /* best-effort */
    }
  }
}

// ─── Ledger queries (shared) ────────────────────────────────────────────

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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await dbQuery<{ metric: string; quantity: number; unit: string }>(
    db,
    `SELECT metric, COALESCE(SUM(quantity),0) AS quantity, unit
     FROM usage_events ${where}
     GROUP BY metric, unit ORDER BY metric`,
    params,
  );

  const summaryRows = rows.data.map((r) => ({
    metric: r.metric as UsageSummaryRow['metric'],
    quantity: r.quantity,
    unit: r.unit as UsageSummaryRow['unit'],
    estimatedCostCents: 0, // Lago computes actual cost; display is $0 until Lago rates are set
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  }));

  return {
    rows: summaryRows,
    totalCostCents: summaryRows.reduce((s, r) => s + r.estimatedCostCents, 0),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    source: 'projectsites',
  };
}
