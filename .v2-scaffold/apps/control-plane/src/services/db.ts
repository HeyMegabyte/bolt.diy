/**
 * Thin D1 helpers. Strict typing — never `any`, never `@ts-ignore`.
 */

import type { D1Database, D1Result } from '@cloudflare/workers-types';

/** SELECT * → array. */
export async function dbQuery<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

/** SELECT * → first row or null. */
export async function dbQueryOne<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  return (await stmt.first<T>()) ?? null;
}

/** Generic INSERT with auto-timestamps. Returns the inserted record minus generated cols. */
export async function dbInsert<T extends Record<string, unknown>>(
  db: D1Database,
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
  db: D1Database,
  table: string,
  updates: Record<string, unknown>,
  where: string,
  whereParams: readonly unknown[],
): Promise<D1Result> {
  const fields = { ...updates, updated_at: new Date().toISOString() };
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
  db: D1Database,
  sql: string,
  params: readonly unknown[] = [],
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}
