/**
 * Structured logging library — item #50.
 *
 * @remarks
 * Emits exactly one JSON line per call with the schema mandated by
 * `~/.claude/.../verification-loop.md` §9.2:
 *   `{ level, service, env, eventName, requestId, userId, orgId, durationMs,
 *     status, ts, ...safeFields }`
 *
 * Every value passes through a redaction allowlist before serialization so
 * full request bodies, secrets, and tokens never reach Wrangler tail, Axiom,
 * or downstream parsers. Callers can pass either a plain fields object or a
 * Hono `Context` — the context branch auto-extracts `requestId`, `userId`,
 * `orgId`, and `ENVIRONMENT` so handlers never have to thread them by hand.
 *
 * Output format keeps the historical `console.warn(JSON.stringify(...))`
 * shape so existing log queries against `level` / `service` keep working.
 *
 * @example
 * ```ts
 * // Simple (back-compat with the prior stub)
 * log.info('webhook_received', { provider: 'stripe', event_id: evt.id });
 *
 * // Context-aware (auto-fills requestId/userId/orgId/env)
 * log.warn('rate_limit_exceeded', { path: c.req.path }, c);
 *
 * // Error
 * log.error('payment_failed', { order_id, cause: err.code });
 * ```
 */

import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Structured fields attached to every log entry.
 *
 * @remarks
 * Keys are snake_case for downstream JSON-log parser compatibility (PostHog,
 * Axiom, Datadog). Values must be JSON-serializable.
 */
export type LogFields = Record<string, unknown>;

/** Hono context type alias for ergonomic call signatures. */
export type LogContext = Context<{ Bindings: Env; Variables: Variables }>;

/** Allowed log levels. */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * Safe-context allowlist. Any key NOT in this set is dropped from the log
 * line — prevents accidental leakage of `password`, `api_key`, full request
 * bodies, PII, etc. Add a new key only after auditing it is safe.
 *
 * @remarks
 * Keep this conservative. Logs are immortal; one leaked secret is one too
 * many. When in doubt, hash before logging instead of adding the field here.
 */
const SAFE_FIELD_ALLOWLIST: ReadonlySet<string> = new Set([
  'service',
  'env',
  'eventName',
  'event',
  'requestId',
  'request_id',
  'userId',
  'user_id',
  'orgId',
  'org_id',
  'siteId',
  'site_id',
  'slug',
  'path',
  'method',
  'status',
  'statusCode',
  'durationMs',
  'duration_ms',
  'attempt',
  'max',
  'provider',
  'event_id',
  'eventId',
  'job_name',
  'jobId',
  'version',
  'release',
  'code',
  'error_code',
  'error',
  'message',
  'cause',
  'ts',
  'level',
  'route',
  'cf_ray',
  'colo',
  'business_name',
  'ip_hash',
  'count',
  'success',
  'failed',
  'ok',
  'total',
  'fields',
]);

/**
 * Patterns whose VALUES we never log even when the key looks safe. Defends
 * against callers passing raw tokens under an innocuous key.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^sk_(live|test)_[A-Za-z0-9]{16,}$/, // Stripe secret keys
  /^rk_(live|test)_[A-Za-z0-9]{16,}$/, // Stripe restricted keys
  /^whsec_[A-Za-z0-9]{16,}$/, // Stripe webhook secret
  /^re_[A-Za-z0-9]{20,}$/, // Resend
  /^SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/, // SendGrid
  /^xox[bpa]-[A-Za-z0-9-]{20,}$/, // Slack
  /^ghp_[A-Za-z0-9]{30,}$/, // GitHub PAT
  /^gho_[A-Za-z0-9]{30,}$/, // GitHub OAuth
  /^Bearer\s+[A-Za-z0-9._-]{20,}$/i, // Authorization headers
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}$/, // JWT
];

/**
 * Apply the safe-context allowlist to a fields object.
 *
 * @internal
 */
function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELD_ALLOWLIST.has(key)) continue;
    if (typeof value === 'string' && SECRET_VALUE_PATTERNS.some((p) => p.test(value))) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Pull request-scoped context (requestId/userId/orgId/env) off a Hono
 * `Context`. Soft-fails if any field is missing.
 *
 * @internal
 */
function extractContext(c: LogContext | undefined): LogFields {
  if (!c) return {};
  const out: LogFields = {};
  try {
    const rid = c.get('requestId');
    if (rid) out.requestId = rid;
    const uid = c.get('userId');
    if (uid) out.userId = uid;
    const oid = c.get('orgId');
    if (oid) out.orgId = oid;
    const env = c.env?.ENVIRONMENT;
    if (env) out.env = env;
  } catch {
    // No-op: missing context is non-fatal for logging.
  }
  return out;
}

/**
 * Internal: emit one structured JSON line via `console.warn` (eslint blocks
 * `console.log`).
 *
 * @internal
 */
function emit(
  level: LogLevel,
  eventName: string,
  fields: LogFields,
  c?: LogContext,
): void {
  const ctxFields = extractContext(c);
  const payload = {
    level,
    service: 'project-sites',
    env: ctxFields.env ?? 'unknown',
    eventName,
    ts: new Date().toISOString(),
    ...redact({ ...ctxFields, ...fields }),
  };
  console.warn(JSON.stringify(payload));
}

/**
 * Structured logger used across the Worker.
 *
 * @example
 * ```ts
 * log.info('site_created', { site_id, slug });
 * log.warn('retry_attempt', { attempt: 2, max: 3 }, c);
 * log.error('payment_failed', { order_id });
 * ```
 */
export const log = {
  /**
   * Emit an `info`-level event.
   *
   * @param eventName - Snake_case event name (e.g. `site_created`).
   * @param fields - Structured context appended to the log payload.
   * @param c - Optional Hono context for auto-extracting requestId/userId/orgId/env.
   */
  info: (eventName: string, fields: LogFields = {}, c?: LogContext): void =>
    emit('info', eventName, fields, c),

  /**
   * Emit a `warn`-level event.
   *
   * @param eventName - Snake_case event name (e.g. `rate_limit_exceeded`).
   * @param fields - Structured context appended to the log payload.
   * @param c - Optional Hono context for auto-extracting requestId/userId/orgId/env.
   */
  warn: (eventName: string, fields: LogFields = {}, c?: LogContext): void =>
    emit('warn', eventName, fields, c),

  /**
   * Emit an `error`-level event.
   *
   * @remarks
   * Does NOT capture to Sentry — pair with `captureError` from
   * `src/lib/sentry.ts` at the call site when an exception is involved.
   *
   * @param eventName - Snake_case event name (e.g. `payment_failed`).
   * @param fields - Structured context appended to the log payload.
   * @param c - Optional Hono context for auto-extracting requestId/userId/orgId/env.
   */
  error: (eventName: string, fields: LogFields = {}, c?: LogContext): void =>
    emit('error', eventName, fields, c),

  /**
   * Emit a `debug`-level event. Suppressed in production unless `LOG_DEBUG`
   * env var is set to a truthy value.
   *
   * @param eventName - Snake_case event name (e.g. `route_matched`).
   * @param fields - Structured context appended to the log payload.
   * @param c - Optional Hono context for auto-extracting requestId/userId/orgId/env.
   */
  debug: (eventName: string, fields: LogFields = {}, c?: LogContext): void => {
    const env = c?.env?.ENVIRONMENT;
    if (env === 'production') return;
    emit('debug', eventName, fields, c);
  },
} as const;

/**
 * Hono middleware: emit one structured log line per request.
 *
 * @remarks
 * Mount AFTER `requestIdMiddleware` so `requestId` is already on the context.
 * Captures `path`, `method`, `status`, `durationMs`, and `requestId` — never
 * the request body (size + secret risk).
 *
 * @example
 * ```ts
 * app.use('*', requestIdMiddleware);
 * app.use('*', requestLogger);
 * ```
 *
 * @throws Never — soft-fails so logging issues cannot break a request.
 */
export async function requestLogger(c: LogContext, next: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await next();
  } finally {
    const durationMs = Date.now() - start;
    try {
      emit(
        'info',
        'http_request',
        {
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          status: c.res.status,
          durationMs,
        },
        c,
      );
    } catch {
      // No-op: never let logging break a response.
    }
  }
}
