# Tinybird — ProjectSites event warehouse

The read side of the durable event bus. The worker emits every `ProjectSitesEvent`
to a D1 outbox (`services/event_bus.ts`); a `*/5` cron drains it to Tinybird +
Hatchet (`services/outbox_dispatch.ts`). These datafiles define the Tinybird
landing table + query endpoints for that stream.

## Files

| File | What |
|---|---|
| `datasources/projectsites_events.datasource` | The landing table. Schema mirrors the NDJSON payload built in `outbox_dispatch.dispatchOutboxEvent()` (`OUTBOX_TINYBIRD_DATASOURCE`). `ReplacingMergeTree` keyed on `tenant_id, timestamp, event, event_id` (dedup on merge); partitioned by month. |
| `pipes/events_by_tenant_daily.pipe` | Per-tenant / per-day / per-type rollup endpoint. Counts `DISTINCT event_id` (exactly-once). Optional `tenant_id`, `days` (default 30), `event` params. |
| `pipes/site_publishes_by_source.pipe` | Per-tenant `site.published` counts sliced by `JSONExtractString(payload,'source')` (bolt-embedded / claim / workflow). Exercises the `payload` column. Optional `tenant_id`, `days`, `source`. |
| `pipes/activation_funnel.pipe` | Per-tenant revenue-funnel rollup: discovered → engaged → delivered → converted, with `ordinal` + `count(DISTINCT site_id)` per stage. Funnel set is the SSOT in `src/services/activation_funnel.ts`. Optional `tenant_id`, `days`. |
| `pipes/claims_by_source.pipe` | Per-tenant `site.claim.started` counts sliced by `JSONExtractString(payload,'source')` + `'campaign'` (the wired claim attribution) — "which campaigns/sources drive claims?". Optional `tenant_id`, `days`, `source`, `campaign`. |

## Exactly-once counting

The outbox dispatcher re-sends **all** targets when a row retries after a
**partial** failure (e.g. Tinybird accepted but Hatchet 5xx'd), so the same
`event_id` can be ingested more than once. Two layers make counts exactly-once:

- **Storage** — `ReplacingMergeTree` with `event_id` in the sorting key collapses
  duplicate rows on the next background merge.
- **Query** — every count uses `count(DISTINCT event_id)`, so results are correct
  immediately, even *before* the merge runs. New pipes MUST follow this.

## Source of truth

The datasource column set is locked to the ingest object in
`src/services/outbox_dispatch.ts`:

```
site_id, tenant_id, event, timestamp, event_id, trace_id, producer, payload
```

`payload` is the JSON-stringified event `data` (slug/version/source/leadId/…) —
sliced in pipes via `JSONExtract*` so new payload keys never need a migration.

Changing the ingest shape requires the same change here (drift = silent ingest
column mismatch). The worker token chain (`TINYBIRD_TOKEN` → `TINYBIRD_PASSWORD`
→ `TINYBIRD_MCP_TOKEN`) lives in `services/tinybird.ts`.

## Deploy

⚠️ **The projectsites prod workspace is Tinybird _Forward_** (verified 2026-06-20:
`/v1/deployments` exists; classic `POST /v0/pipes` returns 403 "can only be done
via deployments"). On Forward, datafiles deploy via the Forward CLI's deployment
flow — NOT the classic `tb push` / Datafiles API:

```bash
# Forward CLI (current):
tb login                 # admin token = get-secret TINYBIRD_MCP_TOKEN (ADMIN scope)
tb --cloud deploy        # from a project containing datasources/ + pipes/
```

- `scripts/tinybird-push.mjs` (Node, CLI-free) targets the CLASSIC Datafiles API
  and is kept for any classic workspace; on this Forward workspace it now DETECTS
  the restriction and prints the Forward guidance (exit 3) instead of failing opaquely.
- The worker's token (`TINYBIRD_PASSWORD`) is an append/read token — enough to
  INGEST (the `*/5` outbox drain auto-creates the datasource on first event) and
  QUERY pipes, but NOT to create datasources/pipes (needs the admin token above).
- Auto-create covers the datasource on first ingest; the read PIPES still need the
  Forward deploy before the analytics endpoints return live data (until then they
  return `degraded: true` gracefully).

## Query examples

```bash
# All event types for one tenant over 30 days
curl "$TB_HOST/v0/pipes/events_by_tenant_daily.json?tenant_id=org_123&token=$TB_READ_TOKEN"

# Just publishes, last 7 days
curl "$TB_HOST/v0/pipes/events_by_tenant_daily.json?event=site.published&days=7&token=$TB_READ_TOKEN"
```
