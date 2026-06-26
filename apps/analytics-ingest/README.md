# analytics-ingest

Cloudflare Worker that consumes the `analytics-events` CF Queue and batch-inserts events
into ClickHouse via its HTTP API.

## Architecture

```
CF Worker (any route) ──► CF Queue (analytics-events) ──► this Worker ──► ClickHouse HTTP API
                                                                └──► DLQ (analytics-events-dlq)
```

1. **Producer** — any Worker publishes typed `AnalyticsEventEnvelope` messages to the Queue.
2. **Consumer** — this Worker receives batches (up to 100 msgs, 5s timeout).
3. **Validation** — each message is Zod-parsed; invalid messages are acked + logged (not dead-lettered).
4. **Ingest** — valid rows are batched into a single `INSERT INTO events FORMAT JSONEachRow` request.
5. **Dead letter** — ClickHouse insert failures retry (CF Queue max_retries = 3), then land in the DLQ.

## AnalyticsEventEnvelope

```ts
interface AnalyticsEventEnvelope {
  // Required
  event:      string;          // e.g. "site.viewed", "conversion.completed"
  tenant_id:  string;          // org slug or orgId

  // Optional correlation ids
  site_id?:    string;
  org_id?:     string;
  user_id?:    string;
  visitor_id?: string;         // PostHog anonId
  session_id?: string;
  request_id?: string;
  trace_id?:   string;

  // Timing
  timestamp:  string;          // ISO 8601 UTC

  // Source classification
  source: 'worker' | 'frontend' | 'webhook' | 'cron' | 'api';

  // Arbitrary event properties (Zod-validated as Record<string, unknown>)
  properties?: Record<string, unknown>;
}
```

## ClickHouse table

```sql
CREATE TABLE IF NOT EXISTS events (
  event       String,
  tenant_id   String,
  site_id     Nullable(String),
  org_id      Nullable(String),
  user_id     Nullable(String),
  visitor_id  Nullable(String),
  session_id  Nullable(String),
  request_id  Nullable(String),
  trace_id    Nullable(String),
  timestamp   DateTime64(3),
  source      Enum8('worker'=1, 'frontend'=2, 'webhook'=3, 'cron'=4, 'api'=5),
  properties  String DEFAULT '{}'
) ENGINE = MergeTree()
ORDER BY (tenant_id, timestamp);
```

## Secrets

| Secret | Description |
|---|---|
| `CLICKHOUSE_URL` | `https://<host>:8443` |
| `CLICKHOUSE_USER` | ClickHouse user |
| `CLICKHOUSE_PASSWORD` | ClickHouse password |
| `CLICKHOUSE_DATABASE` | Target database name |

Set via: `wrangler secret put <KEY> --env production`

## Queue bindings (add to main wrangler.toml)

```toml
[[queues.producers]]
binding = "ANALYTICS_QUEUE"
queue = "analytics-events"

[[queues.consumers]]
queue = "analytics-events"
max_batch_size = 100
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "analytics-events-dlq"
```

## Deploy

```bash
cd apps/analytics-ingest
npm install --legacy-peer-deps
npx wrangler deploy --env production
```
