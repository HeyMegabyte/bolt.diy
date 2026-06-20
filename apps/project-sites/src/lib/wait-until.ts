/**
 * @module lib/wait-until
 * @description ExecutionContext-safe `waitUntil` for background work.
 *
 * `c.executionCtx` is a Hono getter that THROWS when there is no
 * ExecutionContext — i.e. outside a normal fetch handler (internal
 * service-binding calls, queue/scheduled handlers, unit tests). Calling
 * `c.executionCtx.waitUntil(...)` unguarded in code that can run in those
 * contexts crashes the request before it completes. This was a recurring
 * footgun (fixed inline in auth middleware + 3× in the Stripe webhook handler);
 * centralizing it here means new callers can't reintroduce the crash.
 *
 * @packageDocumentation
 */
import type { Context } from 'hono';

/**
 * Schedule fire-and-forget background `work` via `c.executionCtx.waitUntil`,
 * tolerating a missing ExecutionContext.
 *
 * @remarks
 * When a ctx exists, the work extends the request's lifetime (the Worker stays
 * alive until it settles). When it doesn't, the promise is simply left to settle
 * on its own — we can't extend a lifetime that isn't there, but we never throw.
 * `work` MUST already swallow its own errors: this helper never awaits it, so a
 * rejection would otherwise become an unhandled promise rejection.
 *
 * @param c - The Hono context (only `executionCtx` is read).
 * @param work - The already-error-swallowed background promise.
 * @example
 * safeWaitUntil(c, db.prepare('UPDATE …').run().catch(() => undefined));
 */
export function safeWaitUntil(c: Context, work: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No ExecutionContext (internal/test invocation) — let `work` settle on its
    // own; it must already be error-swallowed. Never throw from here.
    void work;
  }
}
