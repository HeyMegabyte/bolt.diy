# Observability Stack

## Tool Comparison

| Tool | Role | Where | Ingestion Endpoint | When to Use | NOT For |
|---|---|---|---|---|---|
| PostHog Cloud | Product analytics, feature flags, session recording, error capture | us.i.posthog.com | `https://us.i.posthog.com/capture` | User behavior funnels, conversion tracking, feature flag evaluation, front-end errors | High-volume structured logs, infrastructure metrics |
| Axiom | Primary structured log store | logs.projectsites.dev (Axiom Play UI) | `https://api.axiom.co/v1/datasets/{dataset}/ingest` | Every request/response log, background job logs, correlation traces, tailing in real time | Product event funnels, user identity analytics |
| OpenTelemetry (OTel) | Correlation and transport layer | Workers runtime → Axiom | OTLP/HTTP to Axiom OTLP endpoint | Attaching trace IDs and span IDs to every log line and event, AI call spans, D1 query spans | Storage — OTel is transport only, not a store |
| ClickHouse (Fly.io) | High-volume analytics warehouse | Single-node Fly.io VM | HTTP API on port 8123 | page_views, events, site_builds at scale; tenant export/delete; raw analytics queries | Transactional writes, user auth state |
| Tinybird | Managed ClickHouse alternative (documented promotion path) | Tinybird Cloud | Tinybird Ingest API | When zero-ops, global replication, or instant REST endpoints are needed over self-managed ClickHouse | N/A — promotion path from Fly ClickHouse |
| Sentry | Exception tracking | `@sentry/cloudflare` (Worker) | Sentry DSN ingest | Unhandled exceptions, error grouping, release tracking (`SENTRY_RELEASE`); focus on exceptions while Workers Tracing handles I/O spans | High-volume request logs, product funnels |

---

## How They Connect

Every HTTP request entering the Cloudflare Worker generates a **trace ID** via OpenTelemetry. That trace ID propagates through the entire call chain and appears in both the Axiom log entry and the PostHog event, making it possible to correlate a user action (PostHog) with the exact log lines (Axiom) that produced it.

### Trace ID Flow

```
Browser / Client
    |
    | HTTP request
    v
CF Worker (Hono)
    |-- OTel: generate traceId + spanId (Workers Tracing auto-instrumentation)
    |-- Axiom middleware: log {traceId, spanId, tenantId, requestId, ...}
    |-- PostHog server-side capture: {$distinct_id, traceId, event, ...}
    |
    |-- D1 query --> OTel child span (db.query)
    |-- Workers AI call --> OTel child span (ai.inference)
    |-- R2 operation --> OTel child span (r2.put / r2.get)
    |
    v
OTel Exporter (OTLP/HTTP)
    |
    +-----> Axiom (spans + logs, queryable by traceId)
    |
    +-----> PostHog (events carry traceId as property)
```

### Correlating a User Event to Logs

1. Find the PostHog event for `site.generated` with `distinct_id = user_123`.
2. Copy the `traceId` property from that event.
3. In Axiom Play (logs.projectsites.dev), run:
   ```
   ['project-sites-production'] | where trace_id == "abc123..."
   ```
4. All log lines for that request appear, ordered by timestamp, with full span context.

---

## Environment Variables Summary

| Variable | Used By | Required |
|---|---|---|
| `POSTHOG_API_KEY` | Server-side capture | Yes |
| `POSTHOG_PUBLIC_KEY` | Front-end snippet | Yes |
| `POSTHOG_HOST` | Both | Yes (`https://us.i.posthog.com`) |
| `AXIOM_API_KEY` | Hono middleware | Yes |
| `AXIOM_DATASET` | Hono middleware | Yes |
| `AXIOM_ORG_ID` | Axiom SDK | Yes |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Workers Tracing | Yes |
| `OTEL_EXPORTER_OTLP_HEADERS` | Workers Tracing | Yes |
| `OTEL_SERVICE_NAME` | Workers Tracing | Yes (`project-sites`) |
| `CLICKHOUSE_HOST` | Analytics ingestion Worker | Yes |
| `CLICKHOUSE_DATABASE` | Analytics ingestion Worker | Yes |
| `CLICKHOUSE_USERNAME` | Analytics ingestion Worker | Yes |
| `CLICKHOUSE_PASSWORD` | Analytics ingestion Worker | Yes |

---

## Related Docs

- [PostHog setup](./posthog.md)
- [Axiom setup](./axiom.md)
- [OTel / Workers Tracing](./otel.md)
- [ClickHouse warehouse](../analytics/clickhouse.md)
- [Analytics ingestion pipeline](../analytics/ingestion.md)
