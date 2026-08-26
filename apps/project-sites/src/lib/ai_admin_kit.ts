/**
 * @module lib/ai_admin_kit
 * @description Shared error/auth scaffolding for the AI admin route family.
 *
 * The authenticated AI-admin surface is split across three files that were all
 * extracted VERBATIM from the original `routes/ai_admin.ts` monolith
 * (route-decomposition installments 15 + 16):
 *
 * - `src/routes/ai_admin.ts`                     — form submissions, AI logs, chat,
 *   credits, team, org, API keys, MCP connections.
 * - `libs/features/ai_endpoints/handlers.ts`     — per-site AI endpoints CRUD + deploy.
 * - `libs/features/ai_context/handlers.ts`       — AI context files + Google Drive sync.
 *
 * Each of those files previously carried a BYTE-IDENTICAL copy of the same
 * scaffolding: the {@link HTTPError} class, the {@link need} auth guard, the
 * {@link siteOwned} ownership guard, the {@link safeJson} parser, and a
 * standalone `onError` handler ({@link aiAdminOnError}). This module is the ONE
 * shared home for that scaffolding — the three files now import from here instead
 * of re-declaring it (installment 17, a DRY consolidation, NOT a route move).
 *
 * BEHAVIOR-NEUTRAL: every export below is byte-for-byte the same logic the three
 * copies carried, so the error/auth runtime behavior of every route is unchanged.
 *
 * @remarks
 * Imported from BOTH the `src/routes` tree (`../lib/ai_admin_kit.js`) AND the
 * `libs/features/<slug>/handlers.ts` tree (`../../../src/lib/ai_admin_kit.js`).
 *
 * `siteOwned` is deliberately NOT replaced by the shared
 * {@link file://../services/site_ownership.ts requireOwnedSite}: `siteOwned`
 * throws the local {@link HTTPError} (which {@link aiAdminOnError} renders as
 * `{ error: { message } }`), whereas `requireOwnedSite` throws a shared `AppError`
 * that only the GLOBAL `errorHandler` renders. Since these route modules register
 * {@link aiAdminOnError} (the standalone/generic-500 variant, with no re-throw to a
 * shared handler), an `AppError` would fall through to the generic-500 branch —
 * turning every "Site not found" 404 into a 500. Keeping `siteOwned` here preserves
 * the exact `HTTPError`→404 behavior.
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Hono request context typed with the platform's {@link Env} bindings and
 * {@link Variables} — the exact `Ctx` alias the three route modules used.
 */
export type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Typed HTTP error thrown from AI-admin handlers. {@link aiAdminOnError} renders
 * an instance as `{ error: { message } }` with the carried `status`; any other
 * thrown value is logged and rendered as a generic 500.
 *
 * @example
 * throw new HTTPError(404, 'Site not found');
 */
export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Assert the request carries both an `orgId` and a `userId` on the context,
 * returning them; throws `HTTPError(401)` when either is missing.
 *
 * @param c - The Hono request context.
 * @returns The resolved `{ orgId, userId }`.
 * @throws {HTTPError} 401 'Authentication required' when org/user context is absent.
 * @example
 * const { orgId, userId } = need(c);
 */
export function need(c: Ctx): { orgId: string; userId: string } {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) throw new HTTPError(401, 'Authentication required');
  return { orgId, userId };
}

/**
 * Load an org-owned site row (`slug` + `business_name`) for `siteId`, or throw
 * `HTTPError(404)`. Missing / soft-deleted / foreign-org all resolve to the same
 * 404 (never 403 — never leak existence).
 *
 * @param c - The Hono request context (uses `c.env.DB`).
 * @param orgId - The caller's org id (from {@link need}).
 * @param siteId - The site id from the route param.
 * @returns The site's `{ slug, business_name }`.
 * @throws {HTTPError} 404 'Site not found' when the site is missing/deleted/foreign.
 * @example
 * const site = await siteOwned(c, orgId, c.req.param('siteId'));
 */
export async function siteOwned(
  c: Ctx,
  orgId: string,
  siteId: string,
): Promise<{ slug: string; business_name: string | null }> {
  const row = await c.env.DB.prepare(
    `SELECT slug, business_name FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(siteId, orgId)
    .first<{ slug: string; business_name: string | null }>();
  if (!row) throw new HTTPError(404, 'Site not found');
  return row;
}

/**
 * Best-effort JSON parse used to hydrate stored JSON columns: returns `null` for
 * empty input, the parsed value on success, and the raw string on parse failure
 * (never throws).
 *
 * @param s - The stored string (or `null`/`undefined`).
 * @returns The parsed value, the raw string on parse failure, or `null` when empty.
 * @example
 * safeJson('{"a":1}'); // → { a: 1 }
 * safeJson('not json'); // → 'not json'
 * safeJson(null); // → null
 */
export function safeJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Standalone Hono `onError` handler for the AI-admin route family. Register with
 * `app.onError(aiAdminOnError)`.
 *
 * Renders a thrown {@link HTTPError} as `{ error: { message } }` with its carried
 * status; any other thrown value is logged server-side (so raw internals never
 * reach the client) and rendered as a generic `{ error: { message: 'internal error' } }`
 * 500. This is the standalone/generic-500 variant (no re-throw to a shared
 * handler), byte-identical to the copies that lived in the three route modules —
 * including the `service: 'ai_admin'` log label.
 *
 * @param err - The thrown error.
 * @param c - The Hono request context.
 * @returns A JSON `Response`.
 * @example
 * aiAdmin.onError(aiAdminOnError);
 */
export function aiAdminOnError(err: Error, c: Ctx): Response {
  if (err instanceof HTTPError)
    return c.json({ error: { message: err.message } }, err.status as 400);
  // Unexpected error → log the detail server-side, return a GENERIC message so
  // raw internals (stack/SQL/paths) never reach the client (HTTPError above is
  // the typed, intentionally-surfaced path).
  console.warn(
    JSON.stringify({
      level: 'error',
      service: 'ai_admin',
      message: 'unhandled error',
      error: err.message,
      request_id: c.get('requestId'),
    }),
  );
  return c.json({ error: { message: 'internal error' } }, 500);
}
