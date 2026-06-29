/**
 * @module services/billing_provider
 * @description Vendor-neutral billing/metering abstraction.
 *
 * ProjectSites owns the canonical usage ledger. Stripe and Metronome are
 * external billing/rating/payment systems — the internal D1 `usage_events`
 * table is the source of truth, and provider delivery is best-effort with
 * replay support.
 *
 * ## Architecture
 *
 * ```
 * Usage events (Worker → Queues → R2 raw archive)
 *   → D1 canonical ledger (deduped, immutable)
 *   → Stripe Meter Events (active now, via StripeMetersProvider)
 *   → Metronome adapter (future, via MetronomeProvider)
 *   → Stripe for payment collection (always)
 * ```
 *
 * ## Provider selection
 *
 * Set `BILLING_PROVIDER` env var: `stripe_meters | metronome | noop`.
 * `openmeter` is NOT a valid value — removed, must not be reintroduced.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

// ─── Usage metric taxonomy ──────────────────────────────────────────────

/**
 * Every billable usage dimension in the platform.
 *
 * Pricing philosophy: charge per TOKEN (not per AI call), per GB (not per
 * file), per MINUTE (not per job). Every metric maps to an actual measurable
 * unit — no lumped "credits" that hide cost.
 */
export type UsageMetric =
  // AI — per token, per image, per minute
  | 'ai_input_tokens'
  | 'ai_output_tokens'
  | 'ai_embedding_tokens'
  | 'ai_image_generations'
  | 'ai_voice_minutes'
  // Compute — per minute
  | 'browser_automation_minutes'
  | 'build_compute_minutes'
  // Traffic — per visit, per GB
  | 'site_visits'
  | 'bandwidth_egress_gb'
  // Storage — per GB-month
  | 'storage_gb_hours'
  // Messaging — per send
  | 'email_sends'
  | 'sms_sends'
  // Engagement — per event
  | 'form_submissions'
  | 'social_posts'
  | 'booking_events'
  // Platform — per seat, per install
  | 'crm_seats'
  | 'premium_app_installs';

/** Unit associated with each metric. */
export type UsageUnit = 'token' | 'minute' | 'event' | 'gb' | 'gb_hour' | 'seat';

/** Mapping from metric to its natural unit. */
export const METRIC_UNIT: Record<UsageMetric, UsageUnit> = {
  // AI — per token (NOT per call)
  ai_input_tokens: 'token',
  ai_output_tokens: 'token',
  ai_embedding_tokens: 'token',
  ai_image_generations: 'event',
  ai_voice_minutes: 'minute',
  // Compute
  browser_automation_minutes: 'minute',
  build_compute_minutes: 'minute',
  // Traffic
  site_visits: 'event',
  bandwidth_egress_gb: 'gb',
  // Storage — GB-hours (1 GB stored for 1 hour)
  storage_gb_hours: 'gb_hour',
  // Messaging — per send
  email_sends: 'event',
  sms_sends: 'event',
  // Engagement
  form_submissions: 'event',
  social_posts: 'event',
  booking_events: 'event',
  // Platform
  crm_seats: 'seat',
  premium_app_installs: 'event',
};

// ─── Usage event (canonical shape) ──────────────────────────────────────

/** A single usage event — the canonical record before external delivery. */
export interface UsageEvent {
  /** UUIDv7 — unique per event, also serves as idempotency key. */
  id: string;
  /** Deduplication key — same id = same event. */
  idempotencyKey: string;
  /** Stripe customer ID or internal customer reference. */
  customerId: string;
  /** Owning org (if applicable). */
  orgId?: string;
  /** Owning site (if applicable). */
  siteId?: string;
  /** Owning app/add-on (if applicable). */
  appId?: string;
  /** Which meter this event counts against. */
  metric: UsageMetric;
  /** Quantity in the metric's natural unit. */
  quantity: number;
  /** Natural unit for this metric. */
  unit: UsageUnit;
  /** Service/component that generated the event (e.g. 'ai_gateway', 'browser', 'listmonk'). */
  source: string;
  /** ISO-8601 timestamp of when the usage occurred. */
  occurredAt: string;
  /** Pricing version active at event time (for audit/replay). */
  pricingVersion?: string;
  /** Arbitrary dimensions (model name, browser purpose, campaign ID, etc). */
  metadata?: Record<string, unknown>;
}

/** Delivery status to the external billing provider. */
export type ExternalDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'retrying'
  | 'dead_lettered';

/** A usage event after it's been persisted + delivery attempted. */
export interface PersistedUsageEvent extends UsageEvent {
  /** When the event was first recorded in our ledger. */
  recordedAt: string;
  /** Delivery status to the external billing provider. */
  deliveryStatus: ExternalDeliveryStatus;
  /** When delivery was last attempted. */
  lastDeliveryAttemptAt?: string;
  /** Error message from the last failed delivery attempt. */
  lastDeliveryError?: string;
}

// ─── Customer sync shape ────────────────────────────────────────────────

/** Customer record for billing provider sync. */
export interface BillingCustomer {
  customerId: string;
  email: string;
  name?: string;
  orgId: string;
  metadata?: Record<string, unknown>;
}

// ─── Usage summary ──────────────────────────────────────────────────────

/** Input for querying usage summaries. */
export interface UsageSummaryInput {
  customerId?: string;
  orgId?: string;
  siteId?: string;
  appId?: string;
  metric?: UsageMetric;
  periodStart: string; // ISO-8601
  periodEnd: string;   // ISO-8601
  granularity?: 'hour' | 'day' | 'month';
}

/** A single row in a usage summary. */
export interface UsageSummaryRow {
  metric: UsageMetric;
  quantity: number;
  unit: UsageUnit;
  estimatedCostCents: number;
  periodStart: string;
  periodEnd: string;
}

/** Full usage summary response. */
export interface UsageSummary {
  rows: UsageSummaryRow[];
  totalCostCents: number;
  periodStart: string;
  periodEnd: string;
  /** Source of truth — always "projectsites" */
  source: 'projectsites';
}

// ─── Provider interface ─────────────────────────────────────────────────

/**
 * Vendor-neutral billing/metering provider.
 *
 * Every provider is a load-bearing abstraction per `vendor-risk-tiering`.
 * Consumers import this interface and call through it — never call a
 * provider's SDK directly outside its implementation file.
 */
export interface BillingMeteringProvider {
  /** Record a single usage event. Idempotent (same idempotencyKey → no-op). */
  recordUsage(event: UsageEvent): Promise<void>;

  /** Record multiple usage events in a batch. Idempotent per event. */
  recordUsageBatch(events: UsageEvent[]): Promise<void>;

  /** Sync customer metadata to the billing provider. */
  syncCustomer(customer: BillingCustomer): Promise<void>;

  /** Query a usage summary — reads from ProjectSites canonical ledger, NOT the external provider. */
  getUsageSummary(input: UsageSummaryInput): Promise<UsageSummary>;
}

// ─── Provider configuration ─────────────────────────────────────────────

/** Valid billing provider identifiers. `openmeter` deliberately excluded. */
export type BillingProviderId = 'stripe_meters' | 'metronome' | 'noop';

/** Resolve the configured billing provider from the environment. */
export function resolveBillingProviderId(env: Env): BillingProviderId {
  const raw = env.BILLING_PROVIDER ?? 'stripe_meters';
  if (raw === 'stripe_meters' || raw === 'metronome' || raw === 'noop') {
    return raw;
  }
  if (raw === 'openmeter') {
    throw new Error(
      'BILLING_PROVIDER=openmeter is no longer supported. Use stripe_meters or metronome.',
    );
  }
  throw new Error(`Unknown BILLING_PROVIDER: ${raw}. Expected stripe_meters | metronome | noop.`);
}

// ─── Stripe meter name mapping (one place, never scatter) ────────────────

/**
 * Maps internal UsageMetric → Stripe Meter Event name.
 *
 * Stripe meter names use the `ps_` prefix and match the meter slugs created
 * in the Stripe Dashboard. These are the canonical mapping — no other file
 * should hardcode a Stripe meter name.
 *
 * Charging model (per Brian):
 * - AI: per TOKEN (input/output/embedding), per IMAGE, per MINUTE (voice)
 * - Compute: per MINUTE (browser, build)
 * - Traffic: per VISIT, per GB (bandwidth egress)
 * - Storage: per GB-HOUR (1 GB stored for 1 hour → ~730 GB-hours = 1 GB-month)
 * - Messaging: per SEND (email, SMS)
 */
export const STRIPE_METER_MAP: Record<UsageMetric, string> = {
  ai_input_tokens: 'ps_ai_input_tokens',
  ai_output_tokens: 'ps_ai_output_tokens',
  ai_embedding_tokens: 'ps_ai_embedding_tokens',
  ai_image_generations: 'ps_ai_image_generations',
  ai_voice_minutes: 'ps_ai_voice_minutes',
  browser_automation_minutes: 'ps_browser_automation_minutes',
  build_compute_minutes: 'ps_build_compute_minutes',
  site_visits: 'ps_site_visits',
  bandwidth_egress_gb: 'ps_bandwidth_egress_gb',
  storage_gb_hours: 'ps_storage_gb_hours',
  email_sends: 'ps_email_sends',
  sms_sends: 'ps_sms_sends',
  form_submissions: 'ps_form_submissions',
  social_posts: 'ps_social_posts',
  booking_events: 'ps_booking_events',
  crm_seats: 'ps_crm_seats',
  premium_app_installs: 'ps_premium_app_installs',
};

// ─── Provider factory ───────────────────────────────────────────────────

/**
 * Build the configured billing provider.
 *
 * @throws If BILLING_PROVIDER is set to an unknown or removed value (e.g. openmeter).
 */
export async function createBillingProvider(env: Env): Promise<BillingMeteringProvider> {
  const id = resolveBillingProviderId(env);
  switch (id) {
    case 'stripe_meters': {
      const { StripeMetersProvider } = await import('./billing_provider_stripe.js');
      return new StripeMetersProvider(env);
    }
    case 'metronome': {
      const { MetronomeProvider } = await import('./billing_provider_metronome.js');
      return new MetronomeProvider(env);
    }
    case 'noop': {
      const { NoopBillingProvider } = await import('./billing_provider_noop.js');
      return new NoopBillingProvider(env);
    }
  }
}
