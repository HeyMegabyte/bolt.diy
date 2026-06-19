/**
 * @file analytics_schema.ts
 * @remarks Per-site D1 schema for the Unified Analytics ingestion plane.
 *   Exports `ANALYTICS_DDL` (one CREATE TABLE/INDEX per element) and
 *   `ensureAnalyticsSchema` which runs all DDL idempotently.
 */

/**
 * Ordered list of DDL statements — one `CREATE TABLE IF NOT EXISTS` or
 * `CREATE INDEX IF NOT EXISTS` per element.  D1's `exec()` accepts a single
 * statement; keeping each statement in its own array slot avoids splitting
 * on semicolons (which is unsafe with embedded strings).
 *
 * @example
 * import { ANALYTICS_DDL } from './analytics_schema.js';
 * console.warn('DDL statements:', ANALYTICS_DDL.length);
 */
export const ANALYTICS_DDL: string[] = [
  // ── analytics_events ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id         TEXT    NOT NULL PRIMARY KEY,
    siteId     TEXT    NOT NULL,
    eventId    TEXT    NOT NULL UNIQUE,
    eventType  TEXT    NOT NULL,
    userId     TEXT,
    sessionId  TEXT,
    timestamp  INTEGER NOT NULL,
    payload    TEXT,
    raw_headers TEXT,
    ip         TEXT,
    dedupId    TEXT,
    status     TEXT    NOT NULL DEFAULT 'ingested'
                        CHECK (status IN ('ingested','queued','forwarded','failed')),
    createdAt  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_ae_site_ts
    ON analytics_events (siteId, timestamp DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_ae_event_id
    ON analytics_events (eventId)`,

  `CREATE INDEX IF NOT EXISTS idx_ae_user_ts
    ON analytics_events (userId, timestamp DESC)`,

  // ── dead_letter_events ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS dead_letter_events (
    id             TEXT    NOT NULL PRIMARY KEY,
    eventId        TEXT    NOT NULL,
    siteId         TEXT    NOT NULL,
    failedProvider TEXT    NOT NULL,
    error          TEXT,
    retryCount     INTEGER NOT NULL DEFAULT 0,
    nextRetryAt    INTEGER,
    payload        TEXT,
    createdAt      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  // ── event_dedup ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS event_dedup (
    eventId   TEXT    NOT NULL PRIMARY KEY,
    siteId    TEXT    NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,

  // ── provider_credentials ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS provider_credentials (
    id        TEXT    NOT NULL PRIMARY KEY,
    siteId    TEXT    NOT NULL,
    provider  TEXT    NOT NULL,
    apiKey    TEXT    NOT NULL,
    expiresAt INTEGER,
    rotatedAt INTEGER,
    UNIQUE (siteId, provider)
  )`,

  // ── circuit_breaker_state ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS circuit_breaker_state (
    id            TEXT    NOT NULL PRIMARY KEY,
    siteId        TEXT    NOT NULL,
    provider      TEXT    NOT NULL,
    state         TEXT    NOT NULL DEFAULT 'closed'
                           CHECK (state IN ('closed','open','half_open')),
    failCount     INTEGER NOT NULL DEFAULT 0,
    lastFailAt    INTEGER,
    lastSuccessAt INTEGER,
    updatedAt     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    UNIQUE (siteId, provider)
  )`,

  // ── site_quotas ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS site_quotas (
    siteId         TEXT    NOT NULL PRIMARY KEY,
    eventsPerDay   INTEGER NOT NULL DEFAULT 10000,
    eventsUsedToday INTEGER NOT NULL DEFAULT 0,
    resetAt        INTEGER,
    tier           TEXT    NOT NULL DEFAULT 'free'
                            CHECK (tier IN ('free','pro','enterprise'))
  )`,
];

/**
 * Result shape returned by `ensureAnalyticsSchema`.
 */
export interface EnsureAnalyticsSchemaResult {
  /** `true` if all statements executed without error. */
  ok: boolean;
  /** Number of statements that successfully ran (0 on failure). */
  created: number;
}

/**
 * Runs all analytics DDL statements against the provided D1 database
 * idempotently (`CREATE … IF NOT EXISTS`).
 *
 * Each statement is executed individually because D1's `exec()` accepts
 * exactly one statement per call.
 *
 * @param db - Cloudflare D1Database binding from the Worker environment.
 * @returns `{ ok: true, created: N }` on success; `{ ok: false, created: 0 }` on error.
 * @throws Never — all errors are caught and returned as `{ ok: false }`.
 * @example
 * const result = await ensureAnalyticsSchema(env.DB);
 * if (!result.ok) console.warn('Analytics schema setup failed');
 */
export async function ensureAnalyticsSchema(
  db: D1Database,
): Promise<EnsureAnalyticsSchemaResult> {
  try {
    let created = 0;
    for (const stmt of ANALYTICS_DDL) {
      await db.exec(stmt);
      created++;
    }
    return { ok: true, created };
  } catch (err) {
    console.warn('[analytics_schema] ensureAnalyticsSchema failed:', err);
    return { ok: false, created: 0 };
  }
}
