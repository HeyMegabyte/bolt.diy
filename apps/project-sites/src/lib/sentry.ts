/**
 * @module lib/sentry
 *
 * @description
 * Sentry integration for Cloudflare Workers via toucan-js.
 *
 * Toucan is the only Sentry SDK that runs cleanly inside the Workers runtime:
 * it ships zero Node.js deps, hooks the request lifecycle into Sentry's
 * `context` field, and lets us call `captureException` from anywhere without
 * juggling client init.
 *
 * Per-request usage (preferred):
 * ```ts
 * const sentry = getRequestSentry(c);
 * sentry.addBreadcrumb({ category: 'http', message: `${c.req.method} ${c.req.path}` });
 * try { ... } catch (err) { sentry.captureException(err); throw err; }
 * ```
 *
 * Lazy attach (when middleware ran before this file was imported):
 * ```ts
 * captureError(c, err, { extra: 'context' });
 * ```
 *
 * The Toucan client is cached per-request on the Hono context under the
 * `sentry` key so every layer in the request chain shares the same scope
 * (user, tags, breadcrumbs) — drop a breadcrumb in middleware and the
 * exception captured in a route handler picks it up.
 */

import { Toucan } from 'toucan-js';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';

/** Severity levels accepted by `addBreadcrumb` / `captureMessage`. */
type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/** Hono context augmented with the cached Sentry client. */
interface SentryAttachedContext extends Context<{ Bindings: Env; Variables: Variables }> {
  // Cached Toucan instance keyed under a runtime-only symbol so it survives
  // every middleware hop in this request without poisoning the type surface.
}

const SENTRY_KEY = '__sentry_client__';

/**
 * Get or create the Toucan client scoped to the current request. Idempotent —
 * subsequent calls return the same instance so breadcrumbs/user context
 * persist across middleware hops.
 */
export function getRequestSentry(c: Context<{ Bindings: Env; Variables: Variables }>): Toucan {
  const cached = (c as unknown as Record<string, unknown>)[SENTRY_KEY];
  if (cached) return cached as Toucan;

  // Release tracking (item #48): prefer the per-deploy GIT_SHA injected at
  // build time (wrangler.toml vars or `SENTRY_RELEASE`). Fall back to a
  // pkg-version label so events still group when no SHA is wired.
  const release = c.env.SENTRY_RELEASE ?? 'project-sites@0.2.0';
  const environment = c.env.ENVIRONMENT ?? 'development';

  // Tracing sample rate: 10% in production keeps cost predictable on the
  // hot edge path; full sample everywhere else for dev visibility.
  const tracesSampleRate = environment === 'production' ? 0.1 : 1.0;

  // Safely access executionCtx — not present in test environments.
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }

  const sentry = new Toucan({
    dsn: c.env.SENTRY_DSN,
    context: ctx,
    request: c.req.raw,
    environment,
    release,
    tracesSampleRate,
    // sendDefaultPii false (default) — IP/headers are scrubbed.
  });

  sentry.setTag('service', 'project-sites-worker');
  const requestId = c.get('requestId');
  if (requestId) sentry.setTag('request_id', requestId);

  // Backfill user identity if auth middleware already ran. setUser() called
  // again from auth middleware after we attach is fine — Toucan upserts.
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (userId) sentry.setUser({ id: userId });
  if (orgId) sentry.setTag('org_id', orgId);

  (c as unknown as Record<string, unknown>)[SENTRY_KEY] = sentry;
  return sentry;
}

/**
 * Attach the authenticated user to the request's Sentry scope. Safe to call
 * multiple times — Toucan upserts.
 */
export function setUser(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  user: { id?: string; email?: string; orgId?: string } | null,
): void {
  if (!c.env.SENTRY_DSN) return;
  try {
    const sentry = getRequestSentry(c);
    if (!user) {
      sentry.setUser(null);
      return;
    }
    if (user.id) sentry.setUser({ id: user.id, email: user.email });
    if (user.orgId) sentry.setTag('org_id', user.orgId);
  } catch {
    // Sentry failures must never break the request path.
  }
}

/**
 * Drop a breadcrumb into the request's Sentry scope. Categories used in this
 * codebase: `http` (incoming/outgoing), `auth`, `db`, `workflow`, `ai`,
 * `webhook`, `cron`.
 */
export function addBreadcrumb(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  crumb: { category: string; message: string; level?: SentryLevel; data?: Record<string, unknown> },
): void {
  if (!c.env.SENTRY_DSN) return;
  try {
    const sentry = getRequestSentry(c);
    sentry.addBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level ?? 'info',
      data: crumb.data,
      timestamp: Date.now() / 1000,
    });
  } catch {
    // Swallow.
  }
}

/** Tag the request scope — handy for grouping events by route, feature, etc. */
export function setTag(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  key: string,
  value: string,
): void {
  if (!c.env.SENTRY_DSN) return;
  try {
    getRequestSentry(c).setTag(key, value);
  } catch {
    // Swallow.
  }
}

/**
 * Report an error to Sentry with additional context.
 *
 * Safe to call even if SENTRY_DSN is not configured (no-ops). Uses the cached
 * per-request client so breadcrumbs + user context attach automatically.
 */
export function captureError(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!c.env.SENTRY_DSN) return;

  try {
    const sentry = getRequestSentry(c);
    if (extra) sentry.setExtras(extra);
    sentry.captureException(error);
  } catch {
    // Don't let Sentry errors break the app
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'sentry',
        message: 'Failed to report to Sentry',
      }),
    );
  }
}

/**
 * Send a message-level event to Sentry.
 */
export function captureMessage(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (!c.env.SENTRY_DSN) return;

  try {
    const sentry = getRequestSentry(c);
    sentry.captureMessage(message, level);
  } catch {
    // Swallow
  }
}

/**
 * Legacy factory — kept for backwards compat with callers that want a fresh
 * client (e.g. queue/scheduled handlers that don't run inside a Hono request).
 *
 * @deprecated Prefer {@link getRequestSentry} inside Hono handlers.
 */
export function createSentry(c: Context<{ Bindings: Env; Variables: Variables }>): Toucan {
  return getRequestSentry(c);
}
