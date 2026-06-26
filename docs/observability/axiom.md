# Axiom

Axiom is the primary structured log store for projectsites.dev. All Worker request/response logs, background job traces, and operational events are written to Axiom. The Axiom Play UI is accessible at **logs.projectsites.dev** (behind CF Access).

---

## Configuration

### Environment Variables

| Variable | Description | Example |
|---|---|---|
| `AXIOM_API_KEY` | API key for ingest and query | `xaat-...` |
| `AXIOM_DATASET` | Target dataset name | `project-sites-production` |
| `AXIOM_ORG_ID` | Organization ID (required for Axiom SDK) | `megabyte-labs-abc123` |

### wrangler.toml

```toml
[vars]
AXIOM_DATASET = "project-sites-production"

# Secrets set via wrangler secret put:
# AXIOM_API_KEY
# AXIOM_ORG_ID
```

---

## Ingest Endpoint

Axiom receives log events via HTTP POST. There is no Axiom SDK used in the Worker — use raw `fetch` to keep the bundle lean.

```
POST https://api.axiom.co/v1/datasets/{AXIOM_DATASET}/ingest
Authorization: Bearer {AXIOM_API_KEY}
Content-Type: application/json

[{ ...logLine }, { ...logLine }]
```

The body is a JSON array of objects. Axiom auto-detects fields; no schema registration is required.

---

## Log Schema

Every log line must include these fields. Additional context fields are welcome.

| Field | Type | Description |
|---|---|---|
| `_time` | ISO 8601 string | Event timestamp (Axiom's canonical time field) |
| `level` | `info` \| `warn` \| `error` \| `debug` | Log severity |
| `service` | string | Always `project-sites` |
| `env` | string | `production` \| `preview` \| `development` |
| `message` | string | Human-readable description |
| `trace_id` | string | OTel trace ID (from `traceparent` header or generated) |
| `span_id` | string | OTel span ID |
| `request_id` | string | Per-request UUID (also returned in `X-Request-Id` header) |
| `tenant_id` | string \| `null` | Tenant UUID (null for unauthenticated requests) |
| `user_id` | string \| `null` | User UUID (null for unauthenticated) |
| `method` | string | HTTP method |
| `path` | string | Request path (no query string) |
| `status` | number | HTTP response status code |
| `duration_ms` | number | Request processing time in milliseconds |
| `cf_ray` | string | Cloudflare Ray ID from `CF-Ray` header |
| `service_version` | string | Worker version from `env.CF_VERSION_METADATA.id` |

### Optional Context Fields

| Field | Type | When to Include |
|---|---|---|
| `site_id` | string | Any request touching a specific site |
| `workflow_id` | string | Background workflow runs |
| `ai_model` | string | AI inference calls |
| `ai_tokens_in` | number | Prompt token count |
| `ai_tokens_out` | number | Completion token count |
| `error_code` | string | Taxonomy error code (e.g. `VALIDATION_FAILED`) |
| `error_type` | string | Error class name |
| `cache_hit` | boolean | Cache resolution on site serve |

---

## Hono Request Logging Middleware

Add this middleware early in the Hono app, after the request ID middleware but before route handlers.

```typescript
// apps/project-sites/src/middleware/axiom_logger.ts

import type { Context, Next } from 'hono';

interface AxiomLogLine {
  _time: string;
  level: string;
  service: string;
  env: string;
  message: string;
  trace_id: string;
  span_id: string;
  request_id: string;
  tenant_id: string | null;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  cf_ray: string;
  service_version: string;
  [key: string]: unknown;
}

export async function axiomLogger(c: Context, next: Next): Promise<void> {
  const start = Date.now();
  await next();

  const line: AxiomLogLine = {
    _time: new Date().toISOString(),
    level: c.res.status >= 500 ? 'error' : c.res.status >= 400 ? 'warn' : 'info',
    service: 'project-sites',
    env: c.env.ENVIRONMENT ?? 'production',
    message: `${c.req.method} ${new URL(c.req.url).pathname} ${c.res.status}`,
    trace_id: c.get('traceId') ?? '',
    span_id: c.get('spanId') ?? '',
    request_id: c.get('requestId') ?? '',
    tenant_id: c.get('tenantId') ?? null,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    duration_ms: Date.now() - start,
    cf_ray: c.req.header('CF-Ray') ?? '',
    service_version: (c.env.CF_VERSION_METADATA as { id?: string })?.id ?? 'unknown',
  };

  // Fire-and-forget — never block the response
  c.executionCtx.waitUntil(
    fetch(
      `https://api.axiom.co/v1/datasets/${c.env.AXIOM_DATASET}/ingest`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${c.env.AXIOM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([line]),
      },
    ).catch((err) => {
      console.warn('[axiom] ingest failed', String(err));
    }),
  );
}
```

### Register in `src/index.ts`

```typescript
import { axiomLogger } from './middleware/axiom_logger.js';

app.use('*', axiomLogger);
```

---

## Axiom Play (Real-Time Tail)

Axiom Play provides a streaming tail of log events at `logs.projectsites.dev`. Access is gated behind Cloudflare Access.

### Useful APL Queries

```apl
// All errors in the last hour
['project-sites-production']
| where level == "error"
| where _time >= ago(1h)
| project _time, message, trace_id, tenant_id, path, error_code

// Trace a specific request end-to-end
['project-sites-production']
| where trace_id == "4bf92f3577b34da6a3ce929d0e0e4736"
| order by _time asc

// Slow requests (>2000ms)
['project-sites-production']
| where duration_ms > 2000
| summarize count() by bin(_time, 5m), path
| order by _time desc

// Error rate by path (last 24h)
['project-sites-production']
| where _time >= ago(24h)
| summarize errors = countif(status >= 500), total = count() by path
| extend error_rate = round(errors * 100.0 / total, 2)
| order by error_rate desc
```

---

## Retention Policy

| Environment | Retention |
|---|---|
| `production` | 30 days (Axiom Cloud default; extendable on paid plan) |
| `preview` | 7 days |
| `development` | 3 days |

Axiom does not bill for query — only ingest. Retention should be balanced against ingest volume.

---

## Related Docs

- [Observability overview](./README.md)
- [OTel / Workers Tracing](./otel.md)
- [PostHog setup](./posthog.md)
