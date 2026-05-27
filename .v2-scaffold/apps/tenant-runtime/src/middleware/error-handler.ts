/**
 * Centralized error handler and 404 fallback.
 *
 * @remarks
 *  Converts thrown exceptions into branded HTML or RFC 7807 problem JSON via
 *  {@link renderErrorPage}. ZodErrors → 400 with structured field map. Any
 *  unknown error → 500 with a stable error code and the request id pinned for
 *  support correlation.
 */
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { renderErrorPage } from '../error-pages/render';
import type { AppContext } from '../env';

export const onError: ErrorHandler<AppContext> = (err, c) => {
  if (err instanceof HTTPException) {
    const status = err.status as 400 | 401 | 403 | 404 | 500 | 503;
    return renderErrorPage(c, {
      status: (status >= 400 && status <= 503 ? status : 500) as 400 | 401 | 403 | 404 | 500 | 503,
      code: `HTTP_${status}`,
      title: err.message || 'Request rejected',
    });
  }
  if (err instanceof ZodError) {
    return renderErrorPage(c, {
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Validation failed',
      detail: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }
  console.error('tenant-runtime onError', {
    requestId: c.var.requestId,
    tenant: c.env.TENANT_SLUG,
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
  });
  return renderErrorPage(c, {
    status: 500,
    code: 'INTERNAL',
    title: 'Server error',
  });
};

export const notFound: NotFoundHandler<AppContext> = (c) =>
  renderErrorPage(c, { status: 404, code: 'NOT_FOUND', title: 'Page not found' });
