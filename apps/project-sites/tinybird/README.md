# Tinybird — ProjectSites event warehouse

The read side of the durable event bus. The worker emits every `ProjectSitesEvent`
to a D1 outbox (`services/event_bus.ts`); a `*/5` cron drains it to Tinybird +
Hatchet (`services/outbox_dispatch.ts`). These datafiles define the Tinybird
landing table + query endpoints for that stream.

## Files

| File | What |
|---|---|
| `datasources/projectsites_events.datasource` | The landing table. Schema mirrors the NDJSON payload built in `outbox_dispatch.dispatchOutboxEvent()` (`OUTBOX_TINYBIRD_DATASOURCE`). Sorted by `tenant_id, timestamp, event`; partitioned by month. |
| `pipes/events_by_tenant_daily.pipe` | Per-tenant / per-day / per-type rollup endpoint. Optional `tenant_id`, `days` (default 30), `event` params. |

## Source of truth

The datasource column set is locked to the ingest object in
`src/services/outbox_dispatch.ts`:

```
site_id, tenant_id, event, timestamp, event_id, trace_id, producer
```

Changing the ingest shape requires the same change here (drift = silent ingest
column mismatch). The worker token chain (`TINYBIRD_TOKEN` → `TINYBIRD_PASSWORD`
→ `TINYBIRD_MCP_TOKEN`) lives in `services/tinybird.ts`.

## Deploy

```bash
cd apps/project-sites/tinybird
tb auth            # uses TINYBIRD_TOKEN (get-secret) + TINYBIRD_API_HOST
tb deploy          # or: tb push datasources/*.datasource pipes/*.pipe
```

Tinybird auto-creates the datasource on first ingest if absent, but deploying
these files gives proper column types + sorting key for query performance — and
versions the schema alongside the producer code.

## Query examples

```bash
# All event types for one tenant over 30 days
curl "$TB_HOST/v0/pipes/events_by_tenant_daily.json?tenant_id=org_123&token=$TB_READ_TOKEN"

# Just publishes, last 7 days
curl "$TB_HOST/v0/pipes/events_by_tenant_daily.json?event=site.published&days=7&token=$TB_READ_TOKEN"
```
