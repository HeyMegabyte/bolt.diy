# Observability Module

Three-layer observability for the Project Sites Worker:

- **Axiom** — structured log ingest (fire-and-forget, guarded by `AXIOM_ENABLED`)
- **PostHog** — product analytics facade (wraps `../lib/posthog.ts`)
- **OTel** — W3C traceparent correlation helpers

Sentry is **not replaced** — this module adds a new layer alongside existing Sentry.

## Quick start

```ts
import {
  createLogger,
  createAnalytics,
  withTraceContext,
} from './observability/index.js';

// In a Hono middleware:
app.use('*', async (c, next) => {
  const base = withTraceContext(c.req.raw.headers, {
    service: 'api',
    environment: c.env.ENVIRONMENT ?? 'production',
    request_id: c.get('requestId'),
  });

  const log       = createLogger(c.env, c.executionCtx, base);
  const analytics = createAnalytics(c.env, c.executionCtx);

  c.set('log', log);
  c.set('analytics', analytics);
  await next();
});

// In a route handler:
log.info('Site created', { site_id: site.id, org_id: org.id });
log.error('Workflow failed', { workflow_id: wf.id }, err);

await analytics.capture('site.published', {
  distinct_id: user.id,
  site_id: site.id,
  plan: billing.plan,
});
```

## Environment variables

| Variable         | Required for Axiom | Description |
|------------------|--------------------|-------------|
| `AXIOM_TOKEN`    | Yes                | Axiom ingest bearer token (`xaat-*`). Set as `wrangler secret`. |
| `AXIOM_DATASET`  | No                 | Axiom dataset name (default: `'projectsites'`). Set as `wrangler var`. |
| `AXIOM_ENABLED`  | No                 | Set to `'true'` to enable Axiom ingest (default: off). Set as `wrangler var`. |
| `LOGS_PUBLIC_URL`| No                 | Public URL for the log exploration UI (e.g. Axiom or Grafana). Exposed to admin. |

Axiom ingest is **off by default** — set `AXIOM_ENABLED=true` to activate.

## Files

| File | Purpose |
|------|---------|
| `context.ts` | `AppLogContext` interface + `redactSecrets()` |
| `axiom.ts` | `sendToAxiom()` fire-and-forget ingest |
| `logger.ts` | `AppLogger` interface + `createLogger()` |
| `analytics.ts` | `ProductAnalytics` interface + `createAnalytics()` |
| `otel.ts` | `withTraceContext()` + `traceparentFor()` |
| `index.ts` | Barrel re-export |
| `__tests__/` | Jest unit tests |
