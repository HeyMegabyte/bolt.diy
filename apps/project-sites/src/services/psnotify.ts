/**
 * @module services/psnotify
 * @description psnotify — the DO-based unified notification center (replaces Novu).
 * Stub: every function returns the canonical shape so callers can wire
 * `ctx.waitUntil()` without breaking. The real DO implementation ships
 * under `libs/features/psnotify/` per the feature-module architecture.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Canonical event shape (mirrors the old novu_triggers contract) ─────────

export const PsnotifyEventSchema = z.object({
  /** Workflow / template key (e.g. 'welcome', 'build-complete', 'lead-alert'). */
  name: z.string().min(1).max(64),
  /** Recipient identifier — the bell's subscriberId (user email or org id). */
  subscriberId: z.string().min(1),
  /** Arbitrary key-value payload passed to the template renderer. */
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Optional idempotency key — re-firing the same key is a no-op. */
  idempotencyKey: z.string().optional(),
});
export type PsnotifyEvent = z.infer<typeof PsnotifyEventSchema>;

/** Result of a psnotify trigger call. */
export interface PsnotifyResult {
  /** `ps_*` transaction id on success, or short reason on skip/failure. */
  result: string;
  success: boolean;
}

// ── Render ─────────────────────────────────────────────────────────────────

/**
 * Renders a psnotify event payload to the canonical shape. Pure — zero I/O.
 * Currently a pass-through stub; the real renderer will validate + enrich.
 */
export function renderPsnotifyEvent(input: PsnotifyEvent): PsnotifyEvent {
  return PsnotifyEventSchema.parse(input);
}

// ── Stub trigger (replaces the Novu HTTP call) ─────────────────────────────

/**
 * Triggers a psnotify event for one subscriber. Currently a stub that
 * logs + returns ok. The real implementation will fan to the psnotify DO
 * inbox (in-app), email adapter (SES), and push adapter (web-push).
 *
 * Never throws — always returns a `PsnotifyResult`.
 *
 * @remarks Impure — will call the psnotify DO once provisioned.
 */
// ~$0.00/trigger (stub, no external API call). Real cost: SES send ~$0.0001.
export async function triggerPsnotify(
  _env: unknown,
  event: PsnotifyEvent,
): Promise<PsnotifyResult> {
  const parsed = renderPsnotifyEvent(event);
  const id = parsed.idempotencyKey ?? `${parsed.name}:${parsed.subscriberId}:${Date.now()}`;

  // STUB — the real DO call lives here once libs/features/psnotify/ ships
  console.warn(
    JSON.stringify({
      level: 'info',
      msg: `psnotify stub: event "${parsed.name}" for ${parsed.subscriberId}`,
      subscriberId: parsed.subscriberId,
      eventName: parsed.name,
      idempotencyKey: id,
    }),
  );

  return { result: id, success: true };
}
