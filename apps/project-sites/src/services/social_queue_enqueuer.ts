/**
 * @module services/social_queue_enqueuer
 * @description Pulse Social — Upstash Redis job queue for social posting.
 *
 * Enqueues posts to per-platform sorted sets (`social:queue:{platform}`,
 * score = scheduled_at epoch) for immediate or near-term publishing.
 * The consumer worker (in `src/index.ts` cron handler) drains the queue
 * and spawns CF Workflow v2 instances.
 *
 * Upstash holds only the "next 5 minutes of posts" per platform.
 * D1 `pulse_posts` is the durable source of truth. If Upstash is
 * unreachable, the consumer falls back to polling D1 for due posts
 * (degraded mode, ~30s latency, never drops a post).
 *
 * Key invariants:
 * - Sharded by platform — a TikTok outage never blocks X posts.
 * - Correlation ID flows through: Idempotency-Key → queue entry → workflow → D1.
 * - Dead-letter: after 3 failures, post moves to `social:dead:{platform}` sorted set.
 *
 * @see ../workflows/social-publish.ts (workflow consumer)
 * @see ./social_post_scheduler.ts (pure calendar math, separate concern)
 */
import type { Platform } from './social_publishers/index.js';

/** Score prefix to avoid timestamp collisions — adds sub-ms entropy. */
let _seq = 0;
function nextSeq(): number {
  _seq = (_seq + 1) % 10000;
  return _seq;
}

interface QueueEntry {
  post_id: string;
  org_id: string;
  platform: Platform;
  account_id: string;
  scheduled_at: number; // epoch ms
  correlation_id: string;
}

/**
 * Enqueue a post for publishing to a single platform account.
 *
 * Pure function — returns the Redis commands that SHOULD be executed.
 * The caller (route handler) runs them against Upstash via
 * `ctx.waitUntil(fetch(UPSTASH_REST_URL, ...))`.
 *
 * @returns Upstash-compatible Redis command array for pipelining.
 *
 * @example
 * ```ts
 * const cmds = buildEnqueueCommands({
 *   post_id: 'abc',
 *   org_id: 'org_1',
 *   platform: 'twitter',
 *   account_id: 'acct_x',
 *   scheduled_at: Date.now(),
 *   correlation_id: crypto.randomUUID(),
 * });
 * // → [['ZADD', 'social:queue:twitter', '1712345678000', '{"post_id":"abc",...}']]
 * ```
 */
export function buildEnqueueCommands(entry: QueueEntry): Array<[string, ...string[]]> {
  const score = entry.scheduled_at + nextSeq();
  const payload = JSON.stringify(entry);
  const queueKey = `social:queue:${entry.platform}`;
  return [['ZADD', queueKey, String(score), payload]];
}

/**
 * Build the Redis command to move a post from the main queue to the
 * dead-letter queue after all retries are exhausted.
 *
 * @example
 * ```ts
 * const cmds = buildDeadLetterCommands('twitter', entry);
 * ```
 */
export function buildDeadLetterCommands(
  platform: Platform,
  entry: QueueEntry,
): Array<[string, ...string[]]> {
  const queueKey = `social:queue:${platform}`;
  const deadKey = `social:dead:${platform}`;
  const payload = JSON.stringify({ ...entry, dead_at: Date.now() });
  return [
    ['ZREM', queueKey, payload],
    ['ZADD', deadKey, String(Date.now()), payload],
  ];
}

/**
 * Build Redis commands to drain due posts from a platform queue.
 *
 * @param platform - The platform queue to drain.
 * @param limit - Max posts to drain per tick (default 50).
 * @returns Commands that fetch and remove due posts (ZRANGEBYSCORE + ZREM).
 *
 * @example
 * ```ts
 * const cmds = buildDrainCommands('twitter', 50);
 * // Upstash REST executes these as a pipeline → returns due posts
 * ```
 */
export function buildDrainCommands(platform: Platform, limit = 50): Array<[string, ...string[]]> {
  const now = Date.now();
  const queueKey = `social:queue:${platform}`;
  return [['ZRANGEBYSCORE', queueKey, '0', String(now), 'LIMIT', '0', String(limit)]];
}

/**
 * Parse raw ZRANGEBYSCORE results from Upstash into QueueEntry objects.
 * Invalid/corrupt entries are silently skipped.
 */
export function parseDrainResults(raw: unknown): QueueEntry[] {
  const entries: QueueEntry[] = [];
  if (!Array.isArray(raw)) return entries;
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    try {
      const parsed = JSON.parse(item) as QueueEntry;
      if (parsed.post_id && parsed.platform && parsed.account_id) {
        entries.push(parsed);
      }
    } catch {
      // skip corrupt entries
    }
  }
  return entries;
}
