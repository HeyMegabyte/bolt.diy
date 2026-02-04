/**
 * Global error handler middleware
 */
import type { ErrorHandler } from 'hono';
import type { AppEnv } from '../types.js';
import {
  AppError,
  normalizeError,
  createErrorResponse,
  redactPiiFromObject,
} from '@project-sites/shared';

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  const requestId = c.get('request_id') || 'unknown';
  const appError = normalizeError(error);

  // Log error (redact PII)
  console.error(
    JSON.stringify({
      level: 'error',
      type: 'error',
      request_id: requestId,
      trace_id: c.get('trace_id'),
      error_code: appError.code,
      error_message: appError.message,
      error_stack: appError.stack?.slice(0, 1000),
      is_operational: appError.isOperational,
      details: appError.details ? redactPiiFromObject(appError.details) : undefined,
      path: c.req.path,
      method: c.req.method,
    })
  );

  // Return error response
  const response = createErrorResponse(appError, requestId);

  return c.json(response, appError.statusCode as any);
};
