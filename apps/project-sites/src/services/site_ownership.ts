/**
 * @module services/site_ownership
 * @description Shared multi-tenant ownership guard for site-scoped routes.
 *
 * Many flag-gated `:siteId` routes historically checked auth + flag but NOT
 * that the site belonged to the caller's org — a cross-tenant read/write gap
 * once the flag is enabled. This is the single canonical guard those routes
 * use so the check (and its tests) live in ONE place — never duplicated.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQueryOne } from './db.js';
import { notFound } from '@project-sites/shared';

/**
 * Returns `true` only when `siteId` exists (not soft-deleted) AND belongs to
 * the caller's `orgId`. Callers 404 (never 403 — never leak existence) when
 * this is false.
 *
 * @param env - Worker env (uses `env.DB`).
 * @param orgId - The caller's org id from the auth context (`c.get('orgId')`); `undefined` → not authorized.
 * @param siteId - The site id from the route param.
 *
 * @example
 * ```ts
 * if (!(await assertSiteOwned(c.env, c.get('orgId'), siteId)))
 *   return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
 * ```
 */
export async function assertSiteOwned(
  env: Env,
  orgId: string | undefined,
  siteId: string,
): Promise<boolean> {
  if (!orgId) return false;
  const row = await dbQueryOne<{ org_id: string }>(
    env.DB,
    'SELECT org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return !!row && row.org_id === orgId;
}

/**
 * Load an org-owned site ROW, or throw 404. The throwing, row-returning companion
 * to {@link assertSiteOwned} — use it when the handler needs the site's columns
 * (slug, business_name, …), so the ownership check + the fetch are ONE query
 * instead of an `assertSiteOwned` boolean followed by a second SELECT.
 *
 * Missing == soft-deleted == foreign-org → all 404 `notFound('Site not found')`
 * (never 403 — 403 would confirm the id exists to a prober; the fires 30-36
 * existence-leak protocol). `columns` is CODE-controlled (never user input) so it
 * interpolates safely; `siteId`/`orgId` are bound params.
 *
 * @remarks
 * This THROWS — it only renders as a 404 when the handler runs under the global
 * `errorHandler` (`app.onError(errorHandler)`). Do NOT swap a sibling handler's
 * boolean `if (!await assertSiteOwned(...)) return c.json(404)` guard to this just
 * to "canonicalize": (1) it changes the observable result to a throw, and (2) a
 * route's isolated unit test typically `jest.mock`s this module to export ONLY
 * `assertSiteOwned` — so `requireOwnedSite` resolves to `undefined`, the call is
 * `undefined()` → TypeError → 500 on every path. Reach for this ONLY when the
 * handler genuinely needs the row's columns; otherwise use {@link assertSiteOwned}
 * to match the surrounding idiom. After migrating ANY route handler's guard, run
 * that route's own `<route>_routes.test.ts`, not just `site_ownership.test.ts`.
 * (Reference incident: pseo `/generate` migration ee63c102 → revert ed3ded42.)
 *
 * @param env - Worker env (needs `DB`).
 * @param orgId - The caller's resolved org. Empty/undefined → 404 (unauthorized
 *   callers must never distinguish missing from foreign).
 * @param siteId - The site id from the request.
 * @param columns - SQL column list (default `'id'`). Code literal only.
 * @returns The selected site row (typed by `T`).
 * @throws {AppError} `NOT_FOUND` 'Site not found' on missing/deleted/foreign/no-org.
 * @example
 * const site = await requireOwnedSite<{ slug: string }>(c.env, orgId, siteId, 'slug');
 */
export async function requireOwnedSite<T = { id: string }>(
  env: Pick<Env, 'DB'>,
  orgId: string | undefined,
  siteId: string,
  columns = 'id',
): Promise<T> {
  if (!orgId) throw notFound('Site not found');
  const site = await dbQueryOne<T>(
    env.DB,
    `SELECT ${columns} FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');
  return site;
}
