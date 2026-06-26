# ClickHouse Analytics Warehouse

ClickHouse on Fly.io is the high-volume analytics warehouse for projectsites.dev. It stores page views, site build events, and raw analytics at a volume that would be prohibitively expensive in a transactional database. Access is API-only via the HTTP interface on port 8123.

---

## Deployment: Fly.io Single-Node

ClickHouse runs as a single-node Fly.io VM with a persistent volume. The decision to use Fly.io over Cloudflare Containers is documented in [fly-cloudflare-split.md](../architecture/fly-cloudflare-split.md).

### fly.toml

```toml
# apps/clickhouse/fly.toml
app = "projectsites-clickhouse"
primary_region = "iad"  # US East — co-located with Workers default

[build]
  image = "clickhouse/clickhouse-server:24.6-alpine"

[mounts]
  source = "clickhouse_data"
  destination = "/var/lib/clickhouse"
  initial_size = "50gb"

[[services]]
  internal_port = 8123
  protocol = "tcp"

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [services.concurrency]
    type = "connections"
    hard_limit = 500
    soft_limit = 400

[env]
  CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT = "1"

[http_service]
  internal_port = 8123
  force_https = true
  auto_stop_machines = false  # Analytics warehouse must always be on
  auto_start_machines = true
  min_machines_running = 1
```

### Volume Creation

```bash
fly volumes create clickhouse_data \
  --region iad \
  --size 50 \
  --app projectsites-clickhouse
```

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `CLICKHOUSE_HOST` | HTTP API base URL | `https://projectsites-clickhouse.fly.dev` |
| `CLICKHOUSE_DATABASE` | Default database | `projectsites` |
| `CLICKHOUSE_USERNAME` | Auth username | `default` |
| `CLICKHOUSE_PASSWORD` | Auth password (secret) | `...` |
| `CLICKHOUSE_PORT` | HTTP API port | `8123` |

Set as Worker secrets:

```bash
wrangler secret put CLICKHOUSE_HOST --env production
wrangler secret put CLICKHOUSE_PASSWORD --env production
```

---

## Schema Requirements

**Every table must include `tenant_id UUID NOT NULL`.** This is a hard requirement for tenant data isolation, export, and deletion compliance (GDPR/CCPA).

### page_views

```sql
CREATE TABLE IF NOT EXISTS projectsites.page_views (
  tenant_id       UUID NOT NULL,
  site_id         UUID NOT NULL,
  session_id      String NOT NULL,
  visitor_id      String NOT NULL,    -- hashed, non-PII
  occurred_at     DateTime64(3, 'UTC') NOT NULL,
  path            String NOT NULL,
  referrer        String DEFAULT '',
  user_agent      String DEFAULT '',
  country_code    FixedString(2) DEFAULT '',
  duration_ms     UInt32 DEFAULT 0,
  is_bounce       Bool DEFAULT false
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, site_id, occurred_at, session_id)
TTL occurred_at + INTERVAL 2 YEAR;
```

### events

```sql
CREATE TABLE IF NOT EXISTS projectsites.events (
  tenant_id       UUID NOT NULL,
  site_id         UUID NOT NULL,
  event_type      LowCardinality(String) NOT NULL,
  session_id      String NOT NULL,
  visitor_id      String NOT NULL,
  occurred_at     DateTime64(3, 'UTC') NOT NULL,
  properties      String DEFAULT '{}'  -- JSON blob
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, site_id, occurred_at, event_type)
TTL occurred_at + INTERVAL 2 YEAR;
```

### site_builds

```sql
CREATE TABLE IF NOT EXISTS projectsites.site_builds (
  tenant_id       UUID NOT NULL,
  site_id         UUID NOT NULL,
  build_id        UUID NOT NULL,
  started_at      DateTime64(3, 'UTC') NOT NULL,
  completed_at    DateTime64(3, 'UTC'),
  status          LowCardinality(String) NOT NULL,  -- queued | running | succeeded | failed
  model           LowCardinality(String) DEFAULT '',
  duration_ms     UInt32 DEFAULT 0,
  prompt_tokens   UInt32 DEFAULT 0,
  completion_tokens UInt32 DEFAULT 0,
  error_code      String DEFAULT ''
)
ENGINE = ReplacingMergeTree(completed_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (tenant_id, site_id, build_id);
```

---

## HTTP API (Workers Integration)

The Worker communicates with ClickHouse exclusively via the HTTP API. No ClickHouse client SDK is used in the Worker runtime.

```typescript
// apps/project-sites/src/lib/clickhouse.ts

export async function clickhouseQuery<T = unknown>(
  env: Env,
  sql: string,
  format: 'JSONEachRow' | 'JSON' = 'JSON',
): Promise<T> {
  const url = new URL(`${env.CLICKHOUSE_HOST}/`);
  url.searchParams.set('database', env.CLICKHOUSE_DATABASE);
  url.searchParams.set('query', sql);
  url.searchParams.set('default_format', format);

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-ClickHouse-User': env.CLICKHOUSE_USERNAME,
      'X-ClickHouse-Key': env.CLICKHOUSE_PASSWORD,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ClickHouse query failed [${res.status}]: ${body}`);
  }

  return res.json() as Promise<T>;
}

export async function clickhouseInsert(
  env: Env,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const ndjson = rows.map((r) => JSON.stringify(r)).join('\n');
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
    throw new Error(`ClickHouse insert failed [${res.status}]: ${body}`);
  }
}
```

---

## Tenant Data Operations

### Export (GDPR data portability)

```sql
-- Export all events for a tenant as CSV
SELECT *
FROM projectsites.page_views
WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000'
FORMAT CSVWithNames;
```

### Delete (GDPR right to erasure)

```sql
-- Schedule deletion (asynchronous in ClickHouse MergeTree)
ALTER TABLE projectsites.page_views
  DELETE WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

ALTER TABLE projectsites.events
  DELETE WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

ALTER TABLE projectsites.site_builds
  DELETE WHERE tenant_id = '550e8400-e29b-41d4-a716-446655440000';

-- Force mutation completion (run after ALTER TABLE DELETE)
OPTIMIZE TABLE projectsites.page_views FINAL;
```

---

## Backup and Restore

ClickHouse backups use `clickhouse-backup` writing to Cloudflare R2.

### Backup Configuration (`/etc/clickhouse-backup/config.yml`)

```yaml
general:
  remote_storage: s3
  backups_to_keep_remote: 7

s3:
  bucket: project-sites-production
  path: clickhouse-backups/
  endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  access_key: <R2_ACCESS_KEY_ID>
  secret_key: <R2_SECRET_ACCESS_KEY>
  force_path_style: true
```

### Backup Cron (on Fly VM)

```bash
# Daily backup at 03:00 UTC
0 3 * * * clickhouse-backup create-and-upload daily-$(date +%Y%m%d)
```

### Restore

```bash
clickhouse-backup download daily-20260625
clickhouse-backup restore daily-20260625
```

---

## Tinybird: Managed Alternative and Promotion Path

Tinybird provides a managed ClickHouse-compatible service with instant REST API endpoints, global replication, and zero operational overhead.

### When to Prefer Tinybird Over Fly ClickHouse

| Criterion | Fly ClickHouse | Tinybird |
|---|---|---|
| Operational overhead | You manage VM, volumes, backups | Zero — fully managed |
| Global replication | Manual (complex) | Built-in |
| Instant REST APIs | Build yourself | Generated from schema |
| Cost at low volume | Fixed VM cost (~$50/mo) | Pay-per-query / ingest |
| Cost at high volume | Fixed VM scales better | Metered — can be expensive |
| Real-time ingestion | HTTP API self-managed | Tinybird Events API |
| Recommendation | Default for >100M events/day | Default for <100M events/day or zero-ops needed |

### Promotion Path: Fly ClickHouse to Tinybird

1. Export current tables to CSV:
   ```bash
   clickhouse-client \
     --query "SELECT * FROM projectsites.page_views FORMAT CSVWithNames" \
     > page_views_export.csv
   ```
2. Create matching Data Sources in Tinybird via the Tinybird CLI or UI.
3. Import CSV: `tb datasource append page_views page_views_export.csv`
4. Update Worker env vars: point `CLICKHOUSE_HOST` to Tinybird ingest API.
5. Switch inserts to Tinybird Events API; reads to Tinybird Pipe endpoint.
6. Verify event counts match; decommission Fly VM.

---

## Related Docs

- [Analytics ingestion pipeline](./ingestion.md)
- [Architecture: CF vs Fly split](../architecture/fly-cloudflare-split.md)
- [Deployment: Fly.io guide](../deployment/fly.md)
