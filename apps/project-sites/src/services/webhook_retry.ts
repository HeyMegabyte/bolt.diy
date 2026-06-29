/**
 * @module services/webhook_retry
 * @description Webhook delivery retry queue state machine.
 *
 * Tracks delivery status, schedules exponential-backoff retries, and
 * transitions to a dead-letter state when attempts are exhausted.
 * Pure functions — no I/O, no side-effects.
 *
 * @packageDocumentation
 */

/**
 * Delivery status of a webhook.
 * - `pending` — waiting for delivery or retry
 * - `delivered` — successfully delivered
 * - `failed` — all retry attempts exhausted
 * - `dead` — permanently dead (dead-letter queue)
 */
export type WebhookStatus = 'pending' | 'delivered' | 'failed' | 'dead';

/**
 * A single webhook delivery attempt record.
 */
export interface WebhookAttempt {
  /** The target URL receiving the webhook. */
  url: string;
  /** The JSON-serializable payload body. */
  payload: Record<string, unknown>;
  /** Current delivery status. */
  status: WebhookStatus;
  /** Number of delivery attempts made so far. */
  attempts: number;
  /** Unix-ms timestamp of the last attempt, or null if never attempted. */
  lastAttemptMs: number | null;
  /** Unix-ms timestamp after which the next retry is eligible, or null if not scheduled. */
  nextRetryMs: number | null;
}

/** Maximum number of delivery attempts before the webhook is considered failed. */
export const MAX_ATTEMPTS = 5 as const;

/**
 * Exponential backoff delays per attempt (1-indexed).
 *
 * | Attempt | Delay |
 * |---------|-------|
 * | 1       | 1 min |
 * | 2       | 5 min |
 * | 3       | 15 min |
 * | 4       | 30 min |
 * | 5       | 1 hr  |
 */
const RETRY_DELAYS_MS: readonly number[] = [
  60_000, // 1 min
  300_000, // 5 min
  900_000, // 15 min
  1_800_000, // 30 min
  3_600_000, // 1 hr
] as const;

/**
 * Determine whether a webhook should be retried.
 *
 * A webhook is eligible for retry when ALL of these are true:
 * - status is NOT `dead`
 * - `attempts` is less than `MAX_ATTEMPTS`
 * - `nextRetryMs` is null (never scheduled) OR the current time has passed it
 *
 * @param w - The webhook attempt record
 * @param nowMs - Current timestamp override (defaults to Date.now())
 * @returns true if the webhook should be retried
 *
 * @example
 * ```ts
 * const w: WebhookAttempt = { url: 'https://hook.example.com', payload: {}, status: 'pending', attempts: 2, lastAttemptMs: Date.now() - 360000, nextRetryMs: Date.now() - 60000 };
 * shouldRetry(w); // true — past the retry window
 * ```
 */
export function shouldRetry(w: WebhookAttempt, nowMs?: number): boolean {
  if (w.status === 'dead') return false;
  if (w.attempts >= MAX_ATTEMPTS) return false;
  // Never scheduled / first attempt — always eligible.
  if (w.nextRetryMs === null) return true;
  const now = nowMs ?? Date.now();
  return now >= w.nextRetryMs;
}

/**
 * Schedule the next retry for a webhook after a failed delivery.
 *
 * Increments the attempt counter, records the attempt timestamp, and sets a
 * `nextRetryMs` in the future based on exponential backoff. When the attempt
 * count reaches `MAX_ATTEMPTS`, the status becomes `failed` and `nextRetryMs`
 * is set to `null`.
 *
 * @param w - The webhook attempt record before this retry
 * @param attempt - The 1-indexed attempt number that just failed
 * @param nowMs - Current timestamp override (defaults to Date.now())
 * @returns A new WebhookAttempt with updated scheduling fields
 *
 * @example
 * ```ts
 * const w: WebhookAttempt = { url: 'https://hook.example.com', payload: {}, status: 'pending', attempts: 1, lastAttemptMs: null, nextRetryMs: null };
 * scheduleRetry(w, 2);
 * // → { ...status: 'pending', attempts: 2, nextRetryMs: now + 300_000 }
 * ```
 */
export function scheduleRetry(w: WebhookAttempt, attempt: number, nowMs?: number): WebhookAttempt {
  const now = nowMs ?? Date.now();
  const exhausted = attempt >= MAX_ATTEMPTS;
  const index = Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1);
  const delayMs = RETRY_DELAYS_MS[index];

  return {
    ...w,
    attempts: attempt,
    lastAttemptMs: now,
    nextRetryMs: exhausted ? null : now + delayMs,
    status: exhausted ? 'failed' : 'pending',
  };
}

/**
 * Mark a webhook as permanently dead (dead-letter queue).
 *
 * This is a terminal state — the webhook will never be retried again.
 * Call this when repeated failures indicate a permanent problem (invalid
 * endpoint, auth failure, or manual intervention).
 *
 * @param w - The webhook attempt record
 * @returns A new WebhookAttempt with status set to `dead`
 *
 * @example
 * ```ts
 * const w: WebhookAttempt = { url: 'https://hook.example.com', payload: {}, status: 'failed', attempts: 5, lastAttemptMs: Date.now(), nextRetryMs: null };
 * markDead(w);
 * // → { ...status: 'dead' }
 * ```
 */
export function markDead(w: WebhookAttempt): WebhookAttempt {
  return { ...w, status: 'dead' };
}
