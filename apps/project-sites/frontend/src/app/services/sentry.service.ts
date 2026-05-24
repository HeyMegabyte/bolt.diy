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

  /** Attach the logged-in user. Call from AuthService.setSession() and on login. */
  setUser(user: SentryUser | null): void {
    if (!this.enabled) return;
    if (!user) {
      Sentry.setUser(null);
      return;
    }
    Sentry.setUser({
      id: user.id,
      email: user.email,
      // `orgId` is a custom tag — also surface as a contextual field for filtering.
      org_id: user.orgId,
    });
    if (user.orgId) Sentry.setTag('org_id', user.orgId);
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
