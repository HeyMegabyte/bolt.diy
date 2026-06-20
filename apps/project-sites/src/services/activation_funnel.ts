/**
 * @module services/activation_funnel
 *
 * @description
 * The revenue-funnel definition (§9 golden path) as a tested SSOT: the ordered
 * milestones a tenant passes through from discovery to paid, expressed over the
 * `event_bus` event types. The Tinybird `activation_funnel` pipe queries exactly
 * this event set — keep the pipe's `WHERE event IN (...)` in lockstep with
 * {@link ACTIVATION_STAGES} so the analytics surface and the domain model never
 * drift.
 *
 *   lead.discovered → site.claim.started → site.published → subscription.active
 *   (discovered)      (engaged)            (delivered)       (converted/paid)
 *
 * Pure + total — no I/O, no clock. Used by the admin activation dashboard to
 * place any event on the funnel and to drive per-stage conversion rollups.
 *
 * @see tinybird/pipes/activation_funnel.pipe
 * @see services/event_bus.ts (EVENT_TYPES)
 */

import type { EventType } from './event_bus.js';

/** A funnel stage: its event type + a human label + ordinal (0 = top). */
export interface ActivationStage {
  readonly event: EventType;
  readonly label: string;
  readonly ordinal: number;
}

/**
 * The four revenue milestones, top → bottom. Each maps to one bus event a tenant
 * emits as it advances. Ordinal is the funnel position (0 = widest/top).
 */
export const ACTIVATION_STAGES: readonly ActivationStage[] = [
  { event: 'lead.discovered', label: 'Discovered', ordinal: 0 },
  { event: 'site.claim.started', label: 'Engaged', ordinal: 1 },
  { event: 'site.published', label: 'Delivered', ordinal: 2 },
  { event: 'subscription.active', label: 'Converted', ordinal: 3 },
] as const;

/** The event types that constitute the activation funnel (for `WHERE event IN`). */
export const ACTIVATION_EVENTS: readonly EventType[] = ACTIVATION_STAGES.map((s) => s.event);

const STAGE_BY_EVENT: ReadonlyMap<string, ActivationStage> = new Map(
  ACTIVATION_STAGES.map((s) => [s.event, s]),
);

/**
 * Place an event type on the funnel.
 *
 * @param event - Any bus event type.
 * @returns The {@link ActivationStage} for a funnel event, or `null` when the
 *   event is not a funnel milestone (e.g. `site.created`, `invoice.failed`).
 * @example funnelStage('site.published') // → { event:'site.published', label:'Delivered', ordinal:2 }
 */
export function funnelStage(event: string): ActivationStage | null {
  return STAGE_BY_EVENT.get(event) ?? null;
}

/**
 * Whether an event type is a revenue-funnel milestone.
 *
 * @param event - Any bus event type.
 * @returns `true` when `event` is one of {@link ACTIVATION_EVENTS}.
 * @example isActivationEvent('subscription.active') // → true
 */
export function isActivationEvent(event: string): boolean {
  return STAGE_BY_EVENT.has(event);
}
