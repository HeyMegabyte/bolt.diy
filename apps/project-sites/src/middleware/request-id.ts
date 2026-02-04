/**
 * Request ID middleware
 * Generates unique request and trace IDs for every request
 */
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types.js';
import { generateUuid } from '@project-sites/shared';

export const requestIdMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now();

  // Use existing request ID from header or generate new one
  const requestId = c.req.header('X-Request-ID') || generateUuid();
  const traceId = c.req.header('X-Trace-ID') || generateUuid();

  // Set in context
  c.set('request_id', requestId);
  c.set('trace_id', traceId);
  c.set('start_time', start);

  // Set response header
  c.header('X-Request-ID', requestId);

  await next();

  // Log request completion
  const duration = Date.now() - start;
  console.log(
    JSON.stringify({
      level: 'info',
      type: 'request',
      request_id: requestId,
      trace_id: traceId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: duration,
      user_agent: c.req.header('User-Agent')?.slice(0, 200),
    })
  );
};
