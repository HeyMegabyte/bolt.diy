/**
 * @module services/sentry
 *
 * @description
 * Frontend Sentry SDK wrapper for the admin dashboard.
 *
 * Reads the DSN from `<meta name="x-sentry-dsn">` (injected by the Worker at
 * serve-time, same pattern as `x-posthog-key` / `x-stripe-pk`). Initializes
 * `@sentry/angular` with browser tracing + Replay, then exposes a small
 * imperative API the rest of the app uses to attach user identity, drop
 * breadcrumbs, capture messages, and set tags.
 *
 * Safe-by-default: if the DSN meta tag is empty / `none` / unset the service
 * no-ops every call so dev builds + missing-config don't throw.
 *
 * @see {@link initSentryEarly} — called from `main.ts`/`app.config.ts` before
 *   Angular bootstrap so router + error-handler integrations attach cleanly.
 */

import { Injectable } from '@angular/core';
import * as Sentry from '@sentry/angular';

/** Severity levels accepted by `captureMessage`. */
export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/** Identity attached to all subsequent events (cleared on logout). */
export interface SentryUser {
  readonly id: string;
  readonly email?: string;
  readonly orgId?: string;
}

/**
 * Cheap one-way hash of a string using Web Crypto SHA-256.
 * Used to anonymise email addresses before they reach Sentry (keeps PII out
 * of the error tracker while still allowing "same user across events" grouping).
 */
async function hashString(value: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 16); // 16 hex chars is enough for grouping
  } catch {
    return '[hash-error]';
  }
}

/** Free-form breadcrumb payload — kept narrow so consumers can't pass `any`. */
export interface SentryBreadcrumb {
  readonly category: string;
  readonly message: string;
  readonly level?: SentryLevel;
  readonly data?: Record<string, unknown>;
}

/** Read a meta tag's `content` attribute, returning null when absent or sentinel. */
function readMeta(name: string): string | null {
  const el = document.querySelector(`meta[name="${name}"]`);
  if (!el) return null;
  const v = el.getAttribute('content')?.trim();
  if (!v || v === 'none' || v === '') return null;
  return v;
}

/** Derive `dev` / `staging` / `production` from the current hostname. */
function detectEnvironment(): 'development' | 'staging' | 'production' {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    return 'development';
  }
  if (host.includes('staging') || host.includes('preview')) return 'staging';
  return 'production';
}

/**
 * Boot the Sentry SDK. Safe to call once before Angular bootstrap. No-op when
 * the DSN meta tag is missing — the rest of the SentryService API still works,
 * just discards every call.
 *
 * @returns true when Sentry was initialized, false when it was skipped.
 */
export function initSentryEarly(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const dsn = readMeta('x-sentry-dsn');
  if (!dsn) {
    // No DSN → silently disabled. Don't warn — that would noise the console
    // on every dev refresh when the secret isn't wired locally.
    return false;
  }

  const release = readMeta('x-app-release') ?? '@project-sites/frontend@1.0.0';
  const environment = detectEnvironment();

  try {
    Sentry.init({
      dsn,
      environment,
      release,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      replaysSessionSampleRate: environment === 'production' ? 0.01 : 0.1,
      replaysOnErrorSampleRate: 1.0,
      // Server-side PII redaction is enforced; client passes user.id only.
      sendDefaultPii: false,
      beforeSend: (event) => {
        // Non-production: expose a global hook so Playwright can assert
        // captureException was invoked (see e2e/sentry-crash.spec.ts).
        if (environment !== 'production') {
          (window as unknown as Record<string, unknown>)['__sentry_test_hook'] =
            ((window as unknown as Record<string, unknown>)['__sentry_test_hook_count'] as number ?? 0) + 1;
          (window as unknown as Record<string, unknown>)['__sentry_test_hook_count'] =
            (window as unknown as Record<string, unknown>)['__sentry_test_hook'];
        }
        return event;
      },
    });
    Sentry.setTag('service', 'project-sites-frontend');
    return true;
  } catch (err) {
    console.warn('[SentryService] init failed', err);
    return false;
  }
}

/**
 * Angular-injectable wrapper around the imperative `@sentry/angular` surface.
 *
 * @remarks
 * Why a service when the SDK is global? Three reasons:
 *  1. Injection lets components/tests swap in a mock without touching globals.
 *  2. Tracks an `enabled` flag so callers don't have to re-check the DSN.
 *  3. Centralizes the "what counts as a useful breadcrumb" decisions so they
 *     evolve in one place.
 */
@Injectable({ providedIn: 'root' })
export class SentryService {
  private enabled = false;

  constructor() {
    // `initSentryEarly` runs before Angular boot, but in case it didn't (tests,
    // SSR), reflect actual SDK state by checking if a client is registered.
    this.enabled = Boolean(Sentry.getClient());
  }

  /** True when the SDK is initialized and events will be sent. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Attach the logged-in user. Call from AuthService.setSession() and on login.
   *
   * @remarks
   * Email is one-way hashed before reaching Sentry to keep PII out of the
   * error tracker while still allowing "same user across events" grouping.
   * org_id is stored as a tag for easy filtering; it is not PII.
   */
  setUser(user: SentryUser | null): void {
    if (!this.enabled) return;
    if (!user) {
      Sentry.setUser(null);
      return;
    }
    // Hash email asynchronously; set user.id immediately so the next event
    // already carries the user context.
    const sentryUser: Record<string, string> = { id: user.id };
    if (user.orgId) sentryUser['org_id'] = user.orgId;
    Sentry.setUser(sentryUser);
    if (user.orgId) Sentry.setTag('org_id', user.orgId);

    // Asynchronously update with the hashed email once the hash resolves.
    if (user.email) {
      hashString(user.email).then((hashed) => {
        Sentry.setUser({ ...sentryUser, email_hash: hashed });
      }).catch(() => {
        // Hash failure is non-fatal — user.id is already set above.
      });
    }
  }

  /** Drop a breadcrumb. Categories: `bolt`, `http`, `auth`, `nav`, `ui`, `editor`. */
  addBreadcrumb(crumb: SentryBreadcrumb): void {
    if (!this.enabled) return;
    Sentry.addBreadcrumb({
      category: crumb.category,
      message: crumb.message,
      level: crumb.level ?? 'info',
      data: crumb.data,
      timestamp: Date.now() / 1000,
    });
  }

  /** Capture a non-exception event (e.g. unexpected state, soft warnings). */
  captureMessage(message: string, level: SentryLevel = 'info'): void {
    if (!this.enabled) return;
    Sentry.captureMessage(message, level);
  }

  /** Capture an exception with optional extra context. Use for caught errors. */
  captureException(error: unknown, extra?: Record<string, unknown>): void {
    if (!this.enabled) return;
    Sentry.captureException(error, extra ? { extra } : undefined);
  }

  /** Tag for filtering events in the Sentry UI (e.g. `route`, `feature`). */
  setTag(key: string, value: string): void {
    if (!this.enabled) return;
    Sentry.setTag(key, value);
  }
}
