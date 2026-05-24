/**
 * @module interceptors/sentry-breadcrumb
 *
 * @description
 * Drops `http.request` and `http.response` breadcrumbs into Sentry so the trail
 * of API calls leading up to a thrown error is visible in the event detail
 * view. Runs AFTER `retryInterceptor` so the breadcrumb captures the resolved
 * request (including the `X-Request-ID` header) — pair this with the worker's
 * own `http` breadcrumbs (same category, same requestId) to reconstruct the
 * full edge round-trip in one Sentry timeline.
 *
 * Body payloads are NEVER attached — only method, URL, status, duration, and
 * the request ID. That keeps PII out of breadcrumbs (Sentry's `sendDefaultPii`
 * is off but request bodies often contain emails/auth tokens regardless).
 */

import { type HttpInterceptorFn, type HttpHandlerFn, type HttpRequest, type HttpEvent, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { type Observable, tap } from 'rxjs';
import { SentryService } from '../services/sentry.service';

/** Strip query string + fragment so breadcrumbs don't leak tokens via URL. */
function safeUrl(url: string): string {
  try {
    const u = new URL(url, window.location.origin);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split('?')[0]?.split('#')[0] ?? url;
  }
}

export const sentryBreadcrumbInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const sentry = inject(SentryService);
  if (!sentry.isEnabled()) return next(req);

  const startedAt = performance.now();
  const requestId = req.headers.get('X-Request-ID') ?? undefined;
  const url = safeUrl(req.url);

  sentry.addBreadcrumb({
    category: 'http',
    message: `${req.method} ${url}`,
    level: 'info',
    data: { method: req.method, url, request_id: requestId },
  });

  return next(req).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          const duration_ms = Math.round(performance.now() - startedAt);
          sentry.addBreadcrumb({
            category: 'http',
            message: `${req.method} ${url} → ${event.status}`,
            level: event.status >= 500 ? 'error' : event.status >= 400 ? 'warning' : 'info',
            data: { method: req.method, url, status: event.status, duration_ms, request_id: requestId },
          });
        }
      },
      error: (err: unknown) => {
        const duration_ms = Math.round(performance.now() - startedAt);
        const status = err instanceof HttpErrorResponse ? err.status : 0;
        sentry.addBreadcrumb({
          category: 'http',
          message: `${req.method} ${url} → ERROR ${status}`,
          level: 'error',
          data: { method: req.method, url, status, duration_ms, request_id: requestId },
        });
      },
    }),
  );
};
