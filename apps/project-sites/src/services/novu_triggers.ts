/**
 * Novu server-side trigger helpers for ProjectSites.dev.
 *
 * @remarks
 * Provides a Zod discriminated-union schema for every notification event the
 * platform emits, plus a `triggerNovu` function that validates the payload,
 * guards against a missing subscriber, delegates to the injected `send`
 * implementation, and maps every failure to a typed reason — all without ever
 * throwing. Callers can degrade gracefully (log + continue) on any non-`ok`
 * result.
 *
 * @example
 * ```ts
 * import { triggerNovu } from './services/novu_triggers.js';
 * import { Novu } from '@novu/api';
 *
 * const novu = new Novu({ secretKey: env.NOVU_SECRET_KEY });
 * const result = await triggerNovu('build-finished', {
 *   subscriberId: userId,
 *   payload: { event: 'build.finished', tenantId, siteId, previewUrl },
 * }, {
 *   send: (workflowId, args) => novu.trigger({ workflowId, ...args }),
 * });
 * if (!result.ok) console.warn('Novu trigger skipped', result.reason);
 * ```
 *
 * @throws Never — all errors are returned as `{ ok: false, reason }`.
 * @see {@link NovuEventSchema} for the full event payload union.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base fields shared by every event
// ---------------------------------------------------------------------------

const BaseEventFields = z.object({
  /** Org identifier for tenant-scoping the notification. */
  tenantId: z.string().min(1),
  /** Optional site identifier when the event is site-scoped. */
  siteId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Per-event schemas
// ---------------------------------------------------------------------------

const BuildStartedSchema = BaseEventFields.extend({
  event: z.literal('build.started'),
});

const BuildFinishedSchema = BaseEventFields.extend({
  event: z.literal('build.finished'),
  /** Live preview URL for the newly-published site. */
  previewUrl: z.string().url(),
});

const BuildFailedSchema = BaseEventFields.extend({
  event: z.literal('build.failed'),
  /** Human-readable error message from the build pipeline. */
  error: z.string().min(1),
});

const PaymentSucceededSchema = BaseEventFields.extend({
  event: z.literal('payment.succeeded'),
  /** Charge amount in the smallest currency unit (e.g., cents for USD). */
  amountCents: z.number().int().nonnegative(),
  /** ISO 4217 lowercase currency code (e.g., "usd"). */
  currency: z.string().min(1),
});

const PaymentFailedSchema = BaseEventFields.extend({
  event: z.literal('payment.failed'),
  /** Charge amount in the smallest currency unit that was attempted. */
  amountCents: z.number().int().nonnegative(),
  /** ISO 4217 lowercase currency code. */
  currency: z.string().min(1),
});

const LeadScanCompletedSchema = BaseEventFields.extend({
  event: z.literal('lead.scan.completed'),
  /** Number of leads discovered in the scan. */
  leadCount: z.number().int().nonnegative(),
});

// --- Domain lifecycle (custom-hostname provisioning) -----------------------

const DomainVerifyingSchema = BaseEventFields.extend({
  event: z.literal('domain.verifying'),
  /** Custom hostname being verified (e.g. "www.acme.com"). */
  hostname: z.string().min(1),
});

const DomainActiveSchema = BaseEventFields.extend({
  event: z.literal('domain.active'),
  /** Custom hostname now serving the site over SSL. */
  hostname: z.string().min(1),
});

const DomainFailedSchema = BaseEventFields.extend({
  event: z.literal('domain.failed'),
  /** Custom hostname whose provisioning failed. */
  hostname: z.string().min(1),
  /** Human-readable reason (DNS, SSL, ownership). */
  error: z.string().min(1),
});

// --- Quota + billing lifecycle ---------------------------------------------

const QuotaNearLimitSchema = BaseEventFields.extend({
  event: z.literal('quota.near_limit'),
  /** Metered resource nearing its cap (e.g. "ai_budget", "browser_minutes"). */
  resource: z.string().min(1),
  /** Percentage of the cap consumed (0-100). */
  usedPercent: z.number().min(0).max(100),
});

const TrialEndingSchema = BaseEventFields.extend({
  event: z.literal('trial.ending'),
  /** Whole days remaining before the trial converts or expires. */
  daysRemaining: z.number().int().nonnegative(),
});

// --- Team membership lifecycle ---------------------------------------------

const MemberInvitedSchema = BaseEventFields.extend({
  event: z.literal('member.invited'),
  /** Email the invitation was sent to. */
  email: z.string().email(),
  /** Role granted on acceptance (owner|admin|editor|viewer|billing_admin). */
  role: z.string().min(1),
});

const MemberJoinedSchema = BaseEventFields.extend({
  event: z.literal('member.joined'),
  /** User id of the member who accepted. */
  userId: z.string().min(1),
  /** Role the member now holds. */
  role: z.string().min(1),
});

// --- AI job lifecycle ------------------------------------------------------

const AiJobCompletedSchema = BaseEventFields.extend({
  event: z.literal('ai.job.completed'),
  /** Identifier of the completed AI job/run. */
  jobId: z.string().min(1),
  /** Correlated trace id for the Langfuse/Trace-Lens deep link. */
  traceId: z.string().optional(),
});

const AiJobFailedSchema = BaseEventFields.extend({
  event: z.literal('ai.job.failed'),
  /** Identifier of the failed AI job/run. */
  jobId: z.string().min(1),
  /** Human-readable failure reason. */
  error: z.string().min(1),
  /** Correlated trace id for debugging. */
  traceId: z.string().optional(),
});

// --- Browser automation escalation -----------------------------------------

const BrowserJobEscalatedSchema = BaseEventFields.extend({
  event: z.literal('browser.job.escalated'),
  /** Browser-gateway run id that escalated. */
  runId: z.string().min(1),
  /** Provider the run escalated from (e.g. "cloudflare"). */
  fromProvider: z.string().min(1),
  /** Provider the run escalated to (e.g. "browserbase"). */
  toProvider: z.string().min(1),
});

// --- Customer-database provisioning lifecycle ------------------------------

const DbProvisionQueuedSchema = BaseEventFields.extend({
  event: z.literal('db.provision.queued'),
  /** Customer-database registry id. */
  dbId: z.string().min(1),
});

const DbProvisionReadySchema = BaseEventFields.extend({
  event: z.literal('db.provision.ready'),
  /** Customer-database registry id now reachable via Hyperdrive. */
  dbId: z.string().min(1),
});

const DbProvisionFailedSchema = BaseEventFields.extend({
  event: z.literal('db.provision.failed'),
  /** Customer-database registry id whose provisioning failed. */
  dbId: z.string().min(1),
  /** Human-readable failure reason (capacity, connectivity, credentials). */
  error: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Exported discriminated union + inferred type
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all valid Novu event payloads.
 * Use `NovuEventSchema.safeParse(payload)` to validate before triggering.
 */
export const NovuEventSchema = z.discriminatedUnion('event', [
  BuildStartedSchema,
  BuildFinishedSchema,
  BuildFailedSchema,
  PaymentSucceededSchema,
  PaymentFailedSchema,
  LeadScanCompletedSchema,
  DomainVerifyingSchema,
  DomainActiveSchema,
  DomainFailedSchema,
  QuotaNearLimitSchema,
  TrialEndingSchema,
  MemberInvitedSchema,
  MemberJoinedSchema,
  AiJobCompletedSchema,
  AiJobFailedSchema,
  BrowserJobEscalatedSchema,
  DbProvisionQueuedSchema,
  DbProvisionReadySchema,
  DbProvisionFailedSchema,
]);

/** TypeScript type inferred from `NovuEventSchema`. */
export type NovuEvent = z.infer<typeof NovuEventSchema>;

// ---------------------------------------------------------------------------
// Trigger result + failure reason types
// ---------------------------------------------------------------------------

/**
 * Why a `triggerNovu` call did not result in a dispatched notification.
 *
 * - `invalid_payload` — Zod validation on the payload failed; `deps.send` was not called.
 * - `no_subscriber`   — `subscriberId` was empty; `deps.send` was not called.
 * - `send_failed`     — `deps.send` threw; the notification was not delivered.
 */
export type NovuTriggerFailReason = 'invalid_payload' | 'no_subscriber' | 'send_failed';

/** Result returned by `triggerNovu` — never throws. */
export type NovuTriggerResult =
  | { ok: true; transactionId?: string }
  | { ok: false; reason: NovuTriggerFailReason };

// ---------------------------------------------------------------------------
// triggerNovu
// ---------------------------------------------------------------------------

/**
 * Validate + dispatch a Novu notification event.
 *
 * @remarks
 * The function is pure with respect to side-effects: all I/O is performed
 * exclusively through `deps.send`. Inject a real `@novu/api` client in
 * production; inject a jest mock in tests.
 *
 * @param workflowId - The Novu workflow identifier to trigger (e.g., `'build-finished'`).
 * @param args       - `subscriberId` (non-empty string) + `payload` (validated against
 *                     {@link NovuEventSchema}).
 * @param deps       - Dependency-injected `send` function; defaults to nothing — callers
 *                     MUST supply it.
 *
 * @returns A {@link NovuTriggerResult}; never throws.
 *
 * @example
 * ```ts
 * const result = await triggerNovu('build-finished', {
 *   subscriberId: userId,
 *   payload: { event: 'build.finished', tenantId, previewUrl },
 * }, { send: (id, args) => novuClient.trigger({ workflowId: id, ...args }) });
 * ```
 *
 * @throws Never.
 */
export async function triggerNovu(
  workflowId: string,
  args: {
    subscriberId: string;
    payload: unknown;
  },
  deps: {
    send: (
      workflowId: string,
      args: { subscriberId: string; payload: unknown },
    ) => Promise<{ transactionId?: string }>;
  },
): Promise<NovuTriggerResult> {
  // Guard: subscriber required before Zod parse to surface the most specific reason.
  if (!args.subscriberId) {
    return { ok: false, reason: 'no_subscriber' };
  }

  // Guard: validate payload against the discriminated union.
  const parsed = NovuEventSchema.safeParse(args.payload);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_payload' };
  }

  // Dispatch via injected send implementation.
  try {
    const response = await deps.send(workflowId, {
      subscriberId: args.subscriberId,
      payload: args.payload,
    });
    return { ok: true, transactionId: response.transactionId };
  } catch {
    return { ok: false, reason: 'send_failed' };
  }
}
