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
export type ExternalDeliveryStatus = 'pending' | 'sent' | 'failed' | 'retrying' | 'dead_lettered';

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
  periodEnd: string; // ISO-8601
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

/** Valid billing provider identifiers. */
export type BillingProviderId = 'noop';

/** Resolve the configured billing provider from the environment. */
export function resolveBillingProviderId(env: Env): BillingProviderId {
  const raw = env.BILLING_PROVIDER ?? 'noop';
  if (raw === 'noop') return raw;
  throw new Error(
    `BILLING_PROVIDER=${raw} is not supported — billing runs on Stripe; only 'noop' is valid.`,
  );
}

// Billable-code mapping removed — the noop provider has no codes (billing is Stripe).

// ─── Provider factory ───────────────────────────────────────────────────

/**
 * Build the configured billing provider.
 *
 * @throws If BILLING_PROVIDER is set to an unknown or removed value.
 */
export async function createBillingProvider(env: Env): Promise<BillingMeteringProvider> {
  const id = resolveBillingProviderId(env);
  switch (id) {
    case 'noop': {
      const { NoopBillingProvider } = await import('./billing_provider_noop.js');
      return new NoopBillingProvider(env);
    }
  }
}

// ─── Cost estimation (vendor-neutral, display-only) ─────────────────────

/**
 * Per-unit cost in CENTS for each metric. Display-only estimates.
 * Actual billing: Stripe.
 */
export const METRIC_RATE_CENTS: Record<string, number> = {
  ai_input_tokens: 0.000015,
  ai_output_tokens: 0.00006,
  ai_embedding_tokens: 0.000002,
  ai_image_generations: 5,
  ai_voice_minutes: 1,
  browser_automation_minutes: 3,
  build_compute_minutes: 2,
  site_visits: 0.001,
  bandwidth_egress_gb: 5,
  storage_gb_hours: 0.007,
  email_sends: 0.01,
  sms_sends: 1,
  form_submissions: 0,
  social_posts: 1,
  booking_events: 0,
  crm_seats: 500,
  premium_app_installs: 1000,
};

/**
 * Estimate cost in cents for a given metric+quantity.
 * Display-only — actual billing runs through Stripe.
 */
export function estimateCostCents(metric: string, quantity: number): number {
  return Math.round(quantity * (METRIC_RATE_CENTS[metric] ?? 0));
}
