/**
 * Central error handler. Turns AppError + ZodError + unknown into RFC-7807 envelopes.
 */

import type { Context, Next } from 'hono';
import { ZodError } from 'zod';
import { AppError, ErrorCode, type HonoEnv, type ProblemEnvelope } from '../types.js';

export async function errorHandler(c: Context<HonoEnv>, next: Next): Promise<Response> {
  try {
    await next();
    return c.res;
  } catch (err) {
    const requestId = c.get('requestId') ?? 'unknown';

    if (err instanceof AppError) {
      const body: ProblemEnvelope = {
        error: {
          code: err.code,
          message: err.message,
          request_id: requestId,
          details: err.details,
        },
      };
      return c.json(body, err.status as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500);
    }

    if (err instanceof ZodError) {
      const body: ProblemEnvelope = {
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: 'Request validation failed',
          request_id: requestId,
          details: err.issues,
        },
      };
      return c.json(body, 400);
    }

    const body: ProblemEnvelope = {
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : 'unknown error',
        request_id: requestId,
      },
    };
    return c.json(body, 500);
  }
}
