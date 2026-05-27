/**
 * Sentry wiring — defensive lazy-import so the bundle still builds when
 * `@sentry/angular` isn't installed locally (it lands in CI), and so SSR
 * passes never try to ship the browser SDK to the edge.
 *
 * Init point: browser bootstrap only (called from `app.config.ts`).
 * Error path: `createSentryErrorHandler()` returns Angular's default
 * `ErrorHandler` plus a one-line `captureException` shim.
 *
 * @see app.config.ts where `initSentry()` runs at module load
 * @see ./interceptors.ts which calls `addSentryBreadcrumb` + `captureSentryException`
 */
import { ErrorHandler } from '@angular/core';

// `@sentry/angular` is loaded lazily so that:
//  (a) the SSR Worker bundle never imports it,
//  (b) typecheck passes even without the package installed (typed `any`
//      behind a narrow public surface here),
//  (c) the bundle gracefully degrades if the network blocks Sentry.
type SentryLike = {
  init: (opts: Record<string, unknown>) => void;
  addBreadcrumb: (b: Record<string, unknown>) => void;
  captureException: (e: unknown) => void;
  createErrorHandler?: (opts?: Record<string, unknown>) => ErrorHandler;
};

let sentryRef: SentryLike | null = null;

/**
 * Bootstrap Sentry on the browser. No-op on SSR (no `window`).
 * Reads DSN + environment from `window.__PS_CONFIG__` (injected by the
 * SSR shell) — never from `process.env`, which doesn't exist at the edge.
 */
export function initSentry(): void {
  if (typeof window === 'undefined') return;
  const cfg = (window as unknown as {
    __PS_CONFIG__?: { sentryDsn?: string; env?: string; release?: string };
  }).__PS_CONFIG__;
  if (!cfg?.sentryDsn) return;

  // Dynamic import keeps `@sentry/angular` out of the SSR graph.
  import('@sentry/angular' as string)
    .then((mod) => {
      sentryRef = mod as unknown as SentryLike;
      sentryRef.init({
        dsn: cfg.sentryDsn,
        environment: cfg.env ?? 'production',
        release: cfg.release,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0.1,
        sendDefaultPii: false,
      });
    })
    .catch(() => {
      // Sentry blocked / not installed → carry on without it.
    });
}

/** Add a breadcrumb if Sentry has finished loading; otherwise drop. */
export function addSentryBreadcrumb(b: {
  category: string;
  message: string;
  level: 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}): void {
  sentryRef?.addBreadcrumb(b);
}

/** Capture an exception if Sentry has finished loading; otherwise drop. */
export function captureSentryException(e: unknown): void {
  sentryRef?.captureException(e);
}

/**
 * Returns an Angular `ErrorHandler` that forwards to Sentry when present
 * and falls back to the default error logger otherwise.
 */
export function createSentryErrorHandler(): ErrorHandler {
  return {
    handleError(error: unknown): void {
      try {
        captureSentryException(error);
      } finally {
        // Re-log so devs still see the stack in console.
        // eslint-disable-next-line no-console
        console.error(error);
      }
    },
  };
}
