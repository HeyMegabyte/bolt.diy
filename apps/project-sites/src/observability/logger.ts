/**
 * Structured application logger for the Project Sites Worker.
 *
 * Emits one `console.warn(JSON.stringify({...}))` line per call (picked up by
 * Workers Tracing / OTLP) and forwards the same event to Axiom via
 * `sendToAxiom` fire-and-forget when `AXIOM_ENABLED=true`.
 *
 * @module observability/logger
 */

import type { Env } from '../types/env.js';
import { type AppLogContext, redactSecrets } from './context.js';
import { sendToAxiom } from './axiom.js';

/** Supported log levels. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured logger interface for request-scoped logging.
 *
 * @example
 * ```ts
 * const log = createLogger(env, ctx, { service: 'api', environment: 'production' });
 * log.info('Site created', { site_id: 's_123', org_id: 'o_456' });
 * log.error('Workflow failed', { workflow_id: 'wf_789' }, err);
 * ```
 */
export interface AppLogger {
  /**
   * Log a debug-level event (verbose diagnostics).
   * @param message - Human-readable description.
   * @param context - Optional additional key/value pairs (secrets redacted).
   */
  debug(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an info-level event (normal operations).
   * @param message - Human-readable description.
   * @param context - Optional additional key/value pairs (secrets redacted).
   */
  info(message: string, context?: Record<string, unknown>): void;

  /**
   * Log a warn-level event (recoverable issues, fallback paths).
   * @param message - Human-readable description.
   * @param context - Optional additional key/value pairs (secrets redacted).
   */
  warn(message: string, context?: Record<string, unknown>): void;

  /**
   * Log an error-level event (caught exceptions with context).
   * @param message - Human-readable description.
   * @param context - Optional additional key/value pairs (secrets redacted).
   * @param error - Optional error object; serialized as `{message, name, stack}`.
   */
  error(message: string, context?: Record<string, unknown>, error?: unknown): void;
}

/** @internal */
function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err) };
}

/**
 * Build a log event object and emit it to `console.warn` + Axiom.
 * @internal
 */
function emitEvent(
  env: Env,
  ctx: ExecutionContext | undefined,
  level: LogLevel,
  message: string,
  base: AppLogContext,
  context?: Record<string, unknown>,
  error?: unknown,
): void {
  const event: Record<string, unknown> = {
    level,
    ts: Date.now(),
    msg: message,
    ...base,
    ...(context !== undefined ? redactSecrets(context) : {}),
    ...(error !== undefined ? { error: serializeError(error) } : {}),
  };

  // Always emit to Workers Tracing / OTLP via console.warn (eslint blocks console.log)
  console.warn(JSON.stringify(event));

  // Optionally forward to Axiom (fire-and-forget)
  sendToAxiom(env, ctx, env.AXIOM_DATASET ?? 'projectsites', [event]);
}

/**
 * Create a scoped structured logger for a single request or job.
 *
 * @param env  - Worker env bindings (for Axiom config).
 * @param ctx  - Worker execution context (for `waitUntil`).
 * @param base - Immutable context fields attached to every log event.
 * @returns A fully-wired `AppLogger`.
 *
 * @example
 * ```ts
 * const log = createLogger(env, ctx, {
 *   service: 'site-generation',
 *   environment: env.ENVIRONMENT ?? 'production',
 *   request_id: c.get('requestId'),
 * });
 * log.info('Workflow step started', { step: 'research-brand' });
 * ```
 */
export function createLogger(
  env: Env,
  ctx: ExecutionContext | undefined,
  base: AppLogContext,
): AppLogger {
  return {
    debug: (message, context) => emitEvent(env, ctx, 'debug', message, base, context),
    info: (message, context) => emitEvent(env, ctx, 'info', message, base, context),
    warn: (message, context) => emitEvent(env, ctx, 'warn', message, base, context),
    error: (message, context, error) => emitEvent(env, ctx, 'error', message, base, context, error),
  };
}
