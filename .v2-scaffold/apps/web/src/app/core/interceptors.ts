/**
 * HTTP interceptor chain shared by browser + SSR boot. Standalone functional
 * interceptors per Angular 21's `withInterceptors([...])` pattern — no
 * class-based interceptors, no `HTTP_INTERCEPTORS` token churn.
 *
 * Order matters and is the order they are passed to `withInterceptors`:
 *   1. `authInterceptor`   — attach Clerk session JWT
 *   2. `viewAsInterceptor` — super-admin "view as" role spoofing header
 *   3. `tenantInterceptor` — pin tenant slug from URL/host to every request
 *   4. `errorInterceptor`  — RFC 7807 ProblemDetails normalisation + Sentry breadcrumb
 *
 * @see app.config.ts where these are wired
 */
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
} from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { addSentryBreadcrumb, captureSentryException } from './sentry';

const ABSOLUTE_URL_RX = /^https?:\/\//i;

function isInternal(url: string): boolean {
  if (!ABSOLUTE_URL_RX.test(url)) return true;
  try {
    const u = new URL(url);
    return /(^|\.)projectsites\.dev$/.test(u.hostname) || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

/**
 * Attach the Clerk session JWT (browser only) as `Authorization: Bearer ...`.
 * Reads from `window.Clerk.session.getToken()` lazily so the SSR pass — which
 * has no Clerk script loaded — never trips.
 */
export const authInterceptor = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return next(req);
  if (!isInternal(req.url)) return next(req);

  // Lazy/late binding — Clerk script is loaded async; no top-level import.
  const w = window as unknown as {
    Clerk?: { session?: { getToken: () => Promise<string | null> } };
  };
  const token: string | undefined = (() => {
    // Synchronous read of a previously-cached token on `window`.
    const cached = (window as unknown as { __clerkToken?: string }).__clerkToken;
    return cached;
  })();

  // Background-refresh the cached token; non-blocking.
  if (w.Clerk?.session) {
    w.Clerk.session
      .getToken()
      .then((t) => {
        if (t) (window as unknown as { __clerkToken?: string }).__clerkToken = t;
      })
      .catch(() => {
        /* ignore — `/api/me` will surface auth state */
      });
  }

  if (!token) return next(req);
  return next(
    req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
  );
};

/**
 * Forwards the super-admin "view as" role override so the API treats the
 * caller as the target role for this request. Reads from `localStorage`
 * (browser only) so a reload preserves the spoof.
 */
export const viewAsInterceptor = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return next(req);
  if (!isInternal(req.url)) return next(req);

  let viewAs: string | null = null;
  try {
    viewAs = window.localStorage.getItem('ps:viewAs');
  } catch {
    // Storage can throw under privacy mode — that's fine, no spoof.
  }
  if (!viewAs) return next(req);
  return next(req.clone({ setHeaders: { 'X-View-As': viewAs } }));
};

/**
 * Resolve the active tenant slug from the URL (e.g.
 * `acme.projectsites.dev`) and pin it on every internal request via
 * `X-Tenant-Slug`. The control plane prefers the header over host
 * inference, which makes the admin SPA at `app.projectsites.dev` able
 * to act on any tenant the operator has access to.
 */
export const tenantInterceptor = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return next(req);
  if (!isInternal(req.url)) return next(req);

  const host = window.location.hostname;
  const m = host.match(/^([a-z0-9-]+)\.projectsites\.dev$/i);
  if (!m || m[1] === 'app' || m[1] === 'api' || m[1] === 'www') return next(req);
  return next(req.clone({ setHeaders: { 'X-Tenant-Slug': m[1] } }));
};

/**
 * Catch HTTP errors, breadcrumb them to Sentry with a redacted URL,
 * report 5xx + unexpected-shape responses as exceptions, and rethrow
 * with the RFC 7807 ProblemDetails body intact.
 */
export const errorInterceptor = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      addSentryBreadcrumb({
        category: 'fetch',
        message: `${req.method} ${redactUrl(req.url)} → ${err.status}`,
        level: err.status >= 500 ? 'error' : 'warning',
        data: { status: err.status },
      });
      if (err.status >= 500 || err.status === 0) {
        captureSentryException(err);
      }
      return throwError(() => err);
    }),
  );
};

/** Strip query strings so we never breadcrumb auth tokens. */
function redactUrl(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}
