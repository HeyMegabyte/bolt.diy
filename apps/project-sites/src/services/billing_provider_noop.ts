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
import type {
  BillingCustomer,
  BillingMeteringProvider,
  UsageEvent,
  UsageSummary,
  UsageSummaryInput,
} from './billing_provider.js';

export class NoopBillingProvider implements BillingMeteringProvider {
  #events: UsageEvent[] = [];

  constructor(_env: Env) {
    // No external dependencies.
  }

  /** @inheritdoc */
  async recordUsage(event: UsageEvent): Promise<void> {
    this.#events.push(event);
  }

  /** @inheritdoc */
  async recordUsageBatch(events: UsageEvent[]): Promise<void> {
    this.#events.push(...events);
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
