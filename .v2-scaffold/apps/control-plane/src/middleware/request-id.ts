/**
 * Request-ID middleware. Generates / propagates an `X-Request-Id` value so every
 * log line, every audit row, every Sentry breadcrumb correlates across hops.
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';

export const requestIdMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const inbound = c.req.header('x-request-id');
  const id = inbound && /^[a-zA-Z0-9._-]{1,128}$/.test(inbound) ? inbound : crypto.randomUUID();
  c.set('requestId', id);
  await next();
  c.res.headers.set('x-request-id', id);
};
