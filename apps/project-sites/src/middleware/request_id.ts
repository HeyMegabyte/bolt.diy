/**
 * @module middleware/request_id
 * @description Per-request correlation ID propagation.
 *
 * Reads an inbound `X-Request-ID` header (when callers want to provide their
 * own trace correlation) or generates a fresh UUID v4. The resulting value
 * is exposed via `c.set('requestId', ...)` for downstream services and
 * echoed back on the response so clients can quote it in support tickets.
 *
 * @packageDocumentation
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Assign a stable correlation ID to every request.
 *
 * @remarks
 * - Sets `c.var.requestId` for downstream consumers (auth, error handler,
 *   logging, Sentry, PostHog).
 * - Echoes `X-Request-ID` on the response.
 * - Honours an inbound `X-Request-ID` header verbatim, allowing distributed
 *   traces to thread through edge → worker boundaries.
 *
 * @example
 * ```ts
 * app.use('*', requestIdMiddleware);
 * ```
 */
export const requestIdMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  await next();
};
