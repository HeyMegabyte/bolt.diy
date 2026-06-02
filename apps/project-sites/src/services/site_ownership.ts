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
