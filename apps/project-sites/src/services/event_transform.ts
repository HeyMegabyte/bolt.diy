/**
 * @module services/event_transform
 * @description LOOP-HOOK-019 core — per-endpoint event payload mapping.
 * Pure transformation functions that normalize inbound webhook payloads
 * into canonical platform event shapes. Zero I/O.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Canonical platform event ───────────────────────────────────────────────

export const PlatformEventSchema = z.object({
  /** Event type discriminator (e.g. 'stripe.checkout.completed'). */
  type: z.string().min(1).max(128),
  /** Source provider (e.g. 'stripe', 'github', 'resend'). */
  source: z.string().min(1).max(32),
  /** The tenant/org this event belongs to. */
  tenantId: z.string().min(1),
  /** Unix ms timestamp of the original event. */
  timestampMs: z.number().int().positive(),
  /** Canonical event payload (normalized shape). */
  data: z.record(z.string(), z.unknown()),
  /** Original raw payload preserved for audit/replay. */
  raw: z.unknown().optional(),
});
export type PlatformEvent = z.infer<typeof PlatformEventSchema>;

// ── Transform function type ────────────────────────────────────────────────

/** A transformation function that maps a raw webhook body → PlatformEvent. */
export type EventTransformer = (
  raw: unknown,
  source: string,
  tenantId: string,
  timestampMs: number,
) => PlatformEvent;

// ── Generic builder ────────────────────────────────────────────────────────

/**
 * Wraps any raw payload in the canonical PlatformEvent envelope. The
 * caller provides the event type discriminator.
 */
export function wrapPlatformEvent(
  type: string,
  source: string,
  tenantId: string,
  timestampMs: number,
  data: Record<string, unknown>,
  raw?: unknown,
): PlatformEvent {
  return PlatformEventSchema.parse({ type, source, tenantId, timestampMs, data, raw });
}

// ── Common transformers ────────────────────────────────────────────────────

/**
 * Maps a Stripe webhook event into a canonical PlatformEvent.
 * Extracts the event type (stripe.<type>), customer, and relevant data fields.
 */
export function transformStripeEvent(
  raw: unknown,
  tenantId: string,
  timestampMs: number,
): PlatformEvent {
  const e = raw as Record<string, unknown> | null | undefined;
  const eventType = `stripe.${String(e?.type ?? 'unknown')}`;
  const obj = (e?.data as Record<string, unknown> | null | undefined)
    ?.object as Record<string, unknown> | null | undefined;

  return PlatformEventSchema.parse({
    type: eventType,
    source: 'stripe',
    tenantId,
    timestampMs: (e?.created as number) ? (e.created as number) * 1000 : timestampMs,
    data: {
      eventId: e?.id,
      customerId: obj?.customer ?? (obj as Record<string, unknown> | null)?.customer,
      amount: obj?.amount,
      status: obj?.status,
      subscriptionId: obj?.subscription,
    },
    raw,
  });
}

/**
 * Maps a generic JSON webhook into a canonical PlatformEvent.
 * Uses a caller-provided type prefix.
 */
export function transformGenericWebhook(
  raw: unknown,
  source: string,
  typePrefix: string,
  tenantId: string,
  timestampMs: number,
): PlatformEvent {
  const body = raw as Record<string, unknown> | null | undefined;
  const eventType = body?.type
    ? `${typePrefix}.${String(body.type)}`
    : `${typePrefix}.received`;

  return PlatformEventSchema.parse({
    type: eventType,
    source,
    tenantId,
    timestampMs,
    data: (body ?? {}) as Record<string, unknown>,
    raw,
  });
}

// ── Event type extraction ──────────────────────────────────────────────────

/**
 * Attempts to extract a meaningful event type string from an arbitrary
 * raw webhook payload. Returns `null` when no type can be inferred.
 */
export function extractEventType(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.type === 'string') return obj.type;
  if (typeof obj.event === 'string') return obj.event;
  if (typeof obj.event_type === 'string') return obj.event_type;
  if (typeof obj.event_name === 'string') return obj.event_name;
  return null;
}
