/**
 * Observability module barrel.
 *
 * Three-layer observability for the Project Sites Worker:
 * - **Axiom** — structured log ingest (fire-and-forget, guarded by `AXIOM_ENABLED`)
 * - **PostHog** — product analytics facade (wraps `../lib/posthog.ts`)
 * - **OTel** — W3C traceparent correlation helpers
 *
 * Import from this module, not from individual sub-files.
 *
 * @example
 * ```ts
 * import { createLogger, createAnalytics, withTraceContext } from './observability/index.js';
 *
 * app.use('*', async (c, next) => {
 *   const base = withTraceContext(c.req.raw.headers, {
 *     service: 'api',
 *     environment: c.env.ENVIRONMENT ?? 'production',
 *     request_id: c.get('requestId'),
 *   });
 *   const log       = createLogger(c.env, c.executionCtx, base);
 *   const analytics = createAnalytics(c.env, c.executionCtx);
 *   c.set('log', log);
 *   c.set('analytics', analytics);
 *   await next();
 * });
 * ```
 *
 * @module observability
 */

export type { AppLogContext } from './context.js';
export { redactSecrets } from './context.js';

export { sendToAxiom } from './axiom.js';

export type { AppLogger, LogLevel } from './logger.js';
export { createLogger } from './logger.js';

export type { ProductAnalytics } from './analytics.js';
export { createAnalytics } from './analytics.js';

export { withTraceContext, traceparentFor } from './otel.js';
