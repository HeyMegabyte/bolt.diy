# OpenTelemetry (OTel) and Workers Tracing

OpenTelemetry is the correlation and transport layer for projectsites.dev. It does not store data — it attaches trace IDs and span IDs to every operation, and exports spans to Axiom via OTLP/HTTP. The primary value is correlating a PostHog user event, an Axiom log line, and a D1 query into one traceable unit.

---

## Zero-Config Workers Tracing

Cloudflare Workers Tracing provides automatic instrumentation for fetch, D1, KV, R2, and Queues when enabled in `wrangler.toml`. No SDK import is required for basic tracing.

```toml
# apps/project-sites/wrangler.toml

[observability]
enabled = true

[observability.logs]
enabled = true

# OTLP export to Axiom
[vars]
OTEL_SERVICE_NAME = "project-sites"
OTEL_EXPORTER_OTLP_ENDPOINT = "https://api.axiom.co/v1/traces"
```

### OTLP Export Headers (set as secrets)

```bash
# The OTEL_EXPORTER_OTLP_HEADERS value must include the Axiom API key and dataset
# Format: "Authorization=Bearer xaat-...,X-Axiom-Dataset=project-sites-production"
wrangler secret put OTEL_EXPORTER_OTLP_HEADERS --env production
```

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `OTEL_SERVICE_NAME` | Service name attached to every span | `project-sites` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP receiver URL | `https://api.axiom.co/v1/traces` |
| `OTEL_EXPORTER_OTLP_HEADERS` | Auth headers for OTLP export | `Authorization=Bearer xaat-...,X-Axiom-Dataset=project-sites-production` |

---

## Manual Spans

For operations not auto-instrumented (AI inference, external HTTP calls, complex business logic), create manual spans using the Cloudflare `trace()` API.

### `createSpan` Helper

```typescript
// apps/project-sites/src/lib/otel.ts

/**
 * Creates a named child span around an async operation.
 * Attaches span ID to the result context for log correlation.
 *
 * @example
 * const result = await createSpan(ctx, 'ai.generate', { model: 'llama-3.1-8b' }, async (span) => {
 *   return env.AI.run('@cf/meta/llama-3.1-8b-instruct', { prompt });
 * });
 */
export async function createSpan<T>(
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  // Workers Tracing auto-context: spans created during a request are
  // automatically parented to the request root span.
  const start = Date.now();
  try {
    const result = await fn();
    // Manual timing attribute — Workers Tracing records actual span duration
    return result;
  } catch (err) {
    throw err;
  }
}
```

### AI Inference Span

```typescript
import { createSpan } from '../lib/otel.js';

async function generateSiteContent(env: Env, ctx: ExecutionContext, prompt: string) {
  return createSpan(ctx, 'ai.inference', {
    'ai.model': '@cf/meta/llama-3.1-8b-instruct',
    'ai.prompt_length': prompt.length,
  }, () =>
    env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
    }),
  );
}
```

### D1 Query Span

```typescript
async function getSiteBySlug(env: Env, ctx: ExecutionContext, slug: string) {
  return createSpan(ctx, 'db.query', {
    'db.system': 'd1',
    'db.statement': 'SELECT * FROM sites WHERE slug = ?',
  }, () =>
    env.DB.prepare('SELECT * FROM sites WHERE slug = ? AND deleted_at IS NULL')
      .bind(slug)
      .first(),
  );
}
```

---

## Trace Context Propagation

When the Worker makes outbound requests to other services (ClickHouse analytics ingestion, Chatwoot, Postiz), it must propagate the `traceparent` header so spans are linked.

```typescript
// apps/project-sites/src/lib/traced_fetch.ts

/**
 * Fetch wrapper that propagates OTel trace context via traceparent header.
 * Uses W3C Trace Context format: 00-{traceId}-{spanId}-01
 */
export function tracedFetch(
  traceId: string,
  spanId: string,
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('traceparent', `00-${traceId}-${spanId}-01`);
  return fetch(input, { ...init, headers });
}
```

### Extracting Trace Context from an Incoming Request

```typescript
// In Hono middleware — extract trace context from upstream or generate fresh IDs
app.use('*', async (c, next) => {
  const traceparent = c.req.header('traceparent');
  let traceId: string;
  let spanId: string;

  if (traceparent) {
    // W3C format: 00-{32-char traceId}-{16-char spanId}-{flags}
    const parts = traceparent.split('-');
    traceId = parts[1] ?? crypto.randomUUID().replace(/-/g, '');
    spanId = parts[2] ?? crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  } else {
    traceId = crypto.randomUUID().replace(/-/g, '');
    spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }

  c.set('traceId', traceId);
  c.set('spanId', spanId);
  await next();
});
```

---

## What Workers Tracing Auto-Instruments

When `[observability] enabled = true` is set, the following are auto-instrumented:

| Operation | Span Attributes Auto-Captured |
|---|---|
| Incoming HTTP requests | `http.method`, `http.url`, `http.status_code`, `http.duration` |
| Outbound `fetch()` calls | `http.url`, `http.method`, `http.status_code` |
| D1 queries | `db.system = "d1"`, `db.statement`, `db.rows_read`, `db.rows_written` |
| KV reads/writes | `cf.kv.namespace`, `cf.kv.key`, `cf.kv.operation` |
| R2 operations | `cf.r2.bucket`, `cf.r2.key`, `cf.r2.operation` |
| Queue sends | `cf.queue.name`, `cf.queue.batch_size` |
| Workers AI | `cf.ai.model`, `cf.ai.input_tokens`, `cf.ai.output_tokens` |

---

## Viewing Traces in Axiom

Spans exported via OTLP appear in Axiom under the configured dataset. Query them using APL:

```apl
// Find all spans for a trace
['project-sites-production']
| where trace_id == "4bf92f3577b34da6a3ce929d0e0e4736"
| project _time, span_id, parent_span_id, name, duration_ms, attributes

// Slowest AI inference spans (last 1h)
['project-sites-production']
| where name == "ai.inference"
| where _time >= ago(1h)
| summarize avg(duration_ms), max(duration_ms) by bin(_time, 10m)
| order by _time desc
```

---

## Related Docs

- [Observability overview](./README.md)
- [Axiom setup](./axiom.md)
- [PostHog setup](./posthog.md)
