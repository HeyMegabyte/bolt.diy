/**
 * @module services/billing_provider_noop
 * @description No-op billing provider for local development and tests.
 *
 * Accepts all usage events, syncs, and queries without calling any external
 * API. Returns empty summaries. Used when BILLING_PROVIDER=noop or when
 * no billing provider is configured.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbInsert } from './db.js';
import type {
  BillingCustomer,
  BillingMeteringProvider,
  UsageEvent,
  UsageSummary,
  UsageSummaryInput,
} from './billing_provider.js';

export class NoopBillingProvider implements BillingMeteringProvider {
  #events: UsageEvent[] = [];
  #env: Env;

  constructor(env: Env) {
    this.#env = env;
  }

  /** @inheritdoc */
  async recordUsage(event: UsageEvent): Promise<void> {
    this.#events.push(event);
    await this.#persistToLedger(event);
  }

  /** @inheritdoc */
  async recordUsageBatch(events: UsageEvent[]): Promise<void> {
    this.#events.push(...events);
    for (const event of events) {
      await this.#persistToLedger(event);
    }
  }

  /**
   * Write the event to the canonical D1 ledger (the platform's own
   * `usage_events` table — moved here from the deleted LagoProvider 2026-08-20;
   * the ledger is ProjectSites-owned, never vendor-owned). Fail-closed: a real
   * D1 error logs a warn; a UNIQUE/duplicate hit means the event is ALREADY in
   * the ledger (idempotent replay).
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
    if (/unique|duplicate/i.test(error)) return true;
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'billing_provider_noop',
        message: 'failed to persist usage event',
        eventId: event.id,
        error,
      }),
    );
    return false;
  }

  /** @inheritdoc */
  async syncCustomer(_customer: BillingCustomer): Promise<void> {
    // No-op.
  }

  /** @inheritdoc */
  async getUsageSummary(_input: UsageSummaryInput): Promise<UsageSummary> {
    return {
      rows: [],
      totalCostCents: 0,
      periodStart: _input.periodStart,
      periodEnd: _input.periodEnd,
      source: 'projectsites',
    };
  }

  /** Expose recorded events for test assertions. */
  get recordedEvents(): readonly UsageEvent[] {
    return this.#events;
  }
}
