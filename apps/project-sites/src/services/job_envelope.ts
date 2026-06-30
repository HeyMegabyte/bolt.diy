/**
 * @module services/job_envelope
 * @description LOOP-JOBS-001 core — typed job envelope + idempotency key +
 * DLQ metadata primitive. Every background job in the platform wraps its
 * payload in this envelope so consumers get retry count, tenant context,
 * and trace correlation for free.
 *
 * Pure functions — no I/O, no queue binding. The actual enqueue/dequeue
 * lives in the Queue consumer / Workflow step / Inngest function.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Job status ─────────────────────────────────────────────────────────────

export const JobStatus = z.enum(['pending', 'running', 'completed', 'failed', 'dead_lettered']);
export type JobStatus = z.infer<typeof JobStatus>;

// ── Job envelope ───────────────────────────────────────────────────────────

/** The canonical envelope every background job carries. */
export const JobEnvelopeSchema = z.object({
  /** Unique job ID — UUIDv7 for time-ordered deduplication. */
  jobId: z.string().uuid(),
  /** The job type discriminator (e.g. `email.send`, `site.publish`). */
  jobType: z.string().min(1).max(128),
  /** Idempotency key — re-enqueuing the same key is a no-op. */
  idempotencyKey: z.string().min(1).max(255),
  /** Current retry attempt (0 = first attempt). */
  attempt: z.number().int().nonnegative().default(0),
  /** Maximum retry attempts before dead-lettering. */
  maxAttempts: z.number().int().positive().default(3),
  /** Unix ms timestamp of when the job was created. */
  createdAtMs: z.number().int().positive(),
  /** Job-specific payload (typed by the consumer). */
  payload: z.unknown().default(null),
  /** Trace correlation ID — links to the originating request. */
  traceId: z.string().default(''),
  /** Tenant context (org ID) for isolation + audit. */
  tenantId: z.string().default(''),
  /** Arbitrary metadata for observability/tagging. */
  metadata: z.record(z.string(), z.string()).default({}),
});
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;

// ── Envelope builder ───────────────────────────────────────────────────────

/** Options for building a job envelope. */
export interface JobEnvelopeOptions {
  /** Maximum retry attempts (default 3). */
  maxAttempts?: number;
  /** Trace correlation ID. */
  traceId?: string;
  /** Tenant context. */
  tenantId?: string;
  /** Metadata key-value pairs. */
  metadata?: Record<string, string>;
}

/**
 * Wraps a payload in the canonical job envelope. Pure — caller provides
 * `jobId` (UUIDv7), `idempotencyKey`, and `createdAtMs` for determinism.
 *
 * @param jobId - UUIDv7 for this job.
 * @param jobType - Job type discriminator (e.g. `email.send`).
 * @param idempotencyKey - Unique idempotency key.
 * @param payload - Job-specific payload.
 * @param createdAtMs - Unix ms timestamp.
 * @param opts - Optional envelope fields.
 * @returns A validated JobEnvelope.
 */
export function wrapJob(
  jobId: string,
  jobType: string,
  idempotencyKey: string,
  payload: unknown,
  createdAtMs: number,
  opts: JobEnvelopeOptions = {},
): JobEnvelope {
  return JobEnvelopeSchema.parse({
    jobId,
    jobType,
    idempotencyKey,
    attempt: 0,
    maxAttempts: opts.maxAttempts ?? 3,
    createdAtMs,
    payload,
    traceId: opts.traceId ?? '',
    tenantId: opts.tenantId ?? '',
    metadata: opts.metadata ?? {},
  });
}

// ── Retry / DLQ helpers ────────────────────────────────────────────────────

/**
 * Produces the next retry envelope — increments attempt, preserves all
 * other fields. When `attempt >= maxAttempts`, returns `null` to signal
 * the job should be dead-lettered.
 *
 * @param envelope - The failed job envelope.
 * @returns The retry envelope with incremented attempt, or null for DLQ.
 */
export function retryJob(envelope: JobEnvelope): JobEnvelope | null {
  const nextAttempt = envelope.attempt + 1;
  if (nextAttempt >= envelope.maxAttempts) return null;

  return JobEnvelopeSchema.parse({
    ...envelope,
    attempt: nextAttempt,
  });
}

/**
 * Converts a failed job envelope into a dead-letter entry with the
 * failure reason recorded.
 *
 * @param envelope - The exhausted job envelope.
 * @param reason - Why the job failed after all retries.
 * @param failedAtMs - Unix ms timestamp of the final failure.
 * @returns The original envelope with DLQ metadata set.
 */
export function deadLetterJob(
  envelope: JobEnvelope,
  reason: string,
  failedAtMs: number,
): JobEnvelope {
  return JobEnvelopeSchema.parse({
    ...envelope,
    attempt: envelope.maxAttempts,
    metadata: {
      ...envelope.metadata,
      dlq_reason: reason.slice(0, 500),
      dlq_at_ms: String(failedAtMs),
      dlq_status: 'dead_lettered',
    },
  });
}

/**
 * Returns the recommended backoff delay in milliseconds for a given
 * attempt number. Uses exponential backoff with capped ceiling.
 *
 * Delay = min(1000 * 2^attempt, 60000) — caps at 60 seconds.
 *
 * @param attempt - Current attempt number (0-indexed).
 * @returns Delay in milliseconds.
 */
export function retryBackoffMs(attempt: number): number {
  if (attempt <= 0) return 1000;
  const exponent = Math.min(attempt, 6); // 2^6 = 64, min(64000, 60000) = 60000
  return Math.min(1000 * Math.pow(2, exponent), 60_000);
}
