/**
 * @module lib/feature_guard
 * @description Shared HTTP guard + error envelopes for feature-module handlers.
 *
 * Replaces the per-module copies of `unauthorized`/`notFound`/`badRequest` +
 * the auth-then-flag gate, so every feature surface returns the SAME RFC7807-ish
 * envelope (`{ error: { code, message, request_id, details? } }`) and emits a
 * structured, `feature_slug`-tagged log on a flag-denied request (observability
 * convergence — checklist §7).
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';

import type { Env, Variables } from '../types/env.js';

import { isFlagOn } from '../modules/feature_flags/services.js';

/** Hono context specialized to this app's bindings + variables. */
export type AppCtx = Context<{ Bindings: Env; Variables: Variables }>;

/** Org-scoped identity resolved from the authenticated request. */
export interface OrgScope {
  readonly userId: string;
  readonly orgId: string;
}

/** Build the canonical error envelope (always carries the request id for tracing). */
function envelope(c: AppCtx, code: string, message: string, details?: unknown) {
  return {
    error: {
      code,
      message,
      request_id: c.get('requestId') ?? null,
      ...(details === undefined ? {} : { details }),
    },
  };
}

/** 401 — auth required. */
export const unauthorized = (c: AppCtx) =>
  c.json(envelope(c, 'UNAUTHORIZED', 'Auth required'), 401);
/** 404 — used for both genuinely-missing AND flag-off/forbidden, to avoid leaking existence. */
export const notFound = (c: AppCtx) => c.json(envelope(c, 'NOT_FOUND', 'Not found'), 404);
/** 400 — validation failure; pass the Zod `.flatten()` as details. */
export const badRequest = (c: AppCtx, details?: unknown) =>
  c.json(envelope(c, 'VALIDATION_ERROR', 'Invalid request', details), 400);

/**
 * Auth + feature-flag gate for an org-scoped route.
 *
 * @remarks Returns the {@link OrgScope} to proceed, or a short-circuit
 * `Response`: 401 when unauthenticated, 404 when the flag is off (never 403 —
 * don't leak feature existence). A flag-denied request logs a structured,
 * `feature_slug`-tagged line for observability.
 * @param c       - The request context.
 * @param flagKey - The feature flag gating the route.
 * @returns `OrgScope` on success, else a `Response` to return immediately.
 * @example
 * ```ts
 * const g = await requireOrgFlag(c, 'data_export');
 * if (g instanceof Response) return g;
 * // g.orgId / g.userId are now safe to use
 * ```
 */
export async function requireOrgFlag(c: AppCtx, flagKey: string): Promise<OrgScope | Response> {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) return unauthorized(c);
  if (!(await isFlagOn(c.env, flagKey, { orgId, userId }))) {
    logFlagOff(c, flagKey);
    return notFound(c);
  }
  return { orgId, userId };
}

/** Structured, `feature_slug`-tagged log for a flag-denied request. */
function logFlagOff(c: AppCtx, flagKey: string): void {
  console.warn(
    JSON.stringify({
      feature_slug: flagKey,
      level: 'info',
      message: 'flag off — 404',
      request_id: c.get('requestId') ?? null,
      service: 'feature',
    }),
  );
}

/**
 * Flag-only gate for PUBLIC routes (no auth requirement) — e.g. a donate-widget
 * progress read or a beacon ingest that resolves its own tenant.
 *
 * @remarks Returns `true` to proceed, or a 404 `Response` when the flag is off
 * (never 403). Logs the same structured deny line as {@link requireOrgFlag}.
 * @param c       - The request context.
 * @param flagKey - The feature flag gating the route.
 * @returns `true` on success, else a `Response` to return immediately.
 * @example
 * ```ts
 * const gate = await requireFlag(c, 'donations_engine');
 * if (gate !== true) return gate;
 * ```
 */
export async function requireFlag(c: AppCtx, flagKey: string): Promise<true | Response> {
  const on = await isFlagOn(c.env, flagKey, {
    orgId: c.get('orgId'),
    userId: c.get('userId'),
  });
  if (!on) {
    logFlagOff(c, flagKey);
    return notFound(c);
  }
  return true;
}
