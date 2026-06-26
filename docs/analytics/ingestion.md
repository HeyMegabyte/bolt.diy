# Analytics Ingestion Pipeline

The analytics ingestion pipeline is a Cloudflare Worker queue consumer that validates incoming analytics events, writes them to ClickHouse, and falls back to PostHog on ClickHouse failure. Events are enqueued by the main Worker rather than written directly to ClickHouse to avoid blocking site-serving requests.

---

## Architecture

```
Main Worker (site serve, API)
    |
    | CF Queue: enqueue(AnalyticsEventEnvelope)
    v
Analytics Queue Consumer Worker
    |
    |-- validate(AnalyticsEventEnvelope) via Zod
    |-- write to ClickHouse HTTP API
    |       (on failure →)
    |-- fallback: PostHog server-side capture
    |-- on repeated failure: Dead-Letter Queue (DLQ)
    v
ClickHouse (primary) + PostHog (fallback)
```

---

## Event Envelope Schema

All analytics events must conform to `AnalyticsEventEnvelope`. Events that fail Zod validation are logged and discarded (not retried) to prevent DLQ poisoning.

```typescript
// packages/shared/src/schemas/analytics.ts

import { z } from 'zod';

export const AnalyticsEventEnvelopeSchema = z.object({
  /** Canonical event name. Snake_case. Examples: page.viewed, site.generated */
  event_type: z.string().min(1).max(64).regex(/^[a-z][a-z0-9._]+$/),

  /** Tenant UUID — required on every event. Never null. */
  tenant_id: z.string().uuid(),

  /** Site UUID — null for account-level events (e.g. user.signup) */
  site_id: z.string().uuid().nullable().default(null),

  /** Authenticated user UUID — null for anonymous visitors */
  user_id: z.string().uuid().nullable().default(null),

  /** Anonymous visitor session identifier (hashed, non-PII) */
  session_id: z.string().min(8).max(128),

  /** Event occurrence time in ISO 8601 UTC */
  occurred_at: z.string().datetime(),

  /** Arbitrary event properties — must not contain PII (use user_id/tenant_id for identity) */
  properties: z.record(z.string(), z.unknown()).default({}),
});

export type AnalyticsEventEnvelope = z.infer<typeof AnalyticsEventEnvelopeSchema>;
```

---

## Queue Consumer Worker

### wrangler.toml (Analytics Worker)

```toml
# apps/analytics-ingestion/wrangler.toml
name = "project-sites-analytics-ingestion"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[queues.consumers]]
  queue = "project-sites-analytics"
  max_batch_size = 100
  max_batch_timeout = 5
  max_retries = 3
  dead_letter_queue = "project-sites-analytics-dlq"

[vars]
  ENVIRONMENT = "production"
  CLICKHOUSE_DATABASE = "projectsites"
  CLICKHOUSE_PORT = "8123"

# Secrets: CLICKHOUSE_HOST, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD,
#          POSTHOG_API_KEY, POSTHOG_HOST
```

### Main Consumer

```typescript
// apps/analytics-ingestion/src/index.ts

import { AnalyticsEventEnvelopeSchema, type AnalyticsEventEnvelope } from '@project-sites/shared';

interface Env {
  ENVIRONMENT: string;
  CLICKHOUSE_HOST: string;
  CLICKHOUSE_DATABASE: string;
  CLICKHOUSE_USERNAME: string;
  CLICKHOUSE_PASSWORD: string;
  CLICKHOUSE_PORT: string;
  POSTHOG_API_KEY: string;
  POSTHOG_HOST: string;
}

export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const valid: AnalyticsEventEnvelope[] = [];
    const invalid: { id: string; reason: string }[] = [];

    for (const message of batch.messages) {
      const result = AnalyticsEventEnvelopeSchema.safeParse(message.body);
      if (result.success) {
        valid.push(result.data);
        message.ack();
      } else {
        // Invalid schema — ack to prevent DLQ poisoning; log for analysis
        invalid.push({ id: message.id, reason: result.error.message });
        message.ack();
      }
    }

    if (invalid.length > 0) {
      console.warn('[analytics-ingestion] schema_invalid', { count: invalid.length, samples: invalid.slice(0, 3) });
    }

    if (valid.length === 0) return;

    // Route events to their target tables
    const pageViews = valid.filter((e) => e.event_type === 'page.viewed');
    const otherEvents = valid.filter((e) => e.event_type !== 'page.viewed');

    const results = await Promise.allSettled([
      pageViews.length > 0 ? insertToClickHouse(env, 'page_views', pageViews) : Promise.resolve(),
      otherEvents.length > 0 ? insertToClickHouse(env, 'events', otherEvents) : Promise.resolve(),
    ]);

    // On ClickHouse failure, fall back to PostHog
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const bucket = i === 0 ? pageViews : otherEvents;
        console.warn('[analytics-ingestion] clickhouse_failed, falling back to posthog', {
          error: String(result.reason),
          count: bucket.length,
        });
        await fallbackToPostHog(env, bucket).catch((err) => {
          console.warn('[analytics-ingestion] posthog_fallback_failed', { error: String(err) });
        });
      }
    }
  },
};

async function insertToClickHouse(
  env: Env,
  table: string,
  events: AnalyticsEventEnvelope[],
): Promise<void> {
  const ndjson = events
    .map((e) => JSON.stringify({
      tenant_id: e.tenant_id,
      site_id: e.site_id,
      session_id: e.session_id,
      visitor_id: e.user_id ?? e.session_id,
      occurred_at: e.occurred_at,
      event_type: e.event_type,
      properties: JSON.stringify(e.properties),
    }))
    .join('\n');

  const url = new URL(`${env.CLICKHOUSE_HOST}/`);
  url.searchParams.set('database', env.CLICKHOUSE_DATABASE);
  url.searchParams.set('query', `INSERT INTO ${table} FORMAT JSONEachRow`);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': env.CLICKHOUSE_USERNAME,
      'X-ClickHouse-Key': env.CLICKHOUSE_PASSWORD,
      'Content-Type': 'application/x-ndjson',
    },
    body: ndjson,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ClickHouse insert failed [${res.status}]: ${body.slice(0, 200)}`);
  }
}

async function fallbackToPostHog(
  env: Env,
  events: AnalyticsEventEnvelope[],
): Promise<void> {
  const batch = events.map((e) => ({
    event: e.event_type,
    distinct_id: e.user_id ?? e.session_id,
    timestamp: e.occurred_at,
    properties: {
      $lib: 'project-sites-analytics-ingestion',
      tenant_id: e.tenant_id,
      site_id: e.site_id,
      session_id: e.session_id,
      ...e.properties,
    },
  }));

  const res = await fetch(`${env.POSTHOG_HOST}/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: env.POSTHOG_API_KEY, batch }),
  });

  if (!res.ok) {
    throw new Error(`PostHog batch failed [${res.status}]`);
  }
}
```

---

## Enqueueing Events (Main Worker)

```typescript
// In any main Worker route handler or middleware

import type { AnalyticsEventEnvelope } from '@project-sites/shared';

export function enqueueAnalyticsEvent(
  env: Env,
  ctx: ExecutionContext,
  event: AnalyticsEventEnvelope,
): void {
  if (!env.ANALYTICS_QUEUE) {
    console.warn('[analytics] queue not bound, dropping event', { event_type: event.event_type });
    return;
  }

  ctx.waitUntil(
    env.ANALYTICS_QUEUE.send(event).catch((err) => {
      console.warn('[analytics] enqueue failed', { error: String(err) });
    }),
  );
}
```

### wrangler.toml Queue Producer Binding (Main Worker)

```toml
[[queues.producers]]
  queue = "project-sites-analytics"
  binding = "ANALYTICS_QUEUE"
```

---

## Dead-Letter Queue Handling

Messages that fail all retries (3 max) land in `project-sites-analytics-dlq`. A separate scheduled Worker processes the DLQ daily.

```typescript
// Minimal DLQ drain: log to Axiom for manual investigation
export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      console.warn('[analytics-dlq] unprocessable_event', {
        id: message.id,
        body: message.body,
        attempts: message.attempts,
      });
      message.ack(); // Acknowledge to clear the DLQ
    }
  },
};
```

---

## Environment Variables Summary

| Variable | Worker | Description |
|---|---|---|
| `ANALYTICS_QUEUE` | Main Worker | Queue producer binding |
| `CLICKHOUSE_HOST` | Analytics Ingestion | ClickHouse HTTP API URL |
| `CLICKHOUSE_DATABASE` | Analytics Ingestion | Database name |
| `CLICKHOUSE_USERNAME` | Analytics Ingestion | Auth username |
| `CLICKHOUSE_PASSWORD` | Analytics Ingestion | Auth password (secret) |
| `POSTHOG_API_KEY` | Analytics Ingestion | PostHog project API key (fallback) |
| `POSTHOG_HOST` | Analytics Ingestion | PostHog ingest host (fallback) |

---

## Related Docs

- [ClickHouse warehouse](./clickhouse.md)
- [PostHog setup](../observability/posthog.md)
- [Architecture overview](../architecture/current.md)
