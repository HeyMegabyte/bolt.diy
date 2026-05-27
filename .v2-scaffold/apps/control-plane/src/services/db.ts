/**
 * Thin D1 helpers. Strict typing — never `any`, never `@ts-ignore`.
 *
 * Multi-region read-replica support via D1 Sessions API (2025-09 GA):
 *   - `withDbSession(c)` wraps `c.env.DB` in a session keyed by the request's
 *     `cf-d1-bookmark` header (or `first-unconstrained` when absent).
 *   - After the handler runs, call `attachBookmark(c, session)` to surface the
 *     latest bookmark to clients via `x-d1-bookmark` so subsequent reads in the
 *     same logical session stay sequentially consistent across replicas.
 *
 * @see https://developers.cloudflare.com/d1/best-practices/read-replication/
 */

import type {
  D1Database,
  D1DatabaseSession,
  D1Result,
} from '@cloudflare/workers-types';
import type { Context } from 'hono';
import type { HonoEnv } from '../types.js';

/** First-touch bookmark constraint — accepts any replica for an empty session. */
export const FIRST_UNCONSTRAINED = 'first-unconstrained' as const;
/** Header clients pass back to pin reads to or beyond a known commit point. */
export const D1_BOOKMARK_HEADER = 'cf-d1-bookmark';
/** Header we emit so clients can echo it back next request. */
export const D1_BOOKMARK_RESPONSE_HEADER = 'x-d1-bookmark';

/**
 * Bind a D1 session for the lifetime of this request.
 *
 * The bookmark is read from the inbound `cf-d1-bookmark` header. When absent
 * (first request from a new client) we use `first-unconstrained` so the first
 * read can hit any replica, then subsequent reads in the same session honor
 * the bookmark we returned.
 */
export function withDbSession(c: Context<HonoEnv>): D1DatabaseSession {
  const bookmark = c.req.header(D1_BOOKMARK_HEADER) ?? FIRST_UNCONSTRAINED;
  return c.env.DB.withSession(bookmark);
}

/**
 * Attach the post-session bookmark to the outbound response so the client can
 * round-trip it. Safe to call multiple times — last wins.
 */
export function attachBookmark(
  c: Context<HonoEnv>,
  session: D1DatabaseSession,
): void {
  const bookmark = session.getBookmark();
  if (bookmark) {
    c.res.headers.set(D1_BOOKMARK_RESPONSE_HEADER, bookmark);
  }
}

/**
 * Accepts either a raw D1Database or a session-bound D1DatabaseSession.
 * Both expose `.prepare()` with the same shape, so query helpers can take
 * the union without branching internally.
 */
type D1Like = Pick<D1Database, 'prepare'>;

/** SELECT * → array. */
export async function dbQuery<T = Record<string, unknown>>(
  db: D1Like,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

/** SELECT * → first row or null. */
export async function dbQueryOne<T = Record<string, unknown>>(
  db: D1Like,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  return (await stmt.first<T>()) ?? null;
}

/** Generic INSERT with auto-timestamps. Returns the inserted record minus generated cols. */
export async function dbInsert<T extends Record<string, unknown>>(
  db: D1Like,
  table: string,
  record: T,
): Promise<T> {
  const now = new Date().toISOString();
  const full: Record<string, unknown> = {
    created_at: now,
    updated_at: now,
    ...record,
  };
  const cols = Object.keys(full);
  const placeholders = cols.map((_, i) => `?${i + 1}`).join(', ');
  const values = cols.map((k) => full[k]);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  await db
    .prepare(sql)
    .bind(...values)
    .run();
  return full as T;
}

/** UPDATE row by WHERE clause. */
export async function dbUpdate(
  db: D1Like,
  table: string,
  updates: Record<string, unknown>,
  where: string,
  whereParams: readonly unknown[],
): Promise<D1Result> {
  const fields: Record<string, unknown> = {
    ...updates,
    updated_at: new Date().toISOString(),
  };
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = ?${i + 1}`).join(', ');
  const offset = cols.length;
  const whereWithOffset = where.replace(
    /\?(\d+)/g,
    (_, n) => `?${parseInt(n, 10) + offset}`,
  );
  const sql = `UPDATE ${table} SET ${sets} WHERE ${whereWithOffset}`;
  return db
    .prepare(sql)
    .bind(...cols.map((c) => fields[c]), ...whereParams)
    .run();
}

/** Raw execute. */
export function dbExecute(
  db: D1Like,
  sql: string,
  params: readonly unknown[] = [],
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}
