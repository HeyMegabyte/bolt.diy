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
  if (parts.length === 0)
    throw new RangeError('eventIdempotencyKey requires at least one scope part');
  return `${type}:${parts.join(':')}`;
}

/** Max delivery attempts before an outbox row is dead-lettered. */
export const MAX_OUTBOX_ATTEMPTS = 5;

/** The minimal outbox-row shape the dispatcher reasons over. */
export interface OutboxRowState {
  readonly status: 'pending' | 'dispatched' | 'failed';
  readonly attempts: number;
}

/** What the dispatcher should do with a row this pass. */
export type OutboxAction = 'dispatch' | 'retry' | 'dead-letter' | 'skip';

/**
 * Pure dispatcher decision (the dead-letter gate). No I/O — testable in isolation.
 * - `pending` → `dispatch`
 * - `failed` under the attempt cap → `retry`
 * - `failed` at/over the cap → `dead-letter` (stop retrying; surface in the admin DLQ)
 * - `dispatched` → `skip` (already delivered)
 * @example nextOutboxAction({ status: 'failed', attempts: 5 }) // 'dead-letter'
 */
export function nextOutboxAction(
  row: OutboxRowState,
  maxAttempts = MAX_OUTBOX_ATTEMPTS,
): OutboxAction {
  if (row.status === 'dispatched') return 'skip';
  if (row.status === 'pending') return 'dispatch';
  return row.attempts >= maxAttempts ? 'dead-letter' : 'retry';
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

/** Aggregate outbox health for the operator observability surface. */
export interface OutboxStats {
  /** Rows awaiting first dispatch. */
  pending: number;
  /** Rows successfully delivered. */
  dispatched: number;
  /** Failed rows still under the retry cap (will retry next drain). */
  retrying: number;
  /** Failed rows at/over the retry cap — the dead-letter queue. */
  deadLettered: number;
}

/**
 * Count outbox rows by health bucket for the admin observability endpoint.
 * `retrying` vs `deadLettered` splits `status='failed'` at the {@link MAX_OUTBOX_ATTEMPTS}
 * cap — the same threshold {@link nextOutboxAction} uses to stop retrying.
 *
 * @param env - Worker env (needs `DB`).
 * @param maxAttempts - Dead-letter threshold (defaults to {@link MAX_OUTBOX_ATTEMPTS}).
 * @returns Counts per bucket; zeros on an empty table.
 * @example await outboxStats(env) // { pending: 3, dispatched: 1200, retrying: 1, deadLettered: 2 }
 */
export async function outboxStats(
  env: OutboxDb,
  maxAttempts = MAX_OUTBOX_ATTEMPTS,
): Promise<OutboxStats> {
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'dispatched' THEN 1 ELSE 0 END) AS dispatched,
       SUM(CASE WHEN status = 'failed' AND attempts < ? THEN 1 ELSE 0 END) AS retrying,
       SUM(CASE WHEN status = 'failed' AND attempts >= ? THEN 1 ELSE 0 END) AS dead_lettered
     FROM outbox_events`,
  )
    .bind(maxAttempts, maxAttempts)
    .first<{
      pending: number | null;
      dispatched: number | null;
      retrying: number | null;
      dead_lettered: number | null;
    }>();
  return {
    pending: row?.pending ?? 0,
    dispatched: row?.dispatched ?? 0,
    retrying: row?.retrying ?? 0,
    deadLettered: row?.dead_lettered ?? 0,
  };
}

/** A failed outbox row surfaced to the operator (no payload — just triage fields). */
export interface FailedOutboxRow {
  id: string;
  type: string;
  tenantId: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  /** True when `attempts >= MAX_OUTBOX_ATTEMPTS` — this row will NOT retry. */
  deadLettered: boolean;
}

/**
 * Read the most recent failed outbox rows (newest first) for the admin DLQ view.
 * Triage fields only — never the full payload — so the endpoint stays light.
 *
 * @param env - Worker env (needs `DB`).
 * @param limit - Max rows (1..200, clamped; default 50).
 * @param maxAttempts - Dead-letter threshold for the `deadLettered` flag.
 * @returns Newest-first failed rows; empty array on none.
 */
export async function readFailedOutbox(
  env: OutboxDb,
  limit = 50,
  maxAttempts = MAX_OUTBOX_ATTEMPTS,
): Promise<FailedOutboxRow[]> {
  const capped = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  const res = await env.DB.prepare(
    `SELECT id, type, tenant_id, attempts, last_error, created_at
       FROM outbox_events WHERE status = 'failed' ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(capped)
    .all<{
      id: string;
      type: string;
      tenant_id: string;
      attempts: number;
      last_error: string | null;
      created_at: string;
    }>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    tenantId: r.tenant_id,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    deadLettered: r.attempts >= maxAttempts,
  }));
}

/** Mark an outbox row dispatched (success path). */
export async function markDispatched(
  env: OutboxDb,
  id: string,
  dispatchedAt: string,
): Promise<void> {
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

/**
 * Requeue a FAILED outbox row for re-delivery — the operator action behind the
 * admin DLQ surface. Resets the row to `pending` with a fresh attempt budget
 * (`attempts = 0`, `last_error` cleared) so the next drain re-dispatches it. The
 * `status = 'failed'` guard makes this safe + idempotent: a `pending` or
 * `dispatched` row is untouched (returns `{ requeued: false }`), and a
 * double-click only resets an already-failed row once. Use after fixing the
 * downstream that caused the failure.
 *
 * @param env - Worker env (needs `DB`).
 * @param id - The outbox row id (from {@link readFailedOutbox}).
 * @returns `{ requeued }` — false when no FAILED row with that id exists.
 * @example await requeueFailedOutbox(env, 'evt_123') // { requeued: true }
 */
export async function requeueFailedOutbox(
  env: OutboxDb,
  id: string,
): Promise<{ requeued: boolean }> {
  const res = await env.DB.prepare(
    `UPDATE outbox_events SET status = 'pending', attempts = 0, last_error = NULL
       WHERE id = ? AND status = 'failed'`,
  )
    .bind(id)
    .run();
  return { requeued: (res.meta?.changes ?? 0) > 0 };
}

/**
 * Prune successfully-DISPATCHED outbox rows older than `olderThanDays` — table
 * hygiene so `outbox_events` doesn't grow unbounded (every event ever emitted
 * lands here). ONLY deletes `status = 'dispatched'` rows: `pending` (awaiting
 * delivery) and `failed` (retry queue / DLQ) are NEVER pruned — they must
 * survive for the drain + the admin DLQ surface. Keyed on `created_at` so it
 * rides the existing `idx_outbox_pending (status, created_at)` index. Intended
 * for a daily Cron Trigger. Never throws caller-side beyond the D1 call.
 *
 * @param env - Worker env (needs `DB`).
 * @param olderThanDays - Retention window in days (min 1; default 30).
 * @returns `{ deleted }` — the row count removed.
 * @example await pruneDispatchedOutbox(env, 30) // { deleted: 4120 }
 */
export async function pruneDispatchedOutbox(
  env: OutboxDb,
  olderThanDays = 30,
): Promise<{ deleted: number }> {
  const days = Math.max(1, Math.trunc(olderThanDays) || 30);
  const res = await env.DB.prepare(
    `DELETE FROM outbox_events WHERE status = 'dispatched' AND created_at < datetime('now', ?)`,
  )
    .bind(`-${days} days`)
    .run();
  return { deleted: res.meta?.changes ?? 0 };
}
