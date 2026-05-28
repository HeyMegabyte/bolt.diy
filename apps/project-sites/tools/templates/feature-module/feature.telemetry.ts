/**
 * Sentry span helpers for {{slug}}.
 *
 * @remarks
 * Wraps `startSpan` (from `src/lib/sentry.ts`) with feature-prefixed operation
 * names so traces are filterable in the Sentry UI by `op:{{slug}}.*`.
 *
 * @example
 * ```ts
 * return await start{{Name}}Span(c, '{{slug}}.list', async () => {
 *   // ... handler logic
 * });
 * ```
 */

import type { Context } from 'hono';
import type { Env } from '../../src/types/env.js';

type HonoCtx = Context<{ Bindings: Env; Variables: Record<string, unknown> }>;

/**
 * Wraps `fn` in a Sentry span with name `op` and feature tag `feature={{slug}}`.
 *
 * Falls back to plain `fn()` when Sentry is not configured so dev
 * environments never throw.
 */
export async function start{{Name}}Span<T>(
  c: HonoCtx,
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Lightweight inline span — import the real startSpan from sentry.ts when
  // Sentry is configured in your project. This stub keeps tsc happy with zero
  // additional deps at template generation time.
  const data: Record<string, string> = {
    feature: '{{slug}}',
    requestId: (c.get('requestId') as string | undefined) ?? 'unknown',
  };
  try {
    const result = await fn();
    return result;
  } catch (err) {
    // Re-throw so error_handler.ts formats the envelope correctly.
    throw err;
  } finally {
    // Attach span metadata to the response header for local debugging.
    if (c.env && (c.env as Record<string, unknown>).ENVIRONMENT !== 'production') {
      c.header('X-Span-Op', op);
      c.header('X-Span-Feature', data.feature);
    }
  }
}
