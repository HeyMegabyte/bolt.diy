/**
 * @module services/telemetry
 *
 * @description
 * Unified telemetry facade that fans every product event out to PostHog,
 * GA4 / GTM (via the `window.gtag` queue installed in `src/index.html`),
 * and Sentry breadcrumbs. One call site, three destinations — so capture
 * points stay consistent and the operator can swap providers without
 * touching call sites.
 *
 * **Bundle discipline:** `posthog-js` is imported lazily via dynamic
 * `import('posthog-js')` inside `init()` so it lands in its own webpack
 * chunk instead of the initial bundle (~150KB saved on first paint).
 * Events fired before the chunk resolves are queued (capped at 100) and
 * drained the moment PostHog reports loaded. GA4 + Sentry fire
 * synchronously regardless — telemetry destinations are decoupled so the
 * slowest one never blocks the others.
 *
 * **Event naming convention:** dot-separated `category.action.outcome`.
 *  - `category` — feature surface (`auth`, `site`, `admin`, `billing`,
 *    `snapshot`, `forms`, `endpoints`, `http`, `nav`).
 *  - `action` — what the user / system did (`signin`, `create`, `tier`,
 *    `upgrade`, `created`, `reverted`, `deployed`, `success`, `failure`).
 *  - `outcome` — terminal state where relevant (`requested`, `submitted`,
 *    `succeeded`, `failed`, `opened`, `selected`, `clicked`, `purchased`).
 *
 * **GA4 conversion mapping** — these PostHog events MUST be promoted to
 * GA4 conversions in the GA4 Admin → Events → "Mark as conversion" panel
 * after first ingestion, otherwise revenue/funnel reporting stays empty.
 *  - GA4 `signup`         ← `auth.signin.succeeded`
 *  - GA4 `purchase`       ← `billing.tier_purchased` (carries `value` + `currency`)
 *  - GA4 `generate_lead`  ← `site.create.submitted`
 * Operator note: the GA4 event names above are the spec'd reserved names —
 * we forward them verbatim via `gtag('event', name, …)` in addition to the
 * dot-named PostHog event so analytics + product tracking stay symmetric.
 *
 * Reduced-motion / privacy-friendly: every call swallows errors silently.
 * Telemetry failure NEVER surfaces a toast, breaks navigation, or pollutes
 * the console with red noise. If PostHog/gtag/Sentry aren't loaded, calls
 * no-op.
 *
 * @see {@link SentryService} — error-tracking surface (separate from
 *   product analytics; we drop breadcrumbs here but never capture events).
 */

import { Injectable, inject } from '@angular/core';
import type { PostHog, PostHogConfig } from 'posthog-js';
import { SentryService } from './sentry.service';

/** Free-form property bag attached to every captured event. */
type Props = Record<string, unknown>;

/** Minimal shape of the `gtag` global installed by `<script>` in index.html. */
type GtagFn = (
  command: 'config' | 'event' | 'set' | 'consent' | 'js',
  targetOrEventName: string | Date,
  params?: Record<string, unknown>,
) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  }
}

/** GA4 measurement id (mirrors the value hard-coded in `src/index.html`). */
const GA4_MEASUREMENT_ID = 'G-VBBRRQLDFT';

/**
 * Max queued PostHog ops while the lazy chunk resolves. Cap exists to
 * avoid runaway memory if the import 404s on a flaky network — drops
 * silently past the cap rather than holding references forever.
 */
const MAX_QUEUE = 100;

/**
 * Queued operation kinds that need PostHog. GA4 + Sentry fire
 * synchronously so they never enter the queue.
 */
type QueuedOp =
  | { kind: 'capture'; eventName: string; props?: Props }
  | { kind: 'identify'; userId: string; traits?: Props }
  | { kind: 'reset' };

/**
 * Read a meta-tag's `content`, returning null when missing / sentinel.
 * Mirrors the pattern in `SentryService` so DSN-style secrets share one
 * extraction strategy.
 */
function readMeta(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`meta[name="${name}"]`);
  if (!el) return null;
  const v = el.getAttribute('content')?.trim();
  if (!v || v === 'none' || v === '') return null;
  return v;
}

/** Safe gtag accessor — returns a no-op when the snippet hasn't loaded. */
function gtag(): GtagFn {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    return window.gtag;
  }
  return (): void => {
    /* no-op — GA4 not present (likely SSR/test) */
  };
}

/**
 * Unified telemetry facade. Singleton-scoped so PostHog initializes once
 * per browser session.
 *
 * @example
 * ```ts
 * // In AppComponent (once per session):
 * const telemetry = inject(TelemetryService);
 * telemetry.init();
 *
 * // Anywhere downstream — calls return synchronously; PostHog ops are
 * // queued + drained transparently once the lazy chunk lands.
 * telemetry.pageView('/admin/forms', 'Forms · Admin');
 * telemetry.track('auth.signin.requested', { provider: 'email' });
 * telemetry.identify(user.id, { email: user.email });
 * if (telemetry.featureFlag('new-billing-ui')) renderNewBilling();
 * telemetry.reset();
 * ```
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private sentry = inject(SentryService);
  private initialized = false;
  private enabled = false;

  /**
   * Resolves to the PostHog default export once the dynamic
   * `import('posthog-js')` lands and `.init()` returns. Null until
   * `init()` is invoked (or when no API key is wired). Consumers
   * `await` this defensively in every PostHog-touching method.
   */
  private posthogPromise: Promise<PostHog | null> | null = null;

  /**
   * Loaded PostHog handle — set inside the promise resolution. Lets
   * synchronous-ish call sites (e.g. `featureFlag`) skip the await when
   * the chunk has already landed.
   */
  private posthog: PostHog | null = null;

  /**
   * Events fired before PostHog finished loading. Drained in FIFO order
   * the moment `posthogPromise` resolves. Capped at MAX_QUEUE so a stuck
   * import doesn't balloon memory.
   */
  private queue: QueuedOp[] = [];

  /**
   * Bootstrap PostHog using the project key injected into the HTML shell
   * as `<meta name="x-posthog-key">` by the Cloudflare Worker. Safe to
   * call repeatedly — only the first invocation does work.
   *
   * The PostHog SDK loads via dynamic `import('posthog-js')` so it
   * splits into its own chunk and stays out of the initial bundle.
   * gtag config + Sentry wiring is synchronous; only the PostHog SDK is
   * deferred.
   *
   * Persistence is forced to `'memory'` so we don't need a cookie-consent
   * banner. Autocapture is left ON (PostHog's heuristics catch button +
   * link clicks the dot-named events below don't cover).
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof window === 'undefined') return;

    const apiKey = readMeta('x-posthog-key');
    if (!apiKey || apiKey === 'none') {
      // No key wired — silently disabled. Same restraint as SentryService:
      // dev refreshes shouldn't noise the console when secrets are absent.
      return;
    }
    // PostHog Project API keys start with `phc_`. Any other prefix (e.g. the
    // personal `phx_` access token) returns 401 from /flags + /e + 404 from
    // /array — disable to keep the console clean until a real project key
    // is wired via `wrangler secret put POSTHOG_API_KEY`.
    if (!apiKey.startsWith('phc_')) {
      console.warn(
        '[telemetry] PostHog disabled: x-posthog-key must start with "phc_" (Project API Key). See https://us.posthog.com/project/settings',
      );
      return;
    }

    const config: Partial<PostHogConfig> = {
      api_host: 'https://us.i.posthog.com',
      persistence: 'memory',
      autocapture: true,
      capture_pageview: false, // we fire `$pageview` ourselves via the Router
      capture_pageleave: true,
      disable_session_recording: false,
      // Cookie-free + minimal fingerprint — keeps us out of GDPR consent territory.
      disable_persistence: false,
      mask_all_text: false,
      loaded: (): void => {
        /* no-op — feature flags become readable after this fires */
      },
    };

    // Lazy-load posthog-js so it ships as its own chunk (~150KB) instead
    // of bloating the initial bundle. Every PostHog-touching method awaits
    // this defensively, so calls fired during the import window are queued.
    this.posthogPromise = import('posthog-js')
      .then((m) => {
        const ph = m.default;
        try {
          ph.init(apiKey, config);
          this.posthog = ph;
          this.enabled = true;
          this.drainQueue(ph);
          return ph;
        } catch {
          this.enabled = false;
          this.queue.length = 0;
          return null;
        }
      })
      .catch(() => {
        // Network failure / blocked by ad-blocker — telemetry stays a no-op
        // for PostHog only. GA4 + Sentry continue firing synchronously.
        this.enabled = false;
        this.queue.length = 0;
        return null;
      });
  }

  /**
   * Replay any operations queued before the SDK landed. Wrapped per-op so
   * one bad capture call doesn't poison the rest of the drain.
   */
  private drainQueue(ph: PostHog): void {
    const pending = this.queue;
    this.queue = [];
    for (const op of pending) {
      try {
        if (op.kind === 'capture') {
          ph.capture(op.eventName, op.props);
        } else if (op.kind === 'identify') {
          ph.identify(op.userId, op.traits);
        } else if (op.kind === 'reset') {
          ph.reset();
        }
      } catch {
        /* swallow — never let telemetry crash */
      }
    }
  }

  /**
   * Push an op onto the pre-load queue, dropping silently past MAX_QUEUE.
   * Returns true when queued, false when the cap rejected it (caller can
   * treat both as fire-and-forget — telemetry never reports back).
   */
  private enqueue(op: QueuedOp): boolean {
    if (this.queue.length >= MAX_QUEUE) return false;
    this.queue.push(op);
    return true;
  }

  /**
   * Fire a `$pageview` to PostHog, a `page_view` GA4 event, and drop a
   * `nav` breadcrumb. Call from `Router.events` on `NavigationEnd`.
   *
   * PostHog half is queued if the SDK is still loading (typical first
   * paint races the import). GA4 + Sentry fire synchronously regardless.
   */
  pageView(url: string, title?: string): void {
    if (typeof window === 'undefined') return;

    // PostHog — fire now if loaded, queue otherwise.
    try {
      if (this.posthog) {
        this.posthog.capture('$pageview', {
          $current_url: url,
          $title: title,
        });
      } else if (this.posthogPromise) {
        this.enqueue({
          kind: 'capture',
          eventName: '$pageview',
          props: { $current_url: url, $title: title },
        });
      }
    } catch {
      /* swallow — never let telemetry break navigation */
    }

    // GA4 — `page_view` is a GA4-reserved event name; gtag handles
    // dataLayer pushes via the snippet in index.html.
    try {
      gtag()('event', 'page_view', {
        page_path: url,
        page_title: title,
        send_to: GA4_MEASUREMENT_ID,
      });
    } catch {
      /* swallow */
    }

    // Sentry breadcrumb (defensive — service no-ops when SDK not booted).
    try {
      this.sentry.addBreadcrumb({
        category: 'nav',
        message: `Pageview ${url}`,
        level: 'info',
        data: { url, title },
      });
    } catch {
      /* swallow */
    }
  }

  /**
   * Track a product event. Forwards to PostHog (dot-named), GA4 (with
   * dots collapsed to underscores per the GA4 event-name spec), and
   * Sentry breadcrumbs (one breadcrumb per call so error reports carry
   * the trail of user actions).
   *
   * Conversion-marker mapping (also fired as GA4-reserved names):
   *  - `auth.signin.succeeded`   → also fires GA4 `signup`
   *  - `billing.tier_purchased`  → also fires GA4 `purchase`
   *  - `site.create.submitted`   → also fires GA4 `generate_lead`
   */
  track(eventName: string, props?: Props): void {
    if (typeof window === 'undefined') return;

    // PostHog — keep the dot-named event verbatim. Their UI groups by
    // category prefix automatically (`auth.*`, `site.*`, `billing.*`).
    // Fire now if loaded, queue if the lazy chunk is still in flight.
    try {
      if (this.posthog) {
        this.posthog.capture(eventName, props);
      } else if (this.posthogPromise) {
        this.enqueue({ kind: 'capture', eventName, props });
      }
    } catch {
      /* swallow */
    }

    // GA4 — event names must match /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, so
    // collapse dots to underscores. Original dot-name kept in
    // `event_name_full` for debugging in DebugView.
    try {
      const ga4Name = eventName.replace(/\./g, '_').slice(0, 40);
      gtag()('event', ga4Name, {
        ...props,
        event_name_full: eventName,
        send_to: GA4_MEASUREMENT_ID,
      });
    } catch {
      /* swallow */
    }

    // GA4 conversion aliases — fire alongside the dot-named event so the
    // Conversions panel populates without us renaming product events.
    try {
      const g = gtag();
      if (eventName === 'auth.signin.succeeded') {
        g('event', 'signup', { ...props, send_to: GA4_MEASUREMENT_ID });
      } else if (eventName === 'billing.tier_purchased') {
        // GA4 purchase wants { value, currency } at the top level.
        g('event', 'purchase', {
          value: (props?.['value'] as number | undefined) ?? 0,
          currency: (props?.['currency'] as string | undefined) ?? 'USD',
          transaction_id: props?.['transaction_id'] ?? props?.['bundle'],
          ...props,
          send_to: GA4_MEASUREMENT_ID,
        });
      } else if (eventName === 'site.create.submitted') {
        g('event', 'generate_lead', { ...props, send_to: GA4_MEASUREMENT_ID });
      }
    } catch {
      /* swallow */
    }

    // Sentry breadcrumb — categorize by the first dot-segment so the
    // Sentry UI groups them in the error timeline.
    try {
      const category = eventName.split('.', 1)[0] ?? 'event';
      this.sentry.addBreadcrumb({
        category,
        message: eventName,
        level: 'info',
        data: props,
      });
    } catch {
      /* swallow */
    }
  }

  /**
   * Attach user identity. Call once after login resolves a real user id.
   * PostHog merges anonymous→identified profiles; GA4 ties events to the
   * `user_id` dimension; Sentry is handled by `SentryService.setUser`
   * elsewhere in the auth flow (don't double-attach here).
   */
  identify(userId: string, traits?: Props): void {
    if (typeof window === 'undefined' || !userId) return;

    try {
      if (this.posthog) {
        this.posthog.identify(userId, traits);
      } else if (this.posthogPromise) {
        this.enqueue({ kind: 'identify', userId, traits });
      }
    } catch {
      /* swallow */
    }

    try {
      gtag()('config', GA4_MEASUREMENT_ID, { user_id: userId });
      if (traits) {
        gtag()('set', 'user_properties', traits);
      }
    } catch {
      /* swallow */
    }
  }

  /**
   * Synchronous feature-flag read. Returns `defaultValue` until PostHog
   * finishes loading flags (the lazy chunk download + the few hundred ms
   * after `init` for flag bootstrap) — callers should NOT block on this.
   *
   * `send_event: false` keeps flag reads out of the event volume — we don't
   * need a `$feature_flag_called` row for every render.
   */
  featureFlag(key: string, defaultValue = false): boolean {
    if (!this.posthog || !this.enabled) return defaultValue;
    try {
      const value = this.posthog.isFeatureEnabled(key, { send_event: false });
      return typeof value === 'boolean' ? value : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  /**
   * Clear identity on sign-out. Wipes the PostHog distinct_id, clears the
   * GA4 user_id, and drops a breadcrumb so the error timeline captures
   * the transition. If PostHog is still loading, queues the reset so it
   * fires in order relative to any prior identify().
   */
  reset(): void {
    try {
      if (this.posthog) {
        this.posthog.reset();
      } else if (this.posthogPromise) {
        this.enqueue({ kind: 'reset' });
      }
    } catch {
      /* swallow */
    }
    try {
      gtag()('config', GA4_MEASUREMENT_ID, { user_id: undefined });
    } catch {
      /* swallow */
    }
    try {
      this.sentry.addBreadcrumb({
        category: 'auth',
        message: 'telemetry.reset',
        level: 'info',
      });
    } catch {
      /* swallow */
    }
  }
}
