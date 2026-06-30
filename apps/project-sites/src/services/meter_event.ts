/**
 * @module services/meter_event
 * @description LOOP-BILL-002 core — typed metering event schema + pure
 * producer helper for billing metering events (Stripe Meters, usage tracking).
 * All exports are pure functions that construct valid event payloads — the
 * actual submission (fetch to Stripe / queue) lives outside this module.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Meter event schema (canonical billing event shape) ─────────────────────

/** Well-known meter event names — matches Stripe Meter event_name strings. */
export const MeterEventName = z.enum([
  'api_call',
  'site_build',
  'site_publish',
  'site_visit',
  'bandwidth_egress',
  'ai_token_input',
  'ai_token_output',
  'ai_image_generation',
  'ai_audio_generation',
  'email_sent',
  'email_received',
  'sms_sent',
  'storage_gb',
  'compute_seconds',
  'lead_discovered',
  'lead_enriched',
  'voice_call_minute',
  'browser_render_second',
]);
export type MeterEventName = z.infer<typeof MeterEventName>;

/** One metering event — the shape submitted to Stripe Meters or queued. */
export const MeterEventSchema = z.object({
  /** Stable event name matching a Stripe Meter. */
  event_name: MeterEventName,
  /** Unix timestamp in seconds (whole seconds, not ms). */
  timestamp: z.number().int().positive(),
  /**
   * Unique idempotency key for this event. Re-submission with the same key
   * is a no-op. Defaults to `{event_name}:{timestamp}:{crypto.randomUUID()}`.
   */
  idempotency_key: z.string().min(1).max(255),
  /**
   * The customer ID (Stripe `cus_xxx`). Required for billable events;
   * omitted for aggregate/anonymous metering.
   */
  customer_id: z.string().startsWith('cus_').optional(),
  /**
   * Arbitrary key-value payload attached to the meter event. Flattened to
   * Stripe's `payload` map (string→string only).
   */
  payload: z.record(z.string(), z.string()).default({}),
  /**
   * The meter value. Defaults to 1 for count-based meters; supply an
   * explicit value for usage-quantity meters (bytes, seconds, tokens).
   */
  value: z.number().finite().positive().default(1),
});
export type MeterEvent = z.infer<typeof MeterEventSchema>;

// ── Producer helpers ───────────────────────────────────────────────────────

/** Options for constructing a metering event. */
export interface MeterEventOptions {
  /** Override the idempotency key (auto-generated when omitted). */
  idempotencyKey?: string;
  /** Stripe customer ID. */
  customerId?: string;
  /** Key-value payload. */
  payload?: Record<string, string>;
  /** Meter value (default 1). */
  value?: number;
  /** Unix timestamp in seconds (defaults to caller-supplied value). */
  timestamp?: number;
}

/**
 * Constructs a MeterEvent payload ready for submission. Pure — no side
 * effects, no I/O. The caller must supply a unique idempotency key
 * (typically `{eventName}:{ts}:{crypto.randomUUID()}` from the handler).
 *
 * @param eventName - The meter event name (must match a Stripe Meter).
 * @param idempotencyKey - Unique idempotency key for deduplication.
 * @param nowSeconds - Unix timestamp in seconds (whole seconds, not ms).
 * @param opts - Optional overrides (customerId, payload, value).
 * @returns A validated MeterEvent.
 *
 * @example
 * ```ts
 * const event = meterEvent('site_build', 'site_build:1719705600:abc123', 1719705600, { customerId: 'cus_abc123' });
 * // { event_name: 'site_build', timestamp: 1719705600, idempotency_key: 'site_build:1719705600:abc123', value: 1 }
 * ```
 */
export function meterEvent(
  eventName: MeterEventName | string,
  idempotencyKey: string,
  nowSeconds: number,
  opts: MeterEventOptions = {},
): MeterEvent {
  return MeterEventSchema.parse({
    event_name: eventName,
    timestamp: nowSeconds,
    idempotency_key: idempotencyKey,
    customer_id: opts.customerId,
    payload: opts.payload ?? {},
    value: opts.value ?? 1,
  });
}

/**
 * Constructs a batch of related meter events sharing the same timestamp
 * and customer. Each event name gets its own caller-supplied idempotency key
 * prefix with the event name appended.
 *
 * @param eventNames - Array of meter event names.
 * @param idempotencyPrefix - Prefix for per-event idempotency keys (event name appended).
 * @param nowSeconds - Unix timestamp in seconds.
 * @param opts - Shared options (customer, payload, value).
 * @returns Array of validated MeterEvents.
 */
export function meterEventBatch(
  eventNames: readonly string[],
  idempotencyPrefix: string,
  nowSeconds: number,
  opts: MeterEventOptions = {},
): MeterEvent[] {
  return eventNames.map((name) =>
    meterEvent(name, `${idempotencyPrefix}:${name}`, nowSeconds, opts),
  );
}

// ── Event name validation ──────────────────────────────────────────────────

/**
 * Checks whether a string is a recognized meter event name.
 * Pure — does not rely on the enum registry at runtime.
 */
export function isKnownMeterEvent(name: string): name is MeterEventName {
  return MeterEventName.safeParse(name).success;
}

/**
 * Returns all known meter event names. Useful for documentation, admin
 * surfaces, and validating meter configurations.
 */
export function listMeterEventNames(): readonly MeterEventName[] {
  return MeterEventName.options;
}
