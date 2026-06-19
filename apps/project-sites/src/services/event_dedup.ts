/**
 * @module services/event_dedup
 *
 * 48-hour event-deduplication window for the Unified Analytics ingestion plane
 * (Plane H of `_CONVERGENCE_BACKLOG.md`). The per-site `EventDispatcher` Durable
 * Object keeps one window so a retried beacon (at-least-once delivery) never
 * double-counts on PostHog/GA or inflates Sentry error rates.
 *
 * Pure + deterministic: every method takes an explicit `now` (epoch ms) so tests
 * never touch the clock, and `snapshot()`/`fromSnapshot()` round-trip the live
 * set to/from the DO's SQLite `event_dedup` table across hibernation/crashes.
 *
 * @example
 * const dedup = DedupWindow.fromSnapshot(stored);
 * if (dedup.markIfNew(event.eventId, now)) {
 *   // first time → enqueue
 * } else {
 *   // duplicate within 48h → 202 { status: 'duplicate' }
 * }
 * dedup.prune(now); // drop expired ids (run on the flush alarm)
 */

/** Default window: 48 hours in milliseconds. */
export const DEFAULT_DEDUP_WINDOW_MS = 48 * 60 * 60 * 1000;

/** One persisted dedup entry. */
export interface DedupEntry {
  eventId: string;
  /** Epoch ms at which this id is forgotten. */
  expiresAt: number;
}

/**
 * A TTL set of recently-seen event ids. Construct fresh, or rehydrate from a
 * persisted snapshot via {@link DedupWindow.fromSnapshot}.
 */
export class DedupWindow {
  private readonly windowMs: number;
  private readonly seen: Map<string, number>; // eventId → expiresAt

  constructor(windowMs: number = DEFAULT_DEDUP_WINDOW_MS, snapshot?: readonly DedupEntry[]) {
    this.windowMs = Math.max(0, windowMs);
    this.seen = new Map();
    for (const e of snapshot ?? []) this.seen.set(e.eventId, e.expiresAt);
  }

  /** Rehydrate from a persisted snapshot (e.g. SQLite rows). */
  static fromSnapshot(snapshot: readonly DedupEntry[], windowMs: number = DEFAULT_DEDUP_WINDOW_MS): DedupWindow {
    return new DedupWindow(windowMs, snapshot);
  }

  /**
   * Whether `eventId` was seen within the window and is not yet expired at `now`.
   * Read-only (does not record). An expired entry reads as not-present and is
   * dropped lazily.
   */
  has(eventId: string, now: number): boolean {
    const expiresAt = this.seen.get(eventId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.seen.delete(eventId);
      return false;
    }
    return true;
  }

  /**
   * Atomic dedup-and-record: returns `true` if `eventId` is NEW (and records it),
   * `false` if it is a live duplicate. This is the one call the DO needs on the
   * hot path — check + record without a TOCTOU gap.
   */
  markIfNew(eventId: string, now: number): boolean {
    if (this.has(eventId, now)) return false;
    this.seen.set(eventId, now + this.windowMs);
    return true;
  }

  /** Force-record an id (used when re-hydrating in-flight state). */
  add(eventId: string, now: number): void {
    this.seen.set(eventId, now + this.windowMs);
  }

  /**
   * Drop every entry expired at `now`. Run on the flush alarm to bound memory /
   * SQLite growth. Returns the number pruned.
   */
  prune(now: number): number {
    let pruned = 0;
    for (const [id, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(id);
        pruned += 1;
      }
    }
    return pruned;
  }

  /** Live (non-pruned) entry count — includes not-yet-pruned expired ids. */
  get size(): number {
    return this.seen.size;
  }

  /** Serialise the live set for persistence. */
  snapshot(): DedupEntry[] {
    return Array.from(this.seen, ([eventId, expiresAt]) => ({ eventId, expiresAt }));
  }
}
