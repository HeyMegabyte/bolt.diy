/**
 * @module services/email_worker
 * @description Typed email job definitions for the SES/Listmonk send queue.
 * Pure data transformations — never throws, never calls I/O.
 *
 * The worker picks up {@link EmailJob} records and delivers them via SES,
 * Listmonk, or the configured email rail. Every job carries typed status,
 * retry budget, and a monotonic retry-delay schedule.
 */

// ── Types ─────────────────────────────────────────────────────────

/** Discriminated union of every kind of email this queue handles. */
export type EmailJobType = 'transactional' | 'campaign' | 'digest' | 'invite';

/** Lifecycle of a single job. Monotonic: queued → sending → sent | failed. */
export type EmailJobStatus = 'queued' | 'sending' | 'sent' | 'failed';

/** A single email-jobs envelope persisted in the send queue. */
export interface EmailJob {
  id: string;
  type: EmailJobType;
  to: string;
  subject: string;
  body: string;
  status: EmailJobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
}

// ── Constants ──────────────────────────────────────────────────────

/** Default retry budget for every new job. */
export const DEFAULT_MAX_ATTEMPTS = 4;

/**
 * Monotonic retry-delay schedule in milliseconds.
 *
 * Indexed by the completed-attempt count (0 = first failure, 1 = second, …).
 * Clamped to the last entry for any attempt beyond the table.
 *
 * | Attempt | Delay  | Human   |
 * |---------|--------|---------|
 * | 0       | 30_000 | 30 sec  |
 * | 1       | 120_000| 2 min   |
 * | 2       | 480_000| 8 min   |
 * | 3       | 600_000| 10 min  |
 */
const RETRY_DELAYS_MS: readonly number[] = [30_000, 120_000, 480_000, 600_000];

// ── Job factory ────────────────────────────────────────────────────

/**
 * Create a new queued email job with an auto-generated id and the default
 * retry budget.
 *
 * Pure — deterministic given the same inputs (id is random; see caution).
 *
 * @param type  – Kind of email this job represents.
 * @param to    – RFC-5322 recipient address.
 * @param subject – Email subject line.
 * @param body  – Rendered plain-text or HTML body.
 * @returns A fully-populated {@link EmailJob} in `queued` status.
 *
 * @example
 * ```ts
 * const job = createEmailJob('transactional', 'a@b.com', 'Hello', '…');
 * // → { id: '…', type: 'transactional', to: 'a@b.com', status: 'queued', … }
 * ```
 */
export function createEmailJob(
  type: EmailJobType,
  to: string,
  subject: string,
  body: string,
): EmailJob {
  return {
    attempts: 0,
    body,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    status: 'queued',
    subject,
    to,
    type,
  };
}

// ── Retry helpers ──────────────────────────────────────────────────

/**
 * Check whether the job still has remaining retry budget.
 *
 * Pure — never throws.
 *
 * @param job – The job to evaluate.
 * @returns `true` when `attempts < maxAttempts` (more retries available).
 *
 * @example
 * ```ts
 * shouldRetry({ attempts: 2, maxAttempts: 4 }); // → true
 * shouldRetry({ attempts: 4, maxAttempts: 4 }); // → false
 * ```
 */
export function shouldRetry(job: Pick<EmailJob, 'attempts' | 'maxAttempts'>): boolean {
  return job.attempts < job.maxAttempts;
}

/**
 * Compute the next retry delay in milliseconds for the given attempt count.
 *
 * Uses a fixed exponential schedule (30s, 2min, 8min, 10min). Attempts
 * beyond the predefined table are clamped to the last entry so the function
 * is always defined and never throws.
 *
 * Pure — always returns a positive integer.
 *
 * @param attempts – Number of completed send attempts (0 = first failure).
 * @returns Delay in milliseconds before the next retry.
 *
 * @example
 * ```ts
 * nextRetryDelay(0); // → 30000
 * nextRetryDelay(2); // → 480000
 * nextRetryDelay(9); // → 600000 (clamped)
 * ```
 */
export function nextRetryDelay(attempts: number): number {
  if (attempts >= RETRY_DELAYS_MS.length) {
    return RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  }
  return RETRY_DELAYS_MS[attempts];
}
