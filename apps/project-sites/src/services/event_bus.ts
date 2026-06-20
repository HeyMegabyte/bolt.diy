/**
 * Normalized event bus + transactional outbox (convergence spec §14–16).
 *
 * @remarks
 * The reliability spine of the revenue golden path. Every meaningful state
 * transition (claim started/completed, subscription active, invoice paid, site
 * generated/published, notification triggered) becomes a CloudEvents-1.0
 * `ProjectSitesEvent` written to the `outbox_events` table in the SAME logical
 * unit as the domain write — then a dispatcher drains it to Queues/Workflows/Novu.
 *
 * Tenant-scoped (every event carries `tenantId`), idempotent (the
 * `idempotency_key` UNIQUE constraint makes a duplicate write a no-op), and
 * DLQ-aware (`markFailed` increments `attempts` + records `last_error`; a row
 * stuck at `status='failed'` past max attempts IS the dead-letter).
 *
 * Pure layer: `buildEvent` takes the `id` + `time` as parameters (this runtime's
 * pure code must not call `crypto.randomUUID()`/`Date.now()` inline so the unit
 * is deterministic + the function stays side-effect-free). The caller — a Worker
 * handler — supplies `crypto.randomUUID()` + `new Date().toISOString()`.
 *
 * @see docs/architecture/cloudflare-first.md §2 (hot path) + the convergence spec §14
 */
import { z } from 'zod';
import type { Env } from '../types/env.js';

/** Producers that may emit a ProjectSitesEvent (CloudEvents `source` discriminator). */
export const EVENT_PRODUCERS = [
  'worker',
  'container',
  'admin',
  'cloudflare-workflows',
  'inngest',
  'hatchet',
  'stripe',
  'hookdeck',
  'novu',
  'dub',
  'llm',
] as const;

/** The canonical golden-path event types (extend as transitions are wired). */
export const EVENT_TYPES = [
  'site.created',
  'site.claim.started',
  'site.claim.completed',
  'site.generated',
  'site.published',
  'site.publish.failed',
  'subscription.active',
  'subscription.past_due',
  'subscription.canceled',
  'invoice.paid',
  'invoice.failed',
  'entitlement.updated',
  'lead.discovered',
  'notification.workflow.triggered',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** CloudEvents 1.0 envelope, ProjectSites profile (convergence spec §14). */
export const ProjectSitesEventSchema = z
  .object({
    specversion: z.literal('1.0'),
    schemaVersion: z.string().min(1),
    id: z.string().min(1),
    type: z.enum(EVENT_TYPES),
    source: z.string().min(1),
    subject: z.string().optional(),
    time: z.string().min(1), // ISO-8601
    datacontenttype: z.literal('application/json'),
    traceId: z.string().min(1),
    requestId: z.string().optional(),
    tenantId: z.string().min(1), // tenant-scoped: REQUIRED on our golden-path events
    accountId: z.string().optional(),
    siteId: z.string().optional(),
    userId: z.string().optional(),
    producer: z.enum(EVENT_PRODUCERS),
    data: z.record(z.unknown()),
  })
  .strict();

export type ProjectSitesEvent = z.infer<typeof ProjectSitesEventSchema>;

export interface BuildEventInput {
  readonly type: EventType;
  readonly producer: (typeof EVENT_PRODUCERS)[number];
  readonly tenantId: string;
  readonly traceId: string;
  readonly data: Record<string, unknown>;
  readonly siteId?: string;
  readonly userId?: string;
  readonly accountId?: string;
  readonly requestId?: string;
  readonly subject?: string;
  readonly schemaVersion?: string;
}

/**
 * Build a validated CloudEvents envelope. Deterministic — `id` + `time` injected.
 * @throws {z.ZodError} when the assembled event is not schema-valid.
 * @example
 * buildEvent(
 *   { type: 'site.claim.completed', producer: 'worker', tenantId: 't1', traceId: tid, data: { siteId } },
 *   crypto.randomUUID(), new Date().toISOString(),
 * )
 */
export function buildEvent(input: BuildEventInput, id: string, time: string): ProjectSitesEvent {
  return ProjectSitesEventSchema.parse({
    specversion: '1.0',
    schemaVersion: input.schemaVersion ?? '1',
    id,
    type: input.type,
    source: `projectsites/${input.producer}`,
    subject: input.subject,
    time,
    datacontenttype: 'application/json',
    traceId: input.traceId,
    requestId: input.requestId,
    tenantId: input.tenantId,
    accountId: input.accountId,
    siteId: input.siteId,
    userId: input.userId,
    producer: input.producer,
    data: input.data,
  });
}

/**
 * Derive a stable, deterministic outbox idempotency key for a transition.
 *
 * @remarks
 * The same logical event MUST yield the same key so a retried handler writes the
 * row at most once (`writeOutbox` is `INSERT OR IGNORE` on it). Compose from the
 * event type + the natural dedupe scope: a Stripe event id, a claim shortlink, a
 * site id — never a timestamp or random value (those defeat the dedupe).
 * @throws {RangeError} when no scope parts are supplied.
 * @example
 * eventIdempotencyKey('invoice.paid', stripeEvent.id)        // 'invoice.paid:evt_123'
 * eventIdempotencyKey('site.claim.completed', shortlink, siteId)
 */
export function eventIdempotencyKey(type: EventType, ...scope: string[]): string {
  const parts = scope.map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) throw new RangeError('eventIdempotencyKey requires at least one scope part');
  return `${type}:${parts.join(':')}`;
}

type OutboxDb = Pick<Env, 'DB'>;

/**
 * Write an event to the outbox idempotently. A duplicate `idempotencyKey` is a
 * no-op (UNIQUE + `INSERT OR IGNORE`), so safe to call on every retry.
 * @returns `{ inserted }` — false when the key already existed.
 */
export async function writeOutbox(
  env: OutboxDb,
  event: ProjectSitesEvent,
  idempotencyKey: string,
): Promise<{ inserted: boolean }> {
  const res = await env.DB.prepare(
    `INSERT OR IGNORE INTO outbox_events
       (id, idempotency_key, type, tenant_id, site_id, trace_id, producer, payload, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
  )
    .bind(
      event.id,
      idempotencyKey,
      event.type,
      event.tenantId,
      event.siteId ?? null,
      event.traceId,
      event.producer,
      JSON.stringify(event),
      event.time,
    )
    .run();
  return { inserted: (res.meta?.changes ?? 0) > 0 };
}

/** Read up to `limit` pending events (FIFO) for the dispatcher to drain. */
export async function readPendingOutbox(env: OutboxDb, limit = 50): Promise<ProjectSitesEvent[]> {
  const res = await env.DB.prepare(
    `SELECT payload FROM outbox_events WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(limit)
    .all<{ payload: string }>();
  return (res.results ?? []).map((r) => ProjectSitesEventSchema.parse(JSON.parse(r.payload)));
}

/** Mark an outbox row dispatched (success path). */
export async function markDispatched(env: OutboxDb, id: string, dispatchedAt: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE outbox_events SET status = 'dispatched', dispatched_at = ? WHERE id = ?`,
  )
    .bind(dispatchedAt, id)
    .run();
}

/**
 * Mark an outbox row failed — increments `attempts`, records `last_error`.
 * A row at `status='failed'` whose `attempts >= maxAttempts` IS the dead-letter
 * (the dispatcher stops retrying it and the admin DLQ view surfaces it).
 */
export async function markFailed(env: OutboxDb, id: string, error: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE outbox_events SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`,
  )
    .bind(error.slice(0, 500), id)
    .run();
}
