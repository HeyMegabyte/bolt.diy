/**
 * @module services/billing_provider_metronome
 * @description Metronome billing provider — future adapter, inactive.
 *
 * Metronome handles advanced usage-based billing: rate cards, commits,
 * credits, enterprise contracts. It replaces Stripe Meters for rating
 * while Stripe remains the payment collection layer.
 *
 * ## Architecture (when active)
 *
 * ```
 * ProjectSites usage ledger (D1)
 *   → Metronome for rating (rate cards, commits, credits, contracts)
 *   → Stripe for invoice/payment collection
 * ```
 *
 * ## Current state
 *
 * This provider is a SKELETON. It returns successfully for all methods
 * (no-op) unless `METRONOME_API_KEY` is set AND `BILLING_PROVIDER=metronome`,
 * in which case it activates. Until then, StripeMetersProvider is active.
 *
 * ## METRONOME_LATER tasks
 *
 * - Register Metronome account + obtain API credentials
 * - Create rate cards matching ProjectSites pricing tiers
 * - Implement `recordUsage` → Metronome ingest API
 * - Implement `recordUsageBatch` → Metronome batch ingest
 * - Implement `syncCustomer` → Metronome customer API
 * - Map `STRIPE_METER_MAP` to Metronome billable metrics
 * - Wire Metronome webhook receiver for invoice/commit events
 * - Build Metronome → Stripe invoice flow
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import type { Env } from '../types/env.js';
import type {
  BillingCustomer,
  BillingMeteringProvider,
  UsageEvent,
  UsageSummary,
  UsageSummaryInput,
} from './billing_provider.js';
import { getUsageSummaryFromLedger } from './billing_provider_stripe.js';

// ─── Metronome config schema (Zod-validated at provider init) ────────────

export const MetronomeConfigSchema = z.object({
  apiKey: z.string().min(1, 'METRONOME_API_KEY is required when BILLING_PROVIDER=metronome'),
  apiUrl: z.string().url().default('https://api.metronome.com/v1'),
  webhookSecret: z.string().optional(),
});

export type MetronomeConfig = z.infer<typeof MetronomeConfigSchema>;

function resolveMetronomeConfig(env: Env): MetronomeConfig | null {
  if (!env.METRONOME_API_KEY) return null;
  const parsed = MetronomeConfigSchema.safeParse({
    apiKey: env.METRONOME_API_KEY,
    apiUrl: env.METRONOME_API_URL,
    webhookSecret: env.METRONOME_WEBHOOK_SECRET,
  });
  if (!parsed.success) {
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'billing_provider_metronome',
      message: 'Metronome config invalid — provider will remain inactive',
      errors: parsed.error.flatten(),
    }));
    return null;
  }
  return parsed.data;
}

// ─── Provider ───────────────────────────────────────────────────────────

export class MetronomeProvider implements BillingMeteringProvider {
  #config: MetronomeConfig | null;
  #active: boolean;
  #db: D1Database;

  constructor(env: Env) {
    this.#config = resolveMetronomeConfig(env);
    this.#active = this.#config !== null && env.BILLING_PROVIDER === 'metronome';
    this.#db = env.DB;
  }

  /** @inheritdoc */
  async recordUsage(event: UsageEvent): Promise<void> {
    if (!this.#active) return;
    // METRONOME_LATER: POST /v1/ingest with event payload
    // See https://docs.metronome.com/api/ingest-usage
    void event; // unused until wired
  }

  /** @inheritdoc */
  async recordUsageBatch(events: UsageEvent[]): Promise<void> {
    if (!this.#active) return;
    // METRONOME_LATER: POST /v1/ingest/batch with event array
    void events; // unused until wired
  }

  /** @inheritdoc */
  async syncCustomer(customer: BillingCustomer): Promise<void> {
    if (!this.#active) return;
    // METRONOME_LATER: POST /v1/customers with org metadata
    void customer; // unused until wired
  }

  /** @inheritdoc */
  async getUsageSummary(input: UsageSummaryInput): Promise<UsageSummary> {
    // Always reads from ProjectSites canonical ledger — never from Metronome.
    // METRONOME_LATER: augment with Metronome commit/credit balance data.
    return getUsageSummaryFromLedger(this.#db, input);
  }
}
