/**
 * Sentry release tracking shim for bolt.diy (item 49).
 *
 * Tags every captured event with the deploy SHA so errors can be triaged
 * per-release in the Sentry UI. `VITE_BUILD_SHA` is injected by
 * `vite.config.ts` via `define:` — see the same file for the wiring.
 *
 * Sentry isn't yet a hard dependency of bolt.diy (the main app ships
 * without an error-reporting SDK). This module exposes a minimal
 * surface so the rest of the app can call `initSentry()` once and
 * `captureException()` everywhere without worrying about whether the
 * SDK is actually loaded — when it isn't, calls become no-ops.
 *
 * When @sentry/remix (or @sentry/browser) is added to dependencies,
 * drop the dynamic import here and replace the no-op stubs with the
 * real SDK calls. The function signatures stay identical so call-sites
 * never change.
 *
 * @module lib/sentry
 */

/**
 * Deploy SHA injected at build time by `vite.config.ts`:
 *
 * ```ts
 * define: { 'import.meta.env.VITE_BUILD_SHA': JSON.stringify(process.env.GITHUB_SHA || 'dev') }
 * ```
 *
 * Falls back to `'dev'` so local dev never sends `undefined` as a release.
 */
export const BUILD_SHA: string =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_BUILD_SHA?: string } }).env?.VITE_BUILD_SHA) ||
  'dev';

interface SentryLike {
  init: (config: Record<string, unknown>) => void;
  captureException: (err: unknown, ctx?: Record<string, unknown>) => void;
  captureMessage: (msg: string, ctx?: Record<string, unknown>) => void;
}

let sentry: SentryLike | null = null;

/**
 * Initialize Sentry with the build SHA as the release tag. Safe to call
 * more than once — subsequent calls are no-ops. If `@sentry/remix` (or
 * `@sentry/browser`) isn't installed, this resolves silently so the rest
 * of the app keeps working without the SDK.
 *
 * @param dsn - Sentry DSN. Pass `undefined` to disable error reporting
 *   (useful in local dev or for opt-out environments).
 */
export async function initSentry(dsn?: string): Promise<void> {
  if (sentry || !dsn || typeof window === 'undefined') {
    return;
  }

  try {
    /*
     * Dynamic import so missing @sentry/remix doesn't break the build.
     * String-built specifier prevents Vite from statically resolving the
     * missing module at build time.
     */
    const specifier = ['@sentry', 'remix'].join('/');
    const mod = (await import(/* @vite-ignore */ specifier).catch(() => null)) as SentryLike | null;

    if (!mod) {
      console.warn('[sentry] @sentry/remix not installed; release tracking disabled');
      return;
    }

    sentry = mod;
    sentry.init({
      dsn,
      release: BUILD_SHA,
      environment: import.meta.env?.MODE ?? 'production',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
    });
  } catch (err) {
    console.warn('[sentry] init failed', err);
  }
}

/** Capture an exception with release tag attached. No-op when SDK missing. */
export function captureException(err: unknown, ctx: Record<string, unknown> = {}): void {
  if (!sentry) {
    return;
  }

  sentry.captureException(err, { tags: { release: BUILD_SHA, ...ctx } });
}

/** Capture a structured message. No-op when SDK missing. */
export function captureMessage(msg: string, ctx: Record<string, unknown> = {}): void {
  if (!sentry) {
    return;
  }

  sentry.captureMessage(msg, { tags: { release: BUILD_SHA, ...ctx } });
}
